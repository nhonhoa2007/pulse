import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';

test('TASK-16: Reply Privacy Controls & Server-Side Validation Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Helper to create test user
  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `user_${tag}_${timestamp}`,
        email: `user_${tag}_${timestamp}@test.local`,
        displayName: `Test User ${tag}`,
      },
    });
  };

  // Create actors
  const author = await createUser('author');
  const followedUser = await createUser('followed');
  const followerOnlyUser = await createUser('follower_only');
  const mentionedUser = await createUser('mentioned');
  const stranger = await createUser('stranger');
  const blockedUser = await createUser('blocked');

  // Set up social graph relationships
  // 1. author follows followedUser
  await prisma.follow.create({
    data: { followerId: author.id, followingId: followedUser.id },
  });

  // 2. followerOnlyUser follows author (but author does NOT follow followerOnlyUser)
  await prisma.follow.create({
    data: { followerId: followerOnlyUser.id, followingId: author.id },
  });

  // 3. author blocks blockedUser
  await prisma.block.create({
    data: { blockerId: author.id, blockedId: blockedUser.id },
  });

  // =========================================================================
  // 1. POST CREATION & SCHEMA PERSISTENCE
  // =========================================================================
  await t.test('POST /posts: default reply_privacy is EVERYONE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Default privacy post' },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.reply_privacy, 'EVERYONE');
    assert.equal(body.data.replyPrivacy, 'EVERYONE');
  });

  await t.test('POST /posts: persists explicit FOLLOWING and MENTIONED', async () => {
    const resFollow = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Followers only post', reply_privacy: 'FOLLOWING' },
    });
    assert.equal(resFollow.statusCode, 201);
    assert.equal(resFollow.json().data.reply_privacy, 'FOLLOWING');

    const resMention = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: `Mentioned only @${mentionedUser.username}`, reply_privacy: 'MENTIONED' },
    });
    assert.equal(resMention.statusCode, 201);
    assert.equal(resMention.json().data.reply_privacy, 'MENTIONED');
  });

  await t.test('POST /posts: rejects invalid reply_privacy with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Invalid privacy', reply_privacy: 'NOBODY' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  // =========================================================================
  // 2. POST UPDATE API (PATCH & PUT /posts/:id)
  // =========================================================================
  let postToUpdate;
  await t.test('PATCH /posts/:id: updates reply_privacy setting and content', async () => {
    // Create initial post
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Post before update', reply_privacy: 'EVERYONE' },
    });
    postToUpdate = created.json().data;

    // Unauthenticated update returns 401
    const resUnauth = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postToUpdate.id}`,
      payload: { reply_privacy: 'FOLLOWING' },
    });
    assert.equal(resUnauth.statusCode, 401);

    // Non-author update returns 403
    const resForbidden = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postToUpdate.id}`,
      headers: authHeaders(stranger.id),
      payload: { reply_privacy: 'FOLLOWING' },
    });
    assert.equal(resForbidden.statusCode, 403);
    assert.equal(resForbidden.json().error.code, 'FORBIDDEN');

    // Author updates to FOLLOWING successfully
    const resSuccess = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postToUpdate.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'FOLLOWING' },
    });
    assert.equal(resSuccess.statusCode, 200);
    assert.equal(resSuccess.json().data.reply_privacy, 'FOLLOWING');

    // Verify persisted in DB
    const dbPost = await prisma.post.findUnique({ where: { id: postToUpdate.id } });
    assert.equal(dbPost.reply_privacy, 'FOLLOWING');
  });

  await t.test('PATCH /posts/:id: rejects invalid reply_privacy with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postToUpdate.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'INVALID_ENUM' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_REPLY_PRIVACY');
  });

  // =========================================================================
  // 3. SERVER-SIDE VALIDATION: EVERYONE
  // =========================================================================
  await t.test('Reply validation: EVERYONE allows author, followers, followed, stranger; blocks blockedUser', async () => {
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Public post for everyone', reply_privacy: 'EVERYONE' },
    });
    const publicPost = rootRes.json().data;

    // 1. Author replies -> 201
    const resAuthor = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Author reply', replyToId: publicPost.id },
    });
    assert.equal(resAuthor.statusCode, 201);

    // 2. Stranger replies -> 201
    const resStranger = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger reply', replyToId: publicPost.id },
    });
    assert.equal(resStranger.statusCode, 201);

    // 3. Blocked user replies -> 403
    const resBlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(blockedUser.id),
      payload: { content: 'Blocked reply', replyToId: publicPost.id },
    });
    assert.equal(resBlocked.statusCode, 403);
    assert.equal(resBlocked.json().error.code, 'FORBIDDEN');
  });

  // =========================================================================
  // 4. SERVER-SIDE VALIDATION: FOLLOWING ('People you follow')
  // =========================================================================
  await t.test('Reply validation: FOLLOWING allows author and people author follows; rejects stranger and follower-only', async () => {
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'People I follow only', reply_privacy: 'FOLLOWING' },
    });
    const followingPost = rootRes.json().data;

    // 1. Author replies -> 201
    const resAuthor = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Author reply', replyToId: followingPost.id },
    });
    assert.equal(resAuthor.statusCode, 201);

    // 2. User whom author follows replies -> 201
    const resFollowed = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Followed user reply', replyToId: followingPost.id },
    });
    assert.equal(resFollowed.statusCode, 201);

    // 3. Stranger replies -> 403 REPLY_RESTRICTED
    const resStranger = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger trying to reply', replyToId: followingPost.id },
    });
    assert.equal(resStranger.statusCode, 403);
    assert.equal(resStranger.json().error.code, 'REPLY_RESTRICTED');

    // 4. Follower-only (who follows author, but author DOES NOT follow them) -> 403 REPLY_RESTRICTED
    const resFollowerOnly = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followerOnlyUser.id),
      payload: { content: 'Follower only trying to reply', replyToId: followingPost.id },
    });
    assert.equal(resFollowerOnly.statusCode, 403);
    assert.equal(resFollowerOnly.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // 5. SERVER-SIDE VALIDATION: MENTIONED ('Only mentioned users')
  // =========================================================================
  await t.test('Reply validation: MENTIONED allows author & mentioned user; rejects unmentioned & followed users', async () => {
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Hey @${mentionedUser.username}, what do you think?`,
        reply_privacy: 'MENTIONED',
      },
    });
    const mentionedPost = rootRes.json().data;

    // 1. Author replies -> 201
    const resAuthor = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Author reply', replyToId: mentionedPost.id },
    });
    assert.equal(resAuthor.statusCode, 201);

    // 2. Mentioned user replies -> 201
    const resMentioned = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(mentionedUser.id),
      payload: { content: 'I was mentioned, here is my reply!', replyToId: mentionedPost.id },
    });
    assert.equal(resMentioned.statusCode, 201);

    // 3. User followed by author (NOT mentioned) replies -> 403 REPLY_RESTRICTED
    const resFollowed = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'I am followed but not mentioned', replyToId: mentionedPost.id },
    });
    assert.equal(resFollowed.statusCode, 403);
    assert.equal(resFollowed.json().error.code, 'REPLY_RESTRICTED');

    // 4. Stranger replies -> 403 REPLY_RESTRICTED
    const resStranger = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger trying to reply', replyToId: mentionedPost.id },
    });
    assert.equal(resStranger.statusCode, 403);
    assert.equal(resStranger.json().error.code, 'REPLY_RESTRICTED');

    // 5. Anti-Bypass: Stranger mentions themselves in reply payload -> still 403 REPLY_RESTRICTED
    const resSelfMentionBypass = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: {
        content: `I mention myself @${stranger.username} to bypass check`,
        replyToId: mentionedPost.id,
      },
    });
    assert.equal(resSelfMentionBypass.statusCode, 403);
    assert.equal(resSelfMentionBypass.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // 6. THREAD-LEVEL INHERITANCE & ANTI-HIJACKING
  // =========================================================================
  await t.test('Thread inheritance: unauthorized user cannot reply to secondary comments in a restricted thread', async () => {
    // 1. Author creates root post with FOLLOWING
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Root thread: Following only', reply_privacy: 'FOLLOWING' },
    });
    const rootPost = rootRes.json().data;

    // 2. Followed user replies to root
    const reply1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Reply 1 by followed user', replyToId: rootPost.id },
    });
    assert.equal(reply1Res.statusCode, 201);
    const reply1 = reply1Res.json().data;

    // 3. Stranger tries to reply to Reply 1 (thread hijacking bypass attempt)
    const resHijack = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Hijack attempt on reply 1', replyToId: reply1.id },
    });
    assert.equal(resHijack.statusCode, 403);
    assert.equal(resHijack.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // 7. CAN_REPLY EVALUATION IN GET /posts/:id AND GET /posts/:id/thread
  // =========================================================================
  await t.test('canReply flag: accurately evaluated for requester in detail & thread', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Evaluation test post', reply_privacy: 'FOLLOWING' },
    });
    const post = postRes.json().data;

    // Detail query by Author -> canReply: true
    const resAuthor = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(author.id),
    });
    assert.equal(resAuthor.json().data.canReply, true);

    // Detail query by Followed User -> canReply: true
    const resFollowed = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(followedUser.id),
    });
    assert.equal(resFollowed.json().data.canReply, true);

    // Detail query by Stranger -> canReply: false
    const resStranger = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(stranger.id),
    });
    assert.equal(resStranger.json().data.canReply, false);

    // Thread query by Stranger -> rootPost.canReply: false
    const threadStranger = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}/thread`,
      headers: authHeaders(stranger.id),
    });
    assert.equal(threadStranger.json().data.rootPost.canReply, false);

    // Anonymous query -> canReply: false
    const resAnon = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
    });
    assert.equal(resAnon.json().data.canReply, false);
  });

  await app.close();
});
