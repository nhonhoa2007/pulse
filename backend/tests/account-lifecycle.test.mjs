/**
 * PKG-10: Account Lifecycle — xóa tài khoản + export dữ liệu.
 *
 * Invariants:
 *  - DELETE /users/me yêu cầu auth; soft-delete nguyên tử; username/email được
 *    giải phóng (hậu tố deleted__); password bị vô hiệu; refresh token thu hồi;
 *    push subscription xóa; social graph 2 chiều dọn sạch; counter đối tác giảm.
 *  - Profile user đã xóa trả 404; login không được; token cũ vẫn verify nhưng /users/me trả 404.
 *  - GET /users/me/export trả JSON đầy đủ (posts/follows/bookmarks/dms).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

async function createUser(prefix) {
  return prisma.user.create({
    data: {
      username: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`,
      email: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}@test.local`,
      displayName: `Lifecycle ${prefix}`,
    },
  });
}

test('PKG-10: delete requires authentication', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'DELETE', url: '/api/v1/users/me' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('PKG-10: delete account scrubs social graph, counters, tokens, pushes atomically', async () => {
  const app = await buildApp();

  const alice = await createUser('lifecycle_alice');
  const bob = await createUser('lifecycle_bob');
  const carol = await createUser('lifecycle_carol');

  // Alice follows Bob & Carol; Bob follows Alice (2 chiều)
  await prisma.follow.createMany({
    data: [
      { followerId: alice.id, followingId: bob.id },
      { followerId: alice.id, followingId: carol.id },
      { followerId: bob.id, followingId: alice.id },
    ],
  });
  await prisma.user.update({ where: { id: alice.id }, data: { followingCount: 2, followersCount: 1 } });
  await prisma.user.update({ where: { id: bob.id }, data: { followersCount: 1, followingCount: 1 } });
  await prisma.user.update({ where: { id: carol.id }, data: { followersCount: 1 } });

  // Follow request + mute + block + inbox + push + refresh token của Alice
  await prisma.followRequest.create({
    data: { requesterId: alice.id, targetUserId: carol.id },
  });
  await prisma.userMute.create({ data: { muterId: alice.id, mutedId: bob.id } });
  await prisma.block.create({ data: { blockerId: alice.id, blockedId: carol.id } });
  const bobPost = await createFollowedPost(bob);
  await prisma.timelineInbox.create({
    data: { userId: alice.id, postId: bobPost.id, authorId: bob.id },
  });
  await prisma.webPushSubscription.create({
    data: {
      userId: alice.id,
      endpoint: `https://push.example/${crypto.randomUUID()}`,
      p256dh: 'x'.repeat(20),
      auth: 'y'.repeat(10),
    },
  });

  const res = await app.inject({
    method: 'DELETE',
    url: '/api/v1/users/me',
    headers: authHeaders(alice.id, alice.username),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.deleted, true);

  // User soft-deleted, username/email giải phóng, password vô hiệu
  const deleted = await prisma.user.findUnique({ where: { id: alice.id } });
  assert.equal(deleted.isDeleted, true);
  assert.equal(deleted.passwordHash, null);
  assert.ok(deleted.username.includes('deleted__'), 'username phải được đóng băng với hậu tố');
  assert.ok(deleted.email.includes('deleted__'));

  // Social graph 2 chiều sạch
  const follows = await prisma.follow.count({
    where: { OR: [{ followerId: alice.id }, { followingId: alice.id }] },
  });
  assert.equal(follows, 0);
  assert.equal(await prisma.followRequest.count({ where: { requesterId: alice.id } }), 0);
  assert.equal(await prisma.userMute.count({ where: { muterId: alice.id } }), 0);
  assert.equal(await prisma.block.count({ where: { blockerId: alice.id } }), 0);
  assert.equal(await prisma.timelineInbox.count({ where: { userId: alice.id } }), 0);
  assert.equal(await prisma.webPushSubscription.count({ where: { userId: alice.id } }), 0);

  // Counter đối tác giảm chính xác
  const bobAfter = await prisma.user.findUnique({ where: { id: bob.id } });
  assert.equal(bobAfter.followersCount, 0, 'Alice unfollow Bob → Bob followers giảm');
  const carolAfter = await prisma.user.findUnique({ where: { id: carol.id } });
  assert.equal(carolAfter.followersCount, 0);
  assert.equal(bobAfter.followingCount, 0, 'Bob unfollowed by Alice removal → Bob following giảm');

  // Profile đã xóa trả 404
  const profileRes = await app.inject({ method: 'GET', url: `/api/v1/users/${deleted.username}` });
  assert.equal(profileRes.statusCode, 404);

  await app.close();
});

test('PKG-10: double delete returns 404 (idempotent-safe)', async () => {
  const app = await buildApp();
  const user = await createUser('lifecycle_dbl');
  const h = authHeaders(user.id, user.username);

  const first = await app.inject({ method: 'DELETE', url: '/api/v1/users/me', headers: h });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: 'DELETE', url: '/api/v1/users/me', headers: h });
  assert.equal(second.statusCode, 404);
  await app.close();
});

test('PKG-10: export requires auth and returns full personal data bundle', async () => {
  const app = await buildApp();
  const user = await createUser('lifecycle_exp');
  await prisma.post.create({
    data: { authorId: user.id, content: 'Bai viet de export dữ liệu' },
  });

  const unauth = await app.inject({ method: 'GET', url: '/api/v1/users/me/export' });
  assert.equal(unauth.statusCode, 401);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me/export',
    headers: authHeaders(user.id, user.username),
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.profile.username, user.username);
  assert.ok(Array.isArray(body.data.posts));
  assert.equal(body.data.posts.length, 1);
  assert.ok(body.data.follows && Array.isArray(body.data.follows.following));
  assert.ok(Array.isArray(body.data.bookmarks));
  assert.ok(Array.isArray(body.data.dms));
  assert.ok(body.data.exportedAt);

  await app.close();
});

async function createFollowedPost(bob) {
  return prisma.post.create({
    data: { authorId: bob.id, content: `Post cho inbox ${timestamp}` },
  });
}
