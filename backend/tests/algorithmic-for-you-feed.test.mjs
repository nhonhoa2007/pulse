import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';

test('TASK-20 Pillar 1: Algorithmic "For You" Recommendation Feed Test Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Create reader user
  const reader = await prisma.user.create({
    data: {
      username: `foryou_reader_${timestamp}`,
      email: `foryou_reader_${timestamp}@pulse.local`,
      displayName: 'For You Reader',
    },
  });

  const createdUserIds = [reader.id];
  const createdPostIds = [];

  t.after(async () => {
    // Teardown
    if (createdPostIds.length > 0) {
      await prisma.like.deleteMany({ where: { postId: { in: createdPostIds } } });
      await prisma.repost.deleteMany({ where: { postId: { in: createdPostIds } } });
      await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } });
    }
    await prisma.follow.deleteMany({
      where: {
        OR: [{ followerId: { in: createdUserIds } }, { followingId: { in: createdUserIds } }],
      },
    });
    await prisma.block.deleteMany({
      where: {
        OR: [{ blockerId: { in: createdUserIds } }, { blockedId: { in: createdUserIds } }],
      },
    });
    await prisma.userMute.deleteMany({
      where: {
        OR: [{ muterId: { in: createdUserIds } }, { mutedId: { in: createdUserIds } }],
      },
    });
    await prisma.keywordMute.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await app.close();
  });

  // Helper to create users
  async function createTestUser(prefix, extra = {}) {
    const u = await prisma.user.create({
      data: {
        username: `${prefix}_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
        email: `${prefix}_${timestamp}_${Math.random().toString(36).substring(2, 7)}@pulse.local`,
        displayName: `${prefix} User`,
        ...extra,
      },
    });
    createdUserIds.push(u.id);
    return u;
  }

  // Helper to create posts
  async function createTestPost(authorId, content, extra = {}) {
    const p = await prisma.post.create({
      data: {
        authorId,
        content,
        ...extra,
      },
    });
    createdPostIds.push(p.id);
    return p;
  }

  // -------------------------------------------------------------------------
  // 1. Heuristic Scoring Formula Verification
  // -------------------------------------------------------------------------
  await t.test('1. Heuristic Scoring Formula: high engagement ranks higher than low engagement', async () => {
    const authorA = await createTestUser('he_auth_a');
    const authorB = await createTestUser('he_auth_b');

    const now = new Date();
    // High engagement: L=150, R=50, C=20, Q=10, V=1000
    const highEngagePost = await createTestPost(authorA.id, 'High engagement algorithmic post', {
      likesCount: 150,
      repostsCount: 50,
      repliesCount: 20,
      quotesCount: 10,
      viewsCount: 1000,
    });

    // Medium-low engagement: L=80, R=0, C=0, Q=0, V=10
    const lowEngagePost = await createTestPost(authorB.id, 'Low engagement post', {
      likesCount: 80,
      repostsCount: 0,
      repliesCount: 0,
      quotesCount: 0,
      viewsCount: 10,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(reader.id),
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    const posts = body.data.posts;

    const highIndex = posts.findIndex((p) => p.id === highEngagePost.id);
    const lowIndex = posts.findIndex((p) => p.id === lowEngagePost.id);

    assert.ok(highIndex !== -1, 'High engagement post must be in feed');
    assert.ok(lowIndex !== -1, 'Low engagement post must be in feed');
    assert.ok(
      highIndex < lowIndex,
      `High engagement post (index ${highIndex}) must rank above low engagement post (index ${lowIndex})`
    );
  });

  // -------------------------------------------------------------------------
  // 2. Gravity Time Decay Verification
  // -------------------------------------------------------------------------
  await t.test('2. Gravity Time Decay: fresh post ranks above older post with same engagement', async () => {
    const authorFresh = await createTestUser('decay_fresh_author');
    const authorOld = await createTestUser('decay_old_author');

    // Fresh post: created recently
    const freshPost = await createTestPost(authorFresh.id, 'Fresh post 10m ago', {
      likesCount: 150,
    });

    // Old post: created 24 hours ago (decay factor (24+2)^1.5 = 132.57 vs (0.16+2)^1.5 = 3.17)
    const oldPost = await createTestPost(authorOld.id, 'Old post 24h ago', {
      likesCount: 150,
    });
    // Shift oldPost back by 2 hours in DB timestamp (decay factor (2+2)^1.5 = 8.0 vs (0.1+2)^1.5 = 3.04)
    await prisma.$executeRaw`UPDATE "Post" SET "createdAt" = "createdAt" - INTERVAL '2 hours' WHERE id = ${oldPost.id}`;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(reader.id),
    });

    assert.equal(res.statusCode, 200);
    const posts = res.json().data.posts;

    const freshIdx = posts.findIndex((p) => p.id === freshPost.id);
    const oldIdx = posts.findIndex((p) => p.id === oldPost.id);

    assert.ok(freshIdx !== -1, 'Fresh post must be in feed');
    assert.ok(oldIdx !== -1, 'Old post must be in feed');
    assert.ok(
      freshIdx < oldIdx,
      `Fresh post (${freshIdx}) must rank higher than 24h old post (${oldIdx}) due to gravity time decay`
    );
  });

  // -------------------------------------------------------------------------
  // 3. Social Affinity Multipliers (Followed 2.0x, FoF 1.5x, Celebrity 1.2x, Stranger 1.0x)
  // -------------------------------------------------------------------------
  await t.test('3. Social Affinity Multipliers rank Followed > FoF > Celebrity > Stranger', async () => {
    const followedAuthor = await createTestUser('aff_followed');
    const fofAuthor = await createTestUser('aff_fof');
    const friendIntermediate = await createTestUser('aff_intermediate');
    const celebrityAuthor = await createTestUser('aff_celeb', { isCelebrity: true });
    const strangerAuthor = await createTestUser('aff_stranger');

    // Reader follows followedAuthor and friendIntermediate
    await prisma.follow.create({
      data: { followerId: reader.id, followingId: followedAuthor.id },
    });
    await prisma.follow.create({
      data: { followerId: reader.id, followingId: friendIntermediate.id },
    });
    // friendIntermediate follows fofAuthor (making fofAuthor a Friend-of-Friend to reader)
    await prisma.follow.create({
      data: { followerId: friendIntermediate.id, followingId: fofAuthor.id },
    });

    // Create 4 posts with identical engagement metrics and default createdAt
    const postFollowed = await createTestPost(followedAuthor.id, 'Followed author post (2.0x)', {
      likesCount: 150,
    });
    const postFoF = await createTestPost(fofAuthor.id, 'FoF author post (1.5x)', {
      likesCount: 150,
    });
    const postCeleb = await createTestPost(celebrityAuthor.id, 'Celebrity author post (1.2x)', {
      likesCount: 150,
    });
    const postStranger = await createTestPost(strangerAuthor.id, 'Stranger author post (1.0x)', {
      likesCount: 150,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(reader.id),
    });

    assert.equal(res.statusCode, 200);
    const posts = res.json().data.posts;

    const idxFollowed = posts.findIndex((p) => p.id === postFollowed.id);
    const idxFoF = posts.findIndex((p) => p.id === postFoF.id);
    const idxCeleb = posts.findIndex((p) => p.id === postCeleb.id);
    const idxStranger = posts.findIndex((p) => p.id === postStranger.id);

    assert.ok(idxFollowed !== -1, 'Followed post must be present');
    assert.ok(idxFoF !== -1, 'FoF post must be present');
    assert.ok(idxCeleb !== -1, 'Celeb post must be present');
    assert.ok(idxStranger !== -1, 'Stranger post must be present');

    assert.ok(
      idxFollowed < idxFoF,
      `Followed (2.0x at ${idxFollowed}) must rank above FoF (1.5x at ${idxFoF})`
    );
    assert.ok(
      idxFoF < idxCeleb,
      `FoF (1.5x at ${idxFoF}) must rank above Celebrity (1.2x at ${idxCeleb})`
    );
    assert.ok(
      idxCeleb < idxStranger,
      `Celebrity (1.2x at ${idxCeleb}) must rank above Stranger (1.0x at ${idxStranger})`
    );
  });

  // -------------------------------------------------------------------------
  // 4. Author Diversity Penalty & 4th+ Post Exclusion
  // -------------------------------------------------------------------------
  await t.test('4. Author Diversity: 2nd post 0.6x, 3rd post 0.3x, and 4th+ post strictly dropped', async () => {
    const prolificAuthor = await createTestUser('prolific_author');
    const baseTime = new Date(Date.now() - 15 * 60 * 1000);

    // Create 5 posts from prolific author with descending engagement
    const p1 = await createTestPost(prolificAuthor.id, 'Prolific Post 1', { likesCount: 50, createdAt: baseTime });
    const p2 = await createTestPost(prolificAuthor.id, 'Prolific Post 2', { likesCount: 40, createdAt: baseTime });
    const p3 = await createTestPost(prolificAuthor.id, 'Prolific Post 3', { likesCount: 30, createdAt: baseTime });
    const p4 = await createTestPost(prolificAuthor.id, 'Prolific Post 4', { likesCount: 20, createdAt: baseTime });
    const p5 = await createTestPost(prolificAuthor.id, 'Prolific Post 5', { likesCount: 10, createdAt: baseTime });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(reader.id),
    });

    assert.equal(res.statusCode, 200);
    const posts = res.json().data.posts;
    const authorPostIdsInFeed = posts
      .filter((p) => p.author.id === prolificAuthor.id)
      .map((p) => p.id);

    // Max 3 posts allowed per author per candidate feed page
    assert.equal(
      authorPostIdsInFeed.length,
      3,
      `Author must have exactly 3 posts in feed page, found ${authorPostIdsInFeed.length}`
    );
    assert.ok(authorPostIdsInFeed.includes(p1.id), 'Top post 1 must be present');
    assert.ok(authorPostIdsInFeed.includes(p2.id), 'Top post 2 must be present');
    assert.ok(authorPostIdsInFeed.includes(p3.id), 'Top post 3 must be present');
    assert.equal(authorPostIdsInFeed.includes(p4.id), false, '4th post must be strictly excluded');
    assert.equal(authorPostIdsInFeed.includes(p5.id), false, '5th post must be strictly excluded');
  });

  // -------------------------------------------------------------------------
  // 5. Hard Privacy Filtering (Two-Way Blocks, User Mutes, Keyword Mutes, Soft-Deletes, Self-Posts)
  // -------------------------------------------------------------------------
  await t.test('5. Hard Privacy Filtering: Two-Way Blocks, Mutes, Keyword Mutes, Soft-Deletes, Self-Posts', async () => {
    const userBlockedByReader = await createTestUser('privacy_blocked_by_reader');
    const userWhoBlockedReader = await createTestUser('privacy_who_blocked_reader');
    const userMutedByReader = await createTestUser('privacy_muted_by_reader');
    const normalAuthor = await createTestUser('privacy_normal_author');

    // 1. Two-way blocks
    await prisma.block.create({
      data: { blockerId: reader.id, blockedId: userBlockedByReader.id },
    });
    await prisma.block.create({
      data: { blockerId: userWhoBlockedReader.id, blockedId: reader.id },
    });

    // 2. User mute
    await prisma.userMute.create({
      data: { muterId: reader.id, mutedId: userMutedByReader.id },
    });

    // 3. Keyword mute
    await prisma.keywordMute.create({
      data: {
        userId: reader.id,
        keyword: 'cryptoairdrop',
        matchType: 'CONTAINS',
        muteContext: 'HOME_TIMELINE',
        expiresAt: null,
      },
    });

    const now = new Date();
    // Posts to test filters
    const postBlocked1 = await createTestPost(userBlockedByReader.id, 'Post from user blocked by reader', { likesCount: 50, createdAt: now });
    const postBlocked2 = await createTestPost(userWhoBlockedReader.id, 'Post from user who blocked reader', { likesCount: 50, createdAt: now });
    const postMuted = await createTestPost(userMutedByReader.id, 'Post from muted user', { likesCount: 50, createdAt: now });
    const postKeywordMuted = await createTestPost(normalAuthor.id, 'Check out this free cryptoairdrop today!', { likesCount: 50, createdAt: now });
    const postSoftDeleted = await createTestPost(normalAuthor.id, 'This post was soft deleted', { likesCount: 50, isDeleted: true, createdAt: now });
    const postSelf = await createTestPost(reader.id, 'Reader own post should not appear in For You', { likesCount: 50, createdAt: now });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(reader.id),
    });

    assert.equal(res.statusCode, 200);
    const feedPostIds = new Set(res.json().data.posts.map((p) => p.id));

    assert.equal(feedPostIds.has(postBlocked1.id), false, 'Two-way block (reader blocked author) must be excluded');
    assert.equal(feedPostIds.has(postBlocked2.id), false, 'Two-way block (author blocked reader) must be excluded');
    assert.equal(feedPostIds.has(postMuted.id), false, 'User mute must be excluded');
    assert.equal(feedPostIds.has(postKeywordMuted.id), false, 'Keyword muted post must be excluded');
    assert.equal(feedPostIds.has(postSoftDeleted.id), false, 'Soft-deleted post must be excluded');
    assert.equal(feedPostIds.has(postSelf.id), false, 'Self-authored post must be excluded from discovery feed');
  });

  // -------------------------------------------------------------------------
  // 6. Pagination (Cursor-based Navigation)
  // -------------------------------------------------------------------------
  await t.test('6. Pagination: cursor navigation traverses scored feed without duplicates', async () => {
    // Request page 1 with limit=2
    const resPage1 = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=2',
      headers: authHeaders(reader.id),
    });

    assert.equal(resPage1.statusCode, 200);
    const page1Body = resPage1.json().data;
    assert.equal(page1Body.posts.length, 2, 'Page 1 must return 2 posts');
    assert.ok(page1Body.nextCursor, 'Page 1 must return a nextCursor');

    // Request page 2 using cursor
    const resPage2 = await app.inject({
      method: 'GET',
      url: `/api/v1/feed/for-you?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
      headers: authHeaders(reader.id),
    });

    assert.equal(resPage2.statusCode, 200);
    const page2Body = resPage2.json().data;
    assert.ok(page2Body.posts.length > 0, 'Page 2 should return subsequent posts');

    const page1Ids = new Set(page1Body.posts.map((p) => p.id));
    for (const p of page2Body.posts) {
      assert.equal(
        page1Ids.has(p.id),
        false,
        `Post ${p.id} from Page 2 must not duplicate any post from Page 1`
      );
    }
  });
});
