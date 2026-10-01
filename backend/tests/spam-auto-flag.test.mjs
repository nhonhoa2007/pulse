/**
 * PKG-15.2: Auto-flag spam heuristic khi đăng bài.
 *  - Nội dung thường → không tạo Report.
 *  - Link flood + duplicate + rate → Report PENDING với reporterId = null,
 *    autoScore ≥ 60, autoLabels chứa link_flood/duplicate_content.
 *  - Unique: chỉ 1 auto-flag/giờ cho cùng một bài.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

test('PKG-15: auto-flag spam — normal content không flag, spam pattern được flag', async () => {
  const app = await buildApp();
  const author = await prisma.user.create({
    data: {
      username: `spam_${timestamp}`,
      email: `spam_${timestamp}@test.local`,
      displayName: 'Spam Bot',
    },
  });
  const h = authHeaders(author.id, author.username);

  // 1. Nội dung thường → không auto-flag
  const normal = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: h,
    payload: { content: 'Bài viết bình thường về cà phê sáng' },
  });
  assert.equal(normal.statusCode, 201);
  const normalPostId = normal.json().data.id;
  const normalFlags = await prisma.report.count({
    where: { reporterId: null, targetId: normalPostId },
  });
  assert.equal(normalFlags, 0, 'nội dung thường không được flag');

  // 2. Spam: link flood + duplicate + rate
  const spamContent = `Mua ngay http://a.example http://b.example http://c.example ${timestamp}`;
  // Tạo 1 bản gốc trước (để bản kế tiếp là duplicate → +15, tổng 30+15+25=70 ≥ 60)
  await prisma.post.create({
    data: { authorId: author.id, content: spamContent, createdAt: new Date(Date.now() - 2 * 60 * 1000) },
  });
  // Đăng đủ 5 bài trong 1 phút (rate +25)
  for (let i = 0; i < 4; i++) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: h,
      payload: { content: spamContent },
    });
    assert.equal(r.statusCode, 201, `post ${i}: ${r.body}`);
  }

  const flags = await prisma.report.findMany({
    where: { reporterId: null, reason: 'SPAM' },
    orderBy: { autoScore: 'desc' },
  });
  assert.ok(flags.length >= 1, 'phải có ít nhất 1 auto-flag');
  const top = flags[0];
  assert.ok(top.autoScore >= 60, `score phải ≥ 60, got ${top.autoScore}`);
  assert.ok(top.autoLabels.includes('link_flood'), 'phải có label link_flood');
  assert.ok(top.autoLabels.includes('posting_rate'), 'phải có label posting_rate');
  assert.ok(
    top.autoLabels.includes('duplicate_content'),
    'phải có label duplicate_content (nội dung lặp trong 24h)'
  );
  assert.equal(top.status, 'PENDING');

  await prisma.user.delete({ where: { id: author.id } });
  await app.close();
});
