import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('SECURITY AUDIT & PENETRATION VERIFICATION SUITE: Trust, Safety & Post Lifecycle (TASK-18)', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `sec_ts_${tag}_${timestamp}`,
        email: `sec_ts_${tag}_${timestamp}@pulse.local`,
        displayName: `Sec User ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');
  const bob = await createUser('bob');
  const charlie = await createUser('charlie');
  const eve = await createUser('eve');

  // Alice follows Bob & Charlie
  await prisma.follow.createMany({
    data: [
      { followerId: alice.id, followingId: bob.id },
      { followerId: alice.id, followingId: charlie.id },
    ],
  });

  // =========================================================================
  // VECTOR 1: EDIT WINDOW BYPASS & CONCURRENCY RACE CONDITIONS
  // =========================================================================
  await t.test('AUDIT VECTOR 1: Edit Window Bypass & Concurrency Invariants', async (t2) => {
    // 1.1: Request edit at 15 minutes 1 second (901 seconds) -> HTTP 403 EDIT_WINDOW_EXPIRED
    const postA = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice post about to expire',
        createdAt: new Date(Date.now() - 901 * 1000), // 15m 1s ago
      },
    });

    const expiredRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postA.id}`,
      headers: authHeaders(alice.id),
      payload: { content: 'Alice attempting edit at 15m 1s' },
    });

    assert.equal(expiredRes.statusCode, 403);
    assert.equal(expiredRes.json().error.code, 'EDIT_WINDOW_EXPIRED');

    // 1.2: Client clock spoofing (Header Date/Timestamp spoofing)
    // Server must rely strictly on Server DB timestamp, ignoring client headers
    const postB = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice post created 20 minutes ago',
        createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20m ago in DB
      },
    });

    // Client attempts to spoof current time or future time via headers
    const spoofRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postB.id}`,
      headers: {
        ...authHeaders(alice.id),
        'Date': new Date().toUTCString(),
        'x-client-timestamp': String(Date.now()),
      },
      payload: { content: 'Client spoofed timestamp attempt' },
    });

    assert.equal(spoofRes.statusCode, 403);
    assert.equal(spoofRes.json().error.code, 'EDIT_WINDOW_EXPIRED');

    // 1.3: Race condition: 20 concurrent requests at second 899
    // Invariant: Server serializes updates via row lock; versions are strictly sequential without corruption or jumping
    const racePost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Original content before 20 concurrent edits',
        createdAt: new Date(Date.now() - 899 * 1000), // Second 899 (1 second before 15m window closes)
      },
    });

    const concurrentCount = 20;
    const editPromises = Array.from({ length: concurrentCount }, (_, i) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/posts/${racePost.id}`,
        headers: authHeaders(alice.id),
        payload: { content: `Concurrent edit content iteration ${i + 1}` },
      })
    );

    const responses = await Promise.all(editPromises);
    const successful = responses.filter((r) => r.statusCode === 200);

    // All successful edits must be reflected in PostVersion audit trail
    assert.ok(successful.length > 0, 'At least some or all concurrent edits succeeded');

    const finalPost = await prisma.post.findUnique({ where: { id: racePost.id } });
    const versions = await prisma.postVersion.findMany({
      where: { postId: racePost.id },
      orderBy: { versionNumber: 'asc' },
    });

    // Invariant: versionNumbers must be strictly sequential (1, 2, 3, ...) without gaps or duplicates
    assert.equal(versions.length, finalPost.editCount);
    for (let i = 0; i < versions.length; i++) {
      assert.equal(versions[i].versionNumber, i + 1, `Version number must be exactly ${i + 1}`);
    }

    // Invariant: Unique versionNumber per postId strictly maintained in DB
    const versionNums = versions.map((v) => v.versionNumber);
    const uniqueNums = new Set(versionNums);
    assert.equal(uniqueNums.size, versionNums.length, 'No duplicate version numbers allowed');
  });

  // =========================================================================
  // VECTOR 2: POSTVERSION IMMUTABILITY & ACCESS CONTROL / IDOR
  // =========================================================================
  await t.test('AUDIT VECTOR 2: PostVersion Immutability & Access Control / IDOR', async (t2) => {
    // 2.1: Prevention of direct mutation / deletion on post_versions table
    const post = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post with versions to check immutability',
      },
    });

    // Edit post once to generate version 1
    const editRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(alice.id),
      payload: { content: 'Edited content for immutability test' },
    });
    assert.equal(editRes.statusCode, 200);

    const version1 = await prisma.postVersion.findFirst({
      where: { postId: post.id, versionNumber: 1 },
    });
    assert.ok(version1);

    // Attempt direct PATCH or DELETE on versions route -> Must return 404 (no mutation routes exist)
    const mutateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post.id}/versions`,
      headers: authHeaders(alice.id),
      payload: { content: 'Hacker trying to tamper version history' },
    });
    assert.equal(mutateRes.statusCode, 404);

    const deleteVersionRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${post.id}/versions/${version1.id}`,
      headers: authHeaders(alice.id),
    });
    assert.equal(deleteVersionRes.statusCode, 404);

    // 2.2: IDOR: Blocked user cannot view edit history of blocker post
    // Alice blocks Eve
    await prisma.block.create({
      data: { blockerId: alice.id, blockedId: eve.id },
    });

    const blockedVersionRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}/versions`,
      headers: authHeaders(eve.id),
    });
    assert.equal(blockedVersionRes.statusCode, 404);
    assert.equal(blockedVersionRes.json().error.code, 'POST_NOT_FOUND');

    // 2.3: Access Control: Version history of soft-deleted post is inaccessible
    const deletedPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post about to be deleted',
        isDeleted: true,
      },
    });

    const deletedVersionRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${deletedPost.id}/versions`,
      headers: authHeaders(charlie.id),
    });
    assert.equal(deletedVersionRes.statusCode, 404);
    assert.equal(deletedVersionRes.json().error.code, 'POST_NOT_FOUND');

    // Clean up block for subsequent tests
    await prisma.block.deleteMany({
      where: { blockerId: alice.id, blockedId: eve.id },
    });
  });

  // =========================================================================
  // VECTOR 3: PINNING PRIVILEGE ESCALATION & INVARIANTS
  // =========================================================================
  await t.test('AUDIT VECTOR 3: Pinning Privilege Escalation & Validation Invariants', async (t2) => {
    // 3.1: User Eve attempts to pin Alice's post -> HTTP 403 FORBIDDEN
    const alicePost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice exclusive announcement',
      },
    });

    const pinOtherRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${alicePost.id}/pin`,
      headers: authHeaders(eve.id),
    });
    assert.equal(pinOtherRes.statusCode, 403);
    assert.equal(pinOtherRes.json().error.code, 'FORBIDDEN');

    // 3.2: Attempt to pin a reply post -> HTTP 400 CANNOT_PIN_REPLY
    const replyPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice reply to announcement',
        replyToId: alicePost.id,
        rootPostId: alicePost.id,
      },
    });

    const pinReplyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${replyPost.id}/pin`,
      headers: authHeaders(alice.id),
    });
    assert.equal(pinReplyRes.statusCode, 400);
    assert.equal(pinReplyRes.json().error.code, 'CANNOT_PIN_REPLY');

    // 3.3: Attempt to pin a soft-deleted post -> HTTP 400 CANNOT_PIN_DELETED
    const softDeletedPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Soft deleted post by Alice',
        isDeleted: true,
      },
    });

    const pinDeletedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${softDeletedPost.id}/pin`,
      headers: authHeaders(alice.id),
    });
    assert.equal(pinDeletedRes.statusCode, 400);
    assert.equal(pinDeletedRes.json().error.code, 'CANNOT_PIN_DELETED');

    // 3.4: User Eve attempts to unpin Alice's post -> HTTP 403 FORBIDDEN
    // First Alice pins her own post
    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${alicePost.id}/pin`,
      headers: authHeaders(alice.id),
    });

    const unpinOtherRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${alicePost.id}/pin`,
      headers: authHeaders(eve.id),
    });
    assert.equal(unpinOtherRes.statusCode, 403);
    assert.equal(unpinOtherRes.json().error.code, 'FORBIDDEN');
  });

  // =========================================================================
  // VECTOR 4: MUTE STEALTH & LEAKAGE INVARIANTS
  // =========================================================================
  await t.test('AUDIT VECTOR 4: Mute Stealth & Leakage Invariants', async (t2) => {
    // 4.1: Silent Mute: Alice mutes Bob. Bob receives 0 errors/notifications; Follow is preserved
    const muteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${bob.id}/mute`,
      headers: authHeaders(alice.id),
    });
    assert.equal(muteRes.statusCode, 200);
    assert.equal(muteRes.json().data.isMuted, true);

    // Verify follow relationship is 100% intact
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: alice.id,
          followingId: bob.id,
        },
      },
    });
    assert.ok(follow, 'Follow relationship must be preserved on mute');

    // 4.2: Leakage Invariant: Bob publishes post -> Absolutely absent from Alice Home Feed
    const bobPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(bob.id),
      payload: { content: 'Secret post by muted Bob' },
    });
    assert.equal(bobPostRes.statusCode, 201);
    const bobPostId = bobPostRes.json().data.id;

    const aliceHomeFeed = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(aliceHomeFeed.statusCode, 200);
    const homePosts = aliceHomeFeed.json().data.posts;
    assert.ok(!homePosts.some((p) => p.id === bobPostId), 'Muted user post must not appear in Home Feed');

    // 4.3: Leakage Invariant: Bob likes Alice post -> Alice notifications do NOT include Bob
    const alicePost = await prisma.post.create({
      data: { authorId: alice.id, content: 'Alice post for Bob to like' },
    });

    const bobLikeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${alicePost.id}/like`,
      headers: authHeaders(bob.id),
    });
    assert.equal(bobLikeRes.statusCode, 200);

    const aliceNotificationsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: authHeaders(alice.id),
    });
    assert.equal(aliceNotificationsRes.statusCode, 200);
    const notifs = aliceNotificationsRes.json().data;
    assert.ok(!notifs.some((n) => n.actorId === bob.id), 'Muted user interactions must not appear in notifications');

    // 4.4: Realtime SSE Stream Leakage: Muted user post must NOT emit NEW_TIMELINE_POST to Alice
    // Start local HTTP server to listen to SSE
    const sseApp = await buildApp();
    await sseApp.listen({ port: 0, host: '127.0.0.1' });
    const ssePort = sseApp.server.address().port;

    let receivedEventsForAlice = [];

    const sseClient = http.request(
      {
        hostname: '127.0.0.1',
        port: ssePort,
        path: `/api/v1/realtime/stream?userId=${alice.id}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (chunk) => {
          const raw = chunk.toString();
          receivedEventsForAlice.push(raw);
        });
      }
    );
    sseClient.end();

    // Wait 50ms for SSE handshake
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Bob creates post while Alice is connected to SSE
    await sseApp.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(bob.id),
      payload: { content: 'Another post by muted Bob during live SSE' },
    });

    // Wait 100ms for event propagation
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Alice must NOT receive any NEW_TIMELINE_POST from muted Bob
    const timelineEventReceived = receivedEventsForAlice.some(
      (e) => e.includes('NEW_TIMELINE_POST') && e.includes(bob.id)
    );
    assert.equal(timelineEventReceived, false, 'Muted user posts must NOT leak into SSE stream');

    sseClient.destroy();
    await sseApp.close();

    // 4.5: FTS Search Leakage: Bob and Bob's posts must NOT leak into Alice search results
    const searchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(bob.username)}`,
      headers: authHeaders(alice.id),
    });
    assert.equal(searchRes.statusCode, 200);
    const searchData = searchRes.json().data;
    assert.ok(!searchData.users.some((u) => u.id === bob.id), 'Muted user must not appear in search results');
    assert.ok(!searchData.posts.some((p) => p.authorId === bob.id), 'Muted user posts must not appear in search results');
  });

  // =========================================================================
  // VECTOR 5: STORED XSS & INJECTION ATTACKS
  // =========================================================================
  await t.test('AUDIT VECTOR 5: Stored XSS & Injection Attacks Sanitization', async (t2) => {
    // 5.1: XSS payloads in contentWarning on Post creation
    const xssCreationRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post testing XSS in contentWarning',
        contentWarning: '<script>alert(1)</script><img src=x onerror=alert(2)>Sensitive Topic',
        isSensitive: true,
      },
    });

    assert.equal(xssCreationRes.statusCode, 201);
    const postWithWarning = xssCreationRes.json().data;
    assert.ok(!postWithWarning.contentWarning.includes('<script>'));
    assert.ok(!postWithWarning.contentWarning.includes('<img'));
    assert.ok(!postWithWarning.contentWarning.includes('onerror'));
    assert.equal(postWithWarning.contentWarning, 'alert(1)Sensitive Topic');

    // 5.2: Nested XSS payloads in contentWarning on Post update
    // Recursive stripping test: <<script>script>alert("XSS")</script>
    const nestedXssRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postWithWarning.id}`,
      headers: authHeaders(alice.id),
      payload: {
        contentWarning: '<<script>script>alert("XSS")</script>Nested Bypass Test',
      },
    });

    assert.equal(nestedXssRes.statusCode, 200);
    const updatedPost = nestedXssRes.json().data;
    assert.ok(!updatedPost.contentWarning.includes('<script>'));
    assert.ok(!updatedPost.contentWarning.includes('<'));
    assert.equal(updatedPost.contentWarning, 'alert("XSS")Nested Bypass Test');

    // 5.3: XSS in keyword mute creation is stripped cleanly
    const xssKeywordRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: '<script>alert("XSS")</script>maliciousKeyword',
        matchType: 'CONTAINS',
        muteContext: 'ALL',
      },
    });

    assert.equal(xssKeywordRes.statusCode, 201);
    const kwData = xssKeywordRes.json().data;
    assert.ok(!kwData.keyword.includes('<script>'));
    assert.ok(!kwData.keyword.includes('<'));
    assert.equal(kwData.keyword, 'alert("xss")maliciouskeyword');

    // 5.4: Denial of Service Defense: Keyword length bounding (>100 chars rejected)
    const longKeyword = 'a'.repeat(101);
    const longKeywordRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: longKeyword,
        matchType: 'CONTAINS',
      },
    });

    assert.equal(longKeywordRes.statusCode, 400);
    assert.equal(longKeywordRes.json().error.code, 'KEYWORD_TOO_LONG');
  });

  await app.close();
});
