import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Smart Notification Aggregator: 24h aggregation window and dynamic actor summary', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  // 1. Create target author and 4 likers
  const author = await prisma.user.create({
    data: {
      username: `notif_author_${timestamp}`,
      email: `notif_author_${timestamp}@test.local`,
      displayName: 'Tác giả',
    },
  });

  const userB = await prisma.user.create({
    data: {
      username: `liker_b_${timestamp}`,
      email: `liker_b_${timestamp}@test.local`,
      displayName: 'Hòa Phùng',
    },
  });

  const userC = await prisma.user.create({
    data: {
      username: `liker_c_${timestamp}`,
      email: `liker_c_${timestamp}@test.local`,
      displayName: 'Alice Nguyễn',
    },
  });

  const userD = await prisma.user.create({
    data: {
      username: `liker_d_${timestamp}`,
      email: `liker_d_${timestamp}@test.local`,
      displayName: 'Bob Trần',
    },
  });

  const userE = await prisma.user.create({
    data: {
      username: `liker_e_${timestamp}`,
      email: `liker_e_${timestamp}@test.local`,
      displayName: 'Charlie',
    },
  });

  // 2. Author creates a post
  const postRes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': author.id },
    payload: { content: 'Exciting announcement! 🎉' },
  });
  const post = postRes.json().data;

  // 3. User B likes the post (1st like)
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post.id}/like`,
    headers: { 'x-user-id': userB.id },
  });

  let notifs = await prisma.notification.findMany({
    where: { recipientId: author.id, targetId: post.id, verb: 'LIKE' },
  });
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].aggregatedCount, 1);
  assert.equal(notifs[0].actorSummary, 'Hòa Phùng');

  // 4. User C likes the post (2nd like within 24h)
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post.id}/like`,
    headers: { 'x-user-id': userC.id },
  });

  notifs = await prisma.notification.findMany({
    where: { recipientId: author.id, targetId: post.id, verb: 'LIKE' },
  });
  assert.equal(notifs.length, 1, 'Must aggregate into single notification');
  assert.equal(notifs[0].aggregatedCount, 2);
  assert.equal(notifs[0].actorSummary, 'Alice Nguyễn và Hòa Phùng');

  // 5. User D likes the post (3rd like within 24h)
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post.id}/like`,
    headers: { 'x-user-id': userD.id },
  });

  notifs = await prisma.notification.findMany({
    where: { recipientId: author.id, targetId: post.id, verb: 'LIKE' },
  });
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].aggregatedCount, 3);
  assert.equal(notifs[0].actorSummary, 'Bob Trần, Alice Nguyễn và 1 người khác');

  // 6. User E likes the post (4th like within 24h)
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post.id}/like`,
    headers: { 'x-user-id': userE.id },
  });

  notifs = await prisma.notification.findMany({
    where: { recipientId: author.id, targetId: post.id, verb: 'LIKE' },
  });
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].aggregatedCount, 4);
  assert.equal(notifs[0].actorSummary, 'Charlie, Bob Trần và 2 người khác');

  // 7. Verify GET /api/v1/notifications
  const getRes = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    headers: { 'x-user-id': author.id },
  });
  assert.equal(getRes.statusCode, 200);
  const data = getRes.json().data;
  assert.equal(data.length >= 1, true);
  const item = data.find((n) => n.targetId === post.id);
  assert.ok(item);
  assert.equal(item.aggregatedCount, 4);
  assert.equal(item.actorSummary, 'Charlie, Bob Trần và 2 người khác');

  // 8. Mark all as read
  const markRes = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/read-all',
    headers: { 'x-user-id': author.id },
  });
  assert.equal(markRes.statusCode, 200);
  assert.equal(markRes.json().data.markedCount >= 1, true);

  const updatedNotif = await prisma.notification.findUnique({
    where: { id: notifs[0].id },
  });
  assert.equal(updatedNotif.isRead, true);

  await app.close();
});
