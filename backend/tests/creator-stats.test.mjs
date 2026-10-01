/**
 * PKG-14: Creator Dashboard stats.
 *  - Auth bắt buộc; tổng hợp totals/windows/topPosts từ counters thật.
 *  - windows tính theo tuổi bài viết (24h/7d/28d).
 *  - topPosts sort theo viewsCount DESC, tối đa 5 bài.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

test('PKG-14: stats requires auth', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/stats' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('PKG-14: totals, windows và topPosts đúng từ dữ liệu thật', async () => {
  const app = await buildApp();
  const user = await prisma.user.create({
    data: {
      username: `stats_${timestamp}`,
      email: `stats_${timestamp}@test.local`,
      displayName: 'Stats User',
      followersCount: 42,
      followingCount: 7,
    },
  });
  const h = authHeaders(user.id, user.username);

  const day = 24 * 3600 * 1000;
  // Bài 28 ngày tuổi: views cao nhất
  const old = await prisma.post.create({
    data: { authorId: user.id, content: 'Bài cũ viral', viewsCount: 1000, likesCount: 50 },
  });
  await prisma.post.update({
    where: { id: old.id },
    data: { createdAt: new Date(Date.now() - 20 * day) },
  });
  // Bài 3 ngày tuổi
  const mid = await prisma.post.create({
    data: { authorId: user.id, content: 'Bài tuần này', viewsCount: 200, likesCount: 20 },
  });
  await prisma.post.update({
    where: { id: mid.id },
    data: { createdAt: new Date(Date.now() - 3 * day) },
  });
  // Bài 2 giờ tuổi
  await prisma.post.create({
    data: { authorId: user.id, content: 'Bài vừa đăng', viewsCount: 50, likesCount: 5 },
  });
  // Reply không tính vào dashboard (replyToId != null)
  await prisma.post.create({
    data: { authorId: user.id, content: 'reply', replyToId: mid.id, viewsCount: 9999 },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me/stats',
    headers: h,
  });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;

  // totals: 3 post gốc (không tính reply)
  assert.equal(data.totals.posts, 3);
  assert.equal(data.totals.views, 1250);
  assert.equal(data.totals.likes, 75);
  assert.equal(data.totals.followers, 42);

  // windows
  assert.equal(data.windows.last24h.posts, 1);
  assert.equal(data.windows.last24h.views, 50);
  assert.equal(data.windows.last7d.posts, 2);
  assert.equal(data.windows.last28d.posts, 3);
  assert.equal(data.windows.last28d.views, 1250);
  assert.equal(data.windows.last28d.engagement, 6); // 75/1250*100

  // topPosts: bài 1000 views đứng đầu
  assert.equal(data.topPosts.length, 3);
  assert.equal(data.topPosts[0].id, old.id);
  assert.equal(data.topPosts[0].viewsCount, 1000);
  assert.equal(data.topPosts[0].engagementRate, 5);

  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});
