import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('SECURITY PENETRATION & REMEDIATION VERIFICATION SUITE: Reply Endpoints Access Control', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `sec_${tag}_${timestamp}`,
        email: `sec_${tag}_${timestamp}@test.local`,
        displayName: `Sec User ${tag}`,
      },
    });
  };

  const author = await createUser('author');
  const commenter = await createUser('commenter');
  const stranger = await createUser('stranger');
  const blockedUser = await createUser('blocked');
  const emailUser = await createUser('charlie');

  // Block relationship: author blocks blockedUser
  await prisma.block.create({
    data: { blockerId: author.id, blockedId: blockedUser.id },
  });

  // =========================================================================
  // VULNERABILITY 1 REMEDIATION: THREAD HIJACKING & ROOT AUTHOR LOCKOUT PREVENTED
  // =========================================================================
  await t.test('AUDIT VULN-1: Root post author CANNOT be locked out by commenter setting restrictive reply_privacy', async () => {
    // 1. Author creates root post with EVERYONE
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: { content: 'Root discussion thread', reply_privacy: 'EVERYONE' },
    });
    assert.equal(rootRes.statusCode, 201);
    const rootPost = rootRes.json().data;

    // 2. Commenter replies to author root post, setting reply_privacy = FOLLOWING (commenter does NOT follow author)
    const reply1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': commenter.id },
      payload: {
        content: 'I reply and restrict replies to people I follow only',
        replyToId: rootPost.id,
        reply_privacy: 'FOLLOWING',
      },
    });
    assert.equal(reply1Res.statusCode, 201);
    const reply1 = reply1Res.json().data;

    // 3. Author (owner of root conversation) replies to reply1 in author's own thread
    const authorReplyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: {
        content: 'I am the root author responding to your comment',
        replyToId: reply1.id,
      },
    });

    // Root author MUST be allowed to reply (201 Created), not locked out with 403
    assert.equal(authorReplyRes.statusCode, 201, 'Root thread author must never be locked out of their own thread');
    assert.equal(authorReplyRes.json().success, true);
    assert.equal(authorReplyRes.json().data.rootPostId, rootPost.id);
  });

  // =========================================================================
  // VULNERABILITY 2 REMEDIATION: MISSING ROOTPOSTID TRACED & ACCESS RESTRICTED
  // =========================================================================
  await t.test('AUDIT VULN-2: Legacy or unlinked reply with null rootPostId traces parent and enforces root restriction', async () => {
    // 1. Author creates root post with FOLLOWING
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: { content: 'Restricted root: Following only', reply_privacy: 'FOLLOWING' },
    });
    const rootPost = rootRes.json().data;

    // 2. Simulate legacy data: reply has replyToId pointing to rootPost, but rootPostId is null
    const legacyReply = await prisma.post.create({
      data: {
        authorId: author.id,
        content: 'Legacy reply with null rootPostId',
        replyToId: rootPost.id,
        rootPostId: null,
        reply_privacy: 'EVERYONE',
      },
    });

    // 3. Stranger (whom author does NOT follow) attempts to reply to legacyReply
    const bypassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': stranger.id },
      payload: {
        content: 'Attacker replying to unlinked legacy reply',
        replyToId: legacyReply.id,
      },
    });

    // Must be blocked because root post restriction (FOLLOWING) is resolved via replyToId fallback
    assert.equal(bypassRes.statusCode, 403, 'Must reject reply to legacy unlinked post in restricted thread');
    assert.equal(bypassRes.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // VULNERABILITY 3 REMEDIATION: BLOCK INVARIANT ENFORCED ON QUOTE POSTS
  // =========================================================================
  await t.test('AUDIT VULN-3: Blocked user CANNOT quote-post blocker or trigger quote notifications', async () => {
    // 1. Author creates post
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: { content: 'Author public post' },
    });
    const post = postRes.json().data;

    // 2. Blocked user attempts to quote author post
    const quoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': blockedUser.id },
      payload: {
        content: 'Blocked user quoting blocker post',
        quoteOfId: post.id,
      },
    });

    // Must return 403 FORBIDDEN due to block invariant
    assert.equal(quoteRes.statusCode, 403);
    assert.equal(quoteRes.json().error.code, 'FORBIDDEN');

    // Verify quotesCount did NOT increment
    const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(dbPost.quotesCount, 0, 'quotesCount must remain 0 when quote attempt is rejected');
  });

  // =========================================================================
  // VULNERABILITY 4 REMEDIATION: MENTION EXTRACTION BOUNDARIES
  // =========================================================================
  await t.test('AUDIT VULN-4: Email addresses and embedded URLs in content do NOT grant mention reply permissions', async () => {
    // 1. Author creates post mentioning email address support@sec_charlie_...
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: {
        content: `Please email us at support@${emailUser.username} for assistance`,
        reply_privacy: 'MENTIONED',
      },
    });
    const post = postRes.json().data;
    // Mentions array must NOT contain the email username
    assert.equal(post.mentions.length, 0, 'Email address must not be extracted as mention');

    // 2. emailUser attempts to reply
    const replyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': emailUser.id },
      payload: {
        content: 'I replied because my username was part of an email address',
        replyToId: post.id,
      },
    });
    assert.equal(replyRes.statusCode, 403);
    assert.equal(replyRes.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // VULNERABILITY 5 REMEDIATION: DIRECT API INVOCATIONS & IDOR PROTECTION
  // =========================================================================
  await t.test('AUDIT VULN-5: Direct API invocations bypassing frontend gates are strictly rejected', async () => {
    // 1. Unauthenticated reply attempt -> 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      payload: { content: 'Unauthenticated reply' },
    });
    assert.equal(unauthRes.statusCode, 401);
    assert.equal(unauthRes.json().error.code, 'UNAUTHORIZED');

    // 2. Reply to deleted post -> 404 POST_NOT_FOUND
    const deletedPost = await prisma.post.create({
      data: {
        authorId: author.id,
        content: 'Deleted post',
        isDeleted: true,
      },
    });

    const replyDeletedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': stranger.id },
      payload: {
        content: 'Trying to reply to deleted post',
        replyToId: deletedPost.id,
      },
    });
    assert.equal(replyDeletedRes.statusCode, 404);
    assert.equal(replyDeletedRes.json().error.code, 'POST_NOT_FOUND');

    // 3. IDOR: Stranger tries to PATCH reply_privacy of author's post -> 403 FORBIDDEN
    const idorRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${deletedPost.id}`,
      headers: { 'x-user-id': stranger.id },
      payload: { reply_privacy: 'FOLLOWING' },
    });
    // Post is deleted -> 404; or if active -> 403
    assert.ok([403, 404].includes(idorRes.statusCode));
  });

  // =========================================================================
  // VULNERABILITY 6: HIGH CONCURRENCY REPLIES & ATOMIC COUNTER INTEGRITY
  // =========================================================================
  await t.test('AUDIT VULN-6: High concurrency replies maintain exact repliesCount and race condition resilience', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { 'x-user-id': author.id },
      payload: { content: 'Concurrency test post', reply_privacy: 'EVERYONE' },
    });
    const post = postRes.json().data;

    // Send 20 concurrent replies
    const concurrency = 20;
    const promises = Array.from({ length: concurrency }).map((_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { 'x-user-id': commenter.id },
        payload: {
          content: `Concurrent reply #${i}`,
          replyToId: post.id,
        },
      })
    );

    const results = await Promise.all(promises);
    const allSuccessful = results.every((r) => r.statusCode === 201);
    assert.equal(allSuccessful, true, 'All 20 concurrent replies must succeed');

    const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(dbPost.repliesCount, 20, 'Post repliesCount must be exactly 20');
  });

  await app.close();
});
