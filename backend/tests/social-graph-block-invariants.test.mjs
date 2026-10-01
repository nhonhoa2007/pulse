import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Social Graph Block Invariants: 2-way unfollow, 2-way inbox wipe, and privacy lockdown', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  // 1. Create User A and User B
  const userA = await prisma.user.create({
    data: {
      username: `user_a_${timestamp}`,
      email: `user_a_${timestamp}@test.local`,
      displayName: 'User A',
    },
  });

  const userB = await prisma.user.create({
    data: {
      username: `user_b_${timestamp}`,
      email: `user_b_${timestamp}@test.local`,
      displayName: 'User B',
    },
  });

  // Both follow each other
  await app.inject({
    method: 'POST',
    url: '/api/v1/graph/follow',
    headers: { 'x-user-id': userA.id },
    payload: { targetUserId: userB.id },
  });

  await app.inject({
    method: 'POST',
    url: '/api/v1/graph/follow',
    headers: { 'x-user-id': userB.id },
    payload: { targetUserId: userA.id },
  });

  // Verify counters before block
  const uABefore = await prisma.user.findUnique({ where: { id: userA.id } });
  const uBBefore = await prisma.user.findUnique({ where: { id: userB.id } });
  assert.equal(uABefore.followingCount, 1);
  assert.equal(uABefore.followersCount, 1);
  assert.equal(uBBefore.followingCount, 1);
  assert.equal(uBBefore.followersCount, 1);

  // 2. Both publish posts
  const postARes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': userA.id },
    payload: { content: 'Secret post by A' },
  });
  const postA = postARes.json().data;

  const postBRes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': userB.id },
    payload: { content: 'Secret post by B' },
  });
  const postB = postBRes.json().data;

  // Verify inboxes populated
  const inboxBHasA = await prisma.timelineInbox.findFirst({
    where: { userId: userB.id, postId: postA.id },
  });
  const inboxAHasB = await prisma.timelineInbox.findFirst({
    where: { userId: userA.id, postId: postB.id },
  });
  assert.ok(inboxBHasA, 'Inbox of B must contain A post before block');
  assert.ok(inboxAHasB, 'Inbox of A must contain B post before block');

  // 3. User A blocks User B
  const blockRes = await app.inject({
    method: 'POST',
    url: '/api/v1/graph/block',
    headers: { 'x-user-id': userA.id },
    payload: { targetUserId: userB.id },
  });
  assert.equal(blockRes.statusCode, 200);
  assert.equal(blockRes.json().data.blocked, true);

  // 4. Invariant Verification:
  // 4a. Follow records wiped in BOTH directions
  const follows = await prisma.follow.findMany({
    where: {
      OR: [
        { followerId: userA.id, followingId: userB.id },
        { followerId: userB.id, followingId: userA.id },
      ],
    },
  });
  assert.equal(follows.length, 0, 'All follow relationships between A and B must be wiped 2-way');

  // 4b. Timeline Inboxes wiped in BOTH directions
  const inboxesRemaining = await prisma.timelineInbox.findMany({
    where: {
      OR: [
        { userId: userA.id, authorId: userB.id },
        { userId: userB.id, authorId: userA.id },
      ],
    },
  });
  assert.equal(inboxesRemaining.length, 0, 'Timeline inbox items must be wiped 2-way');

  // 4c. Follower and Following counts adjusted accurately
  const uAAfter = await prisma.user.findUnique({ where: { id: userA.id } });
  const uBAfter = await prisma.user.findUnique({ where: { id: userB.id } });
  assert.equal(uAAfter.followingCount, 0, 'User A following count must be 0');
  assert.equal(uAAfter.followersCount, 0, 'User A followers count must be 0');
  assert.equal(uBAfter.followingCount, 0, 'User B following count must be 0');
  assert.equal(uBAfter.followersCount, 0, 'User B followers count must be 0');

  // 4d. Privacy Invariant: Blocked user B cannot view A's profile (404)
  const bViewsAProfile = await app.inject({
    method: 'GET',
    url: `/api/v1/users/${userA.username}`,
    headers: { 'x-user-id': userB.id },
  });
  assert.equal(bViewsAProfile.statusCode, 404, 'Blocked user viewing blocker profile must return 404');

  // 4e. Privacy Invariant: Blocked user B cannot view A's post (404)
  const bViewsAPost = await app.inject({
    method: 'GET',
    url: `/api/v1/posts/${postA.id}`,
    headers: { 'x-user-id': userB.id },
  });
  assert.equal(bViewsAPost.statusCode, 404, 'Blocked user viewing blocker post must return 404');

  // 4f. Blocker A viewing B's profile sees isBlocked = true
  const aViewsBProfile = await app.inject({
    method: 'GET',
    url: `/api/v1/users/${userB.username}`,
    headers: { 'x-user-id': userA.id },
  });
  assert.equal(aViewsBProfile.statusCode, 200);
  assert.equal(aViewsBProfile.json().data.isBlocked, true);

  // 5. User A unblocks User B
  const unblockRes = await app.inject({
    method: 'POST',
    url: '/api/v1/graph/unblock',
    headers: { 'x-user-id': userA.id },
    payload: { targetUserId: userB.id },
  });
  assert.equal(unblockRes.statusCode, 200);
  assert.equal(unblockRes.json().data.unblocked, true);

  await app.close();
});
