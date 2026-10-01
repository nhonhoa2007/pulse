import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Hybrid Fan-Out Feed: regular user fan-out on write & celebrity fan-out on read', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  // 1. Create test users
  const regularUser = await prisma.user.create({
    data: {
      username: `regular_${timestamp}`,
      email: `regular_${timestamp}@test.local`,
      displayName: 'Regular User',
      isCelebrity: false,
    },
  });

  const celebUser = await prisma.user.create({
    data: {
      username: `celeb_${timestamp}`,
      email: `celeb_${timestamp}@test.local`,
      displayName: 'Celebrity KOL',
      isCelebrity: true,
    },
  });

  const followerUser = await prisma.user.create({
    data: {
      username: `follower_${timestamp}`,
      email: `follower_${timestamp}@test.local`,
      displayName: 'Follower User',
      isCelebrity: false,
    },
  });

  // Follower follows both regularUser and celebUser
  await app.inject({
    method: 'POST',
    url: '/api/v1/graph/follow',
    headers: { 'x-user-id': followerUser.id },
    payload: { targetUserId: regularUser.id },
  });

  await app.inject({
    method: 'POST',
    url: '/api/v1/graph/follow',
    headers: { 'x-user-id': followerUser.id },
    payload: { targetUserId: celebUser.id },
  });

  // 2. Regular user publishes a post
  const resReg = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': regularUser.id },
    payload: { content: 'Post from regular user #hello' },
  });
  assert.equal(resReg.statusCode, 201);
  const regPost = resReg.json().data;

  // Verify regular user's post IS in follower's TimelineInbox
  const inboxItem = await prisma.timelineInbox.findFirst({
    where: {
      userId: followerUser.id,
      postId: regPost.id,
    },
  });
  assert.ok(inboxItem, 'Regular post must be fanned out on write into follower inbox');

  // 3. Celebrity publishes a post
  const resCeleb = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': celebUser.id },
    payload: { content: 'Post from celebrity KOL ✨' },
  });
  assert.equal(resCeleb.statusCode, 201);
  const celebPost = resCeleb.json().data;

  // Verify celebrity post is NOT in follower's TimelineInbox
  const celebInboxItem = await prisma.timelineInbox.findFirst({
    where: {
      userId: followerUser.id,
      postId: celebPost.id,
    },
  });
  assert.equal(celebInboxItem, null, 'Celebrity post must NOT be fanned out into follower inbox');

  // 4. Follower requests Home Feed
  const feedRes = await app.inject({
    method: 'GET',
    url: '/api/v1/feed/home',
    headers: { 'x-user-id': followerUser.id },
  });
  assert.equal(feedRes.statusCode, 200);
  const feedData = feedRes.json().data;
  assert.ok(feedData && Array.isArray(feedData.posts));

  const postIds = feedData.posts.map((p) => p.id);
  assert.ok(postIds.includes(regPost.id), 'Home feed must include regular user post');
  assert.ok(postIds.includes(celebPost.id), 'Home feed must include celebrity post via fan-out on read');

  // Verify posts are sorted descending by createdAt
  for (let i = 0; i < feedData.posts.length - 1; i++) {
    const cur = new Date(feedData.posts[i].createdAt).getTime();
    const next = new Date(feedData.posts[i + 1].createdAt).getTime();
    assert.ok(cur >= next, 'Posts must be sorted descending by createdAt');
  }

  await app.close();
});
