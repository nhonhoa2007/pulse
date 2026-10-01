/**
 * PKG-04: Report & Moderation System.
 *
 * Invariants:
 *  - POST /reports yêu cầu auth; validate targetType/reason; chặn trùng báo cáo
 *    của cùng reporter (400 ALREADY_REPORTED); target phải tồn tại.
 *  - autoScore heuristic: SPAM + link flood + duplicate content + multiple reporters.
 *  - Admin endpoints: non-admin → 403; queue sort autoScore DESC.
 *  - Resolve: DELETE_POST gỡ bài; SUSPEND_USER đình chỉ + thu hồi phiên;
 *    suspended không login (400 ACCOUNT_SUSPENDED) và không đăng bài (403);
 *    double-resolve → 400 ALREADY_RESOLVED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

async function makeUser(prefix, extra = {}) {
  return prisma.user.create({
    data: {
      username: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`,
      email: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}@test.local`,
      displayName: `Mod ${prefix}`,
      ...extra,
    },
  });
}

test('PKG-04: report creation — auth, validation, dedup, target existence', async () => {
  const app = await buildApp();
  const reporter = await makeUser('rep_user');
  const author = await makeUser('rep_author');
  const post = await prisma.post.create({
    data: { authorId: author.id, content: 'Bài viết bình thường để báo cáo' },
  });
  const h = authHeaders(reporter.id, reporter.username);

  // Không auth → 401
  const unauth = await app.inject({ method: 'POST', url: '/api/v1/reports', payload: {} });
  assert.equal(unauth.statusCode, 401);

  // reason sai → 400
  const badReason = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: h,
    payload: { targetType: 'POST', targetId: post.id, reason: 'JUST_BECAUSE' },
  });
  assert.equal(badReason.statusCode, 400);
  assert.equal(badReason.json().error.code, 'INVALID_REASON');

  // target không tồn tại → 400 TARGET_NOT_FOUND
  const badTarget = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: h,
    payload: { targetType: 'POST', targetId: 'khong-ton-tai', reason: 'SPAM' },
  });
  assert.equal(badTarget.statusCode, 400);
  assert.equal(badTarget.json().error.code, 'TARGET_NOT_FOUND');

  // Hợp lệ → 201 + autoScore
  const ok = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: h,
    payload: { targetType: 'POST', targetId: post.id, reason: 'SPAM', details: 'Quảng cáo lặp lại' },
  });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal(ok.json().data.report.status, 'PENDING');
  assert.ok(ok.json().data.report.autoScore >= 40, 'SPAM reason phải +40');

  // Trùng báo cáo → 400 ALREADY_REPORTED
  const dup = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: h,
    payload: { targetType: 'POST', targetId: post.id, reason: 'SPAM' },
  });
  assert.equal(dup.statusCode, 400);
  assert.equal(dup.json().error.code, 'ALREADY_REPORTED');

  await prisma.user.deleteMany({ where: { id: { in: [reporter.id, author.id] } } });
  await app.close();
});

test('PKG-04: autoScore — link flood và multiple reporters cộng điểm', async () => {
  const app = await buildApp();
  const author = await makeUser('score_author');
  const spamPost = await prisma.post.create({
    data: {
      authorId: author.id,
      content: `Mua ngay http://a.com http://b.com http://c.com giảm giá số ${timestamp}`,
    },
  });

  const r1 = await makeUser('score_r1');
  const r2 = await makeUser('score_r2');
  const r3 = await makeUser('score_r3');

  await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: authHeaders(r1.id, r1.username),
    payload: { targetType: 'POST', targetId: spamPost.id, reason: 'SPAM' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: authHeaders(r2.id, r2.username),
    payload: { targetType: 'POST', targetId: spamPost.id, reason: 'SPAM' },
  });
  const third = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: authHeaders(r3.id, r3.username),
    payload: { targetType: 'POST', targetId: spamPost.id, reason: 'SPAM' },
  });

  // SPAM(40) + link_flood(30) + multiple_reporters(>=3 → +30) = 100 (clamp)
  assert.equal(third.json().data.report.autoScore, 100);
  assert.ok(third.json().data.report.autoLabels.includes('link_flood'));
  assert.ok(third.json().data.report.autoLabels.includes('multiple_reporters'));

  await prisma.user.deleteMany({ where: { id: { in: [author.id, r1.id, r2.id, r3.id] } } });
  await app.close();
});

test('PKG-04: admin queue — non-admin bị chặn 403, admin sort theo autoScore', async () => {
  const app = await buildApp();
  const normal = await makeUser('adm_normal');
  const admin = await makeUser('adm_admin', { isAdmin: true });

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/reports',
    headers: authHeaders(normal.id, normal.username),
  });
  assert.equal(forbidden.statusCode, 403);

  const unauth = await app.inject({ method: 'GET', url: '/api/v1/admin/reports' });
  assert.equal(unauth.statusCode, 401);

  const ok = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/reports?status=PENDING&limit=10',
    headers: authHeaders(admin.id, admin.username),
  });
  assert.equal(ok.statusCode, 200);
  const reports = ok.json().data.reports;
  assert.ok(Array.isArray(reports));
  // Sort giảm dần theo autoScore
  for (let i = 1; i < reports.length; i++) {
    assert.ok(reports[i - 1].autoScore >= reports[i].autoScore, 'queue phải sort autoScore DESC');
  }

  await prisma.user.deleteMany({ where: { id: { in: [normal.id, admin.id] } } });
  await app.close();
});

test('PKG-04: resolve — DELETE_POST gỡ bài, double-resolve chặn', async () => {
  const app = await buildApp();
  const admin = await makeUser('res_admin', { isAdmin: true });
  const reporter = await makeUser('res_reporter');
  const author = await makeUser('res_author');
  const post = await prisma.post.create({
    data: { authorId: author.id, content: 'Bài vi phạm sẽ bị gỡ' },
  });

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: authHeaders(reporter.id, reporter.username),
    payload: { targetType: 'POST', targetId: post.id, reason: 'SPAM' },
  });
  const reportId = create.json().data.report.id;

  // Resolve DELETE_POST
  const resolve = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/reports/${reportId}/resolve`,
    headers: authHeaders(admin.id, admin.username),
    payload: { action: 'DELETE_POST', note: 'Xác nhận spam' },
  });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json().data.report.status, 'RESOLVED');

  const postAfter = await prisma.post.findUnique({ where: { id: post.id } });
  assert.equal(postAfter.isDeleted, true, 'bài viết phải bị gỡ (isDeleted)');
  assert.ok(resolve.json().data.report.actionTaken.includes('DELETE_POST'));

  // Double-resolve → 400
  const again = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/reports/${reportId}/resolve`,
    headers: authHeaders(admin.id, admin.username),
    payload: { action: 'DISMISS' },
  });
  assert.equal(again.statusCode, 400);
  assert.equal(again.json().error.code, 'ALREADY_RESOLVED');

  await prisma.user.deleteMany({ where: { id: { in: [admin.id, reporter.id, author.id] } } });
  await app.close();
});

test('PKG-04: SUSPEND_USER đình chỉ tài khoản — chặn login và publish', async () => {
  const app = await buildApp();
  const admin = await makeUser('sus_admin', { isAdmin: true });
  const reporter = await makeUser('sus_reporter');
  const bad = await makeUser('sus_bad');
  const h = authHeaders(bad.id, bad.username);
  // Ghi lại password để test login (đặt qua update trực tiếp)
  const bcrypt = (await import('bcryptjs')).default;
  await prisma.user.update({
    where: { id: bad.id },
    data: { passwordHash: bcrypt.hashSync('Passw0rd!123', 10) },
  });

  const report = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: authHeaders(reporter.id, reporter.username),
    payload: { targetType: 'USER', targetId: bad.id, reason: 'HARASSMENT' },
  });
  const reportId = report.json().data.report.id;

  const resolve = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/reports/${reportId}/resolve`,
    headers: authHeaders(admin.id, admin.username),
    payload: { action: 'SUSPEND_USER' },
  });
  assert.equal(resolve.statusCode, 200, resolve.body);

  // accountStatus = SUSPENDED + refresh tokens revoked
  const after = await prisma.user.findUnique({ where: { id: bad.id } });
  assert.equal(after.accountStatus, 'SUSPENDED');

  // Login bị chặn 400 ACCOUNT_SUSPENDED
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: after.username, password: 'Passw0rd!123' },
  });
  assert.equal(login.statusCode, 400);
  assert.equal(login.json().error.code, 'ACCOUNT_SUSPENDED');

  // Publish bị chặn 403
  const publish = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: h,
    payload: { content: 'spam tiếp' },
  });
  assert.equal(publish.statusCode, 403);
  assert.equal(publish.json().error.code, 'ACCOUNT_SUSPENDED');

  await prisma.user.deleteMany({ where: { id: { in: [admin.id, reporter.id, bad.id] } } });
  await app.close();
});
