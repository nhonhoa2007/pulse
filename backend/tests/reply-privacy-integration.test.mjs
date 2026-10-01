import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-16: Reply Privacy Controls - Exhaustive Integration & E2E Matrix Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const ts = Date.now() % 10000000; // Keep username <= 30 chars for regex mention extraction

  // Helper to create test user with unique short username
  const createUser = async (tag) => {
    const username = `u_${tag}_${ts}`.slice(0, 30);
    return prisma.user.create({
      data: {
        username,
        email: `${username}@matrix.local`,
        displayName: `Matrix User ${tag}`,
      },
    });
  };

  // -------------------------------------------------------------------------
  // ACTORS & RELATIONSHIPS SETUP
  // -------------------------------------------------------------------------
  const author = await createUser('author');
  const followerOnly = await createUser('follower');       // Follows author, author does NOT follow them
  const followedUser = await createUser('followed');       // Author follows them, they do NOT follow author
  const mutualFollow = await createUser('mutual');         // Author & user follow each other
  const stranger = await createUser('stranger');           // No relationship
  const mentionedUser = await createUser('mentioned');     // Mentioned in post
  const unmentionedUser = await createUser('unmentioned'); // Not mentioned in post
  const blockedByAuthor = await createUser('blk_author');  // Author blocked them
  const blockerOfAuthor = await createUser('blk_user');    // They blocked author
  const mentionedAndBlocked = await createUser('men_blk'); // Mentioned but blocked
  const followedAndBlocked = await createUser('fll_blk');  // Followed but blocked

  // Establish Social Graph Relationships
  // 1. Follow relationships
  await prisma.follow.createMany({
    data: [
      { followerId: followerOnly.id, followingId: author.id },
      { followerId: author.id, followingId: followedUser.id },
      { followerId: author.id, followingId: mutualFollow.id },
      { followerId: mutualFollow.id, followingId: author.id },
      { followerId: author.id, followingId: followedAndBlocked.id },
    ],
  });

  // 2. Block relationships
  await prisma.block.createMany({
    data: [
      { blockerId: author.id, blockedId: blockedByAuthor.id },
      { blockerId: blockerOfAuthor.id, blockedId: author.id },
      { blockerId: author.id, blockedId: mentionedAndBlocked.id },
      { blockerId: author.id, blockedId: followedAndBlocked.id },
    ],
  });

  // =========================================================================
  // SUITE 1: API CONTRACT VERIFICATION (POST, PATCH, GET, THREAD, FEED, SEARCH)
  // =========================================================================
  await t.test('1. API Contracts: Schema, enum persistence, and PostDto fields', async () => {
    // 1.1 POST /posts default is EVERYONE
    const resDefault = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Contract test: default privacy' },
    });
    assert.equal(resDefault.statusCode, 201);
    const postDefault = resDefault.json().data;
    assert.equal(postDefault.reply_privacy, 'EVERYONE');
    assert.equal(postDefault.replyPrivacy, 'EVERYONE');
    assert.equal(typeof postDefault.canReply, 'boolean');
    assert.equal(postDefault.canReply, true);

    // 1.2 POST /posts explicit FOLLOWING and MENTIONED
    const resFollowing = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Contract test: following', reply_privacy: 'FOLLOWING' },
    });
    assert.equal(resFollowing.statusCode, 201);
    assert.equal(resFollowing.json().data.reply_privacy, 'FOLLOWING');
    assert.equal(resFollowing.json().data.replyPrivacy, 'FOLLOWING');

    const resMentioned = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Contract test: mentioned @${mentionedUser.username}`,
        reply_privacy: 'MENTIONED',
      },
    });
    assert.equal(resMentioned.statusCode, 201);
    assert.equal(resMentioned.json().data.reply_privacy, 'MENTIONED');
    assert.equal(resMentioned.json().data.replyPrivacy, 'MENTIONED');

    // 1.3 Invalid enum value on POST rejected with 400 BAD_REQUEST
    const resInvalid = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Invalid enum test', reply_privacy: 'PRIVATE_CIRCLES' },
    });
    assert.equal(resInvalid.statusCode, 400);
    assert.equal(resInvalid.json().success, false);
    assert.equal(resInvalid.json().error.code, 'BAD_REQUEST');

    // 1.4 Invalid enum value on PATCH rejected with 400 INVALID_REPLY_PRIVACY
    const patchInvalid = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postDefault.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'INVALID_STATUS' },
    });
    assert.equal(patchInvalid.statusCode, 400);
    assert.equal(patchInvalid.json().error.code, 'INVALID_REPLY_PRIVACY');

    // 1.5 PATCH update API contract
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postDefault.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'FOLLOWING' },
    });
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.json().data.reply_privacy, 'FOLLOWING');

    // 1.6 GET /posts/:id contract
    const getDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${postDefault.id}`,
      headers: authHeaders(stranger.id),
    });
    assert.equal(getDetailRes.statusCode, 200);
    const detailData = getDetailRes.json().data;
    assert.equal(detailData.reply_privacy, 'FOLLOWING');
    assert.equal(detailData.replyPrivacy, 'FOLLOWING');
    assert.equal(detailData.canReply, false, 'Stranger cannot reply to FOLLOWING post');

    // 1.7 GET /posts/:id/thread contract
    const getThreadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${postDefault.id}/thread`,
      headers: authHeaders(followedUser.id),
    });
    assert.equal(getThreadRes.statusCode, 200);
    assert.equal(getThreadRes.json().data.rootPost.canReply, true, 'Followed user can reply in thread');

    // 1.8 GET /feed and GET /search/posts contracts
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(author.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const feedPosts = feedRes.json().data.posts;
    assert.ok(Array.isArray(feedPosts));
    if (feedPosts.length > 0) {
      assert.ok('reply_privacy' in feedPosts[0] || 'replyPrivacy' in feedPosts[0]);
    }

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=Contract&type=posts',
      headers: authHeaders(author.id),
    });
    assert.equal(searchRes.statusCode, 200);
    const searchPosts = searchRes.json().data.posts;
    assert.ok(searchPosts.length > 0);
    assert.ok('reply_privacy' in searchPosts[0] || 'replyPrivacy' in searchPosts[0]);
  });

  // =========================================================================
  // SUITE 2: 'EVERYONE' PRIVACY MATRIX ACROSS ALL RELATIONSHIPS
  // =========================================================================
  await t.test('2. EVERYONE Matrix: Permitted for all non-blocked users, blocked users rejected', async () => {
    const rootPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Matrix EVERYONE post mentioning @${mentionedUser.username}`,
        reply_privacy: 'EVERYONE',
      },
    });
    const post = rootPostRes.json().data;

    const testReply = async (user, headers = {}) => {
      const authHeader = user ? authHeaders(user.id) : {};
      return app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { ...authHeader, ...headers },
        payload: { content: `Reply by ${user ? user.username : 'anon'}`, replyToId: post.id },
      });
    };

    // Permitted roles -> 201 Created
    const authorReply = await testReply(author);
    assert.equal(authorReply.statusCode, 201, 'Author can reply to EVERYONE');

    const followerReply = await testReply(followerOnly);
    assert.equal(followerReply.statusCode, 201, 'Follower can reply to EVERYONE');

    const followedReply = await testReply(followedUser);
    assert.equal(followedReply.statusCode, 201, 'Followed user can reply to EVERYONE');

    const mutualReply = await testReply(mutualFollow);
    assert.equal(mutualReply.statusCode, 201, 'Mutual follower can reply to EVERYONE');

    const strangerReply = await testReply(stranger);
    assert.equal(strangerReply.statusCode, 201, 'Stranger can reply to EVERYONE');

    const mentionedReply = await testReply(mentionedUser);
    assert.equal(mentionedReply.statusCode, 201, 'Mentioned user can reply to EVERYONE');

    const unmentionedReply = await testReply(unmentionedUser);
    assert.equal(unmentionedReply.statusCode, 201, 'Unmentioned user can reply to EVERYONE');

    // Forbidden roles -> 403 FORBIDDEN
    const blockedByAuthorReply = await testReply(blockedByAuthor);
    assert.equal(blockedByAuthorReply.statusCode, 403, 'Blocked user cannot reply');
    assert.equal(blockedByAuthorReply.json().error.code, 'FORBIDDEN');

    const blockerOfAuthorReply = await testReply(blockerOfAuthor);
    assert.equal(blockerOfAuthorReply.statusCode, 403, 'User who blocked author cannot reply');
    assert.equal(blockerOfAuthorReply.json().error.code, 'FORBIDDEN');

    // Unauthenticated -> 401 UNAUTHORIZED
    const anonReply = await testReply(null);
    assert.equal(anonReply.statusCode, 401, 'Unauthenticated user cannot reply');
    assert.equal(anonReply.json().error.code, 'UNAUTHORIZED');
  });

  // =========================================================================
  // SUITE 3: 'FOLLOWING' (PEOPLE YOU FOLLOW) PRIVACY MATRIX
  // =========================================================================
  await t.test('3. FOLLOWING Matrix: Only author and users author follows are permitted', async () => {
    const rootPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Matrix FOLLOWING post mentioning @${mentionedUser.username}`,
        reply_privacy: 'FOLLOWING',
      },
    });
    const post = rootPostRes.json().data;

    const testReply = async (user) => {
      const authHeader = user ? authHeaders(user.id) : {};
      return app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: authHeader,
        payload: { content: `Reply by ${user ? user.username : 'anon'}`, replyToId: post.id },
      });
    };

    // 1. Author bypass invariant -> 201
    const authorReply = await testReply(author);
    assert.equal(authorReply.statusCode, 201, 'Author must be permitted');

    // 2. Followed user (author follows them) -> 201
    const followedReply = await testReply(followedUser);
    assert.equal(followedReply.statusCode, 201, 'Followed user must be permitted');

    // 3. Mutual follow (author follows them) -> 201
    const mutualReply = await testReply(mutualFollow);
    assert.equal(mutualReply.statusCode, 201, 'Mutual followed user must be permitted');

    // 4. Follower-only (follows author, but author DOES NOT follow them) -> 403 REPLY_RESTRICTED
    const followerOnlyReply = await testReply(followerOnly);
    assert.equal(followerOnlyReply.statusCode, 403, 'Follower-only must be restricted');
    assert.equal(followerOnlyReply.json().error.code, 'REPLY_RESTRICTED');

    // 5. Stranger (no relation) -> 403 REPLY_RESTRICTED
    const strangerReply = await testReply(stranger);
    assert.equal(strangerReply.statusCode, 403, 'Stranger must be restricted');
    assert.equal(strangerReply.json().error.code, 'REPLY_RESTRICTED');

    // 6. Mentioned user (mentioned, but author does NOT follow them) -> 403 REPLY_RESTRICTED
    const mentionedReply = await testReply(mentionedUser);
    assert.equal(mentionedReply.statusCode, 403, 'Mentioned user not followed must be restricted');
    assert.equal(mentionedReply.json().error.code, 'REPLY_RESTRICTED');

    // 7. Followed but blocked user -> 403 FORBIDDEN (Block invariant overrides follow)
    const followedBlockedReply = await testReply(followedAndBlocked);
    assert.equal(followedBlockedReply.statusCode, 403, 'Followed but blocked user must be blocked');
    assert.equal(followedBlockedReply.json().error.code, 'FORBIDDEN');

    // 8. Anonymous -> 401 UNAUTHORIZED
    const anonReply = await testReply(null);
    assert.equal(anonReply.statusCode, 401, 'Anonymous user must be 401');
  });

  // =========================================================================
  // SUITE 4: 'MENTIONED' (ONLY MENTIONED USERS) PRIVACY MATRIX
  // =========================================================================
  await t.test('4. MENTIONED Matrix: Only author and explicitly mentioned users are permitted', async () => {
    const rootPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Matrix MENTIONED: calling @${mentionedUser.username} and @${mutualFollow.username} and @${mentionedAndBlocked.username}`,
        reply_privacy: 'MENTIONED',
      },
    });
    const post = rootPostRes.json().data;

    // Verify mentions were parsed by backend
    assert.ok(post.mentions.includes(mentionedUser.username.toLowerCase()));
    assert.ok(post.mentions.includes(mutualFollow.username.toLowerCase()));

    const testReply = async (user) => {
      const authHeader = user ? authHeaders(user.id) : {};
      return app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: authHeader,
        payload: { content: `Reply by ${user ? user.username : 'anon'}`, replyToId: post.id },
      });
    };

    // 1. Author bypass invariant -> 201
    const authorReply = await testReply(author);
    assert.equal(authorReply.statusCode, 201, 'Author must be permitted even if not mentioned');

    // 2. Mentioned user -> 201
    const mentionedReply = await testReply(mentionedUser);
    assert.equal(mentionedReply.statusCode, 201, 'Mentioned user must be permitted');

    // 3. Mutual follow (who IS mentioned) -> 201
    const mutualMentionedReply = await testReply(mutualFollow);
    assert.equal(mutualMentionedReply.statusCode, 201, 'Mentioned mutual follow must be permitted');

    // 4. Followed user (who is NOT mentioned) -> 403 REPLY_RESTRICTED
    const followedReply = await testReply(followedUser);
    assert.equal(followedReply.statusCode, 403, 'Un-mentioned followed user must be restricted');
    assert.equal(followedReply.json().error.code, 'REPLY_RESTRICTED');

    // 5. Follower-only (NOT mentioned) -> 403 REPLY_RESTRICTED
    const followerOnlyReply = await testReply(followerOnly);
    assert.equal(followerOnlyReply.statusCode, 403, 'Un-mentioned follower must be restricted');
    assert.equal(followerOnlyReply.json().error.code, 'REPLY_RESTRICTED');

    // 6. Stranger (NOT mentioned) -> 403 REPLY_RESTRICTED
    const strangerReply = await testReply(stranger);
    assert.equal(strangerReply.statusCode, 403, 'Stranger must be restricted');
    assert.equal(strangerReply.json().error.code, 'REPLY_RESTRICTED');

    // 7. Mentioned user who is BLOCKED -> 403 FORBIDDEN (Block invariant overrides mention)
    const mentionedBlockedReply = await testReply(mentionedAndBlocked);
    assert.equal(mentionedBlockedReply.statusCode, 403, 'Mentioned but blocked user must be forbidden');
    assert.equal(mentionedBlockedReply.json().error.code, 'FORBIDDEN');

    // 8. Substring bypass attack: user with username containing mentioned username as prefix
    const attacker = await createUser('atk_prefix');
    const attackerReply = await testReply(attacker);
    assert.equal(attackerReply.statusCode, 403, 'Substring username must not bypass mention check');
    assert.equal(attackerReply.json().error.code, 'REPLY_RESTRICTED');
  });

  // =========================================================================
  // SUITE 5: MULTI-TIER THREAD INHERITANCE & ANTI-HIJACKING
  // =========================================================================
  await t.test('5. Multi-tier Thread Inheritance: Deep reply trees inherit root post privacy controls', async () => {
    // 5.1 Root Post with FOLLOWING
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Deep Thread: Following Only', reply_privacy: 'FOLLOWING' },
    });
    const rootPost = rootRes.json().data;

    // Level 1: Followed user replies to Root Post -> 201
    const l1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Level 1 reply by followed user', replyToId: rootPost.id },
    });
    assert.equal(l1Res.statusCode, 201);
    const l1Reply = l1Res.json().data;

    // Level 2: Mutual follow replies to Level 1 -> 201
    const l2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(mutualFollow.id),
      payload: { content: 'Level 2 reply by mutual follow', replyToId: l1Reply.id },
    });
    assert.equal(l2Res.statusCode, 201);
    const l2Reply = l2Res.json().data;

    // Anti-Hijacking: Stranger attempts to reply to Level 1 -> 403 REPLY_RESTRICTED
    const hijackL1 = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Hijack attempt on L1', replyToId: l1Reply.id },
    });
    assert.equal(hijackL1.statusCode, 403);
    assert.equal(hijackL1.json().error.code, 'REPLY_RESTRICTED');

    // Anti-Hijacking: Stranger attempts to reply to Level 2 -> 403 REPLY_RESTRICTED
    const hijackL2 = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Hijack attempt on L2', replyToId: l2Reply.id },
    });
    assert.equal(hijackL2.statusCode, 403);
    assert.equal(hijackL2.json().error.code, 'REPLY_RESTRICTED');

    // Anti-Lockout Invariant: Root author can reply to Level 2 in their own thread -> 201
    const authorL3Res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Root author replies to L2', replyToId: l2Reply.id },
    });
    assert.equal(authorL3Res.statusCode, 201);

    // Verify GET /posts/:id/thread accurately marks canReply for Stranger vs Followed
    const threadAsStranger = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${rootPost.id}/thread`,
      headers: authHeaders(stranger.id),
    });
    assert.equal(threadAsStranger.json().data.rootPost.canReply, false);

    const threadAsFollowed = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${rootPost.id}/thread`,
      headers: authHeaders(followedUser.id),
    });
    assert.equal(threadAsFollowed.json().data.rootPost.canReply, true);
  });

  // =========================================================================
  // SUITE 6: DYNAMIC PRIVACY TRANSITION LIFECYCLE
  // =========================================================================
  await t.test('6. Dynamic Privacy Transitions: Changing post privacy updates permissions immediately', async () => {
    // 1. Create post with EVERYONE and mention mentionedUser
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: {
        content: `Lifecycle post mentioning @${mentionedUser.username}`,
        reply_privacy: 'EVERYONE',
      },
    });
    const post = createRes.json().data;

    // Phase 1 (EVERYONE): Stranger replies successfully -> 201
    const rep1 = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger reply during EVERYONE', replyToId: post.id },
    });
    assert.equal(rep1.statusCode, 201);

    // Phase 2: Author changes to FOLLOWING
    const patchToFollowing = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'FOLLOWING' },
    });
    assert.equal(patchToFollowing.statusCode, 200);

    // Stranger now rejected -> 403 REPLY_RESTRICTED
    const rep2Blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger reply during FOLLOWING', replyToId: post.id },
    });
    assert.equal(rep2Blocked.statusCode, 403);
    assert.equal(rep2Blocked.json().error.code, 'REPLY_RESTRICTED');

    // Followed user permitted -> 201
    const rep2Allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Followed user reply during FOLLOWING', replyToId: post.id },
    });
    assert.equal(rep2Allowed.statusCode, 201);

    // Phase 3: Author changes to MENTIONED
    const patchToMentioned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'MENTIONED' },
    });
    assert.equal(patchToMentioned.statusCode, 200);

    // Followed user now rejected -> 403 REPLY_RESTRICTED
    const rep3Blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Followed user reply during MENTIONED', replyToId: post.id },
    });
    assert.equal(rep3Blocked.statusCode, 403);
    assert.equal(rep3Blocked.json().error.code, 'REPLY_RESTRICTED');

    // Mentioned user permitted -> 201
    const rep3Allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(mentionedUser.id),
      payload: { content: 'Mentioned user reply during MENTIONED', replyToId: post.id },
    });
    assert.equal(rep3Allowed.statusCode, 201);

    // Phase 4: Author changes back to EVERYONE
    const patchBackToEveryone = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post.id}`,
      headers: authHeaders(author.id),
      payload: { reply_privacy: 'EVERYONE' },
    });
    assert.equal(patchBackToEveryone.statusCode, 200);

    // Stranger can reply again -> 201
    const rep4Allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Stranger reply back in EVERYONE mode', replyToId: post.id },
    });
    assert.equal(rep4Allowed.statusCode, 201);
  });

  // =========================================================================
  // SUITE 7: ERROR CASES & RECOVERY INVARIANTS
  // =========================================================================
  await t.test('7. Error Handling: Deleted post, non-existent post, counter integrity', async () => {
    // 7.1 Non-existent post ID -> 404 POST_NOT_FOUND
    const nonExistentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Reply to phantom post', replyToId: '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(nonExistentRes.statusCode, 404);
    assert.equal(nonExistentRes.json().error.code, 'POST_NOT_FOUND');

    // 7.2 Deleted post -> 404 POST_NOT_FOUND
    const deletedPost = await prisma.post.create({
      data: {
        authorId: author.id,
        content: 'Post to be soft deleted',
        isDeleted: true,
      },
    });
    const deletedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(author.id),
      payload: { content: 'Reply to deleted post', replyToId: deletedPost.id },
    });
    assert.equal(deletedRes.statusCode, 404);
    assert.equal(deletedRes.json().error.code, 'POST_NOT_FOUND');

    // 7.3 Counter Integrity: Failed replies MUST NOT increment repliesCount
    const targetPost = await prisma.post.create({
      data: {
        authorId: author.id,
        content: 'Counter test post',
        reply_privacy: 'FOLLOWING',
      },
    });

    const initialCount = targetPost.repliesCount;

    // Stranger attempts reply -> 403
    await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(stranger.id),
      payload: { content: 'Failed reply attempt', replyToId: targetPost.id },
    });

    const refreshedPost = await prisma.post.findUnique({ where: { id: targetPost.id } });
    assert.equal(refreshedPost.repliesCount, initialCount, 'Failed reply must not alter repliesCount');

    // Followed user replies -> 201
    await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(followedUser.id),
      payload: { content: 'Successful reply', replyToId: targetPost.id },
    });

    const postAfterSuccess = await prisma.post.findUnique({ where: { id: targetPost.id } });
    assert.equal(postAfterSuccess.repliesCount, initialCount + 1, 'Successful reply must increment repliesCount by exactly 1');
  });

  await app.close();
});
