/**
 * PKG-01: OpenGraph Link Preview.
 *  - Auth bắt buộc; url bắt buộc; protocol http/https.
 *  - Mock server trả HTML có OG tags → service extract đúng title/description/image.
 *  - SSRF: URL nội bộ/metadata bị chặn 400 SSRF_BLOCKED.
 *  - Cache: lần gọi thứ 2 không hit mock server (server đóng → vẫn trả kết quả).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { linkPreviewService } from '../src/modules/linkpreview/LinkPreviewService.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

function startMockServer(html, onClose) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    server.on('close', onClose);
  });
}

test('PKG-01: link preview requires auth and valid url', async () => {
  const app = await buildApp();
  const unauth = await app.inject({ method: 'GET', url: '/api/v1/link-preview?url=https://example.com' });
  assert.equal(unauth.statusCode, 401);

  const user = await prisma.user.create({
    data: {
      username: `lp_${timestamp}`,
      email: `lp_${timestamp}@test.local`,
      displayName: 'LP User',
    },
  });
  const h = authHeaders(user.id, user.username);

  const missing = await app.inject({ method: 'GET', url: '/api/v1/link-preview', headers: h });
  assert.equal(missing.statusCode, 400);

  const invalid = await app.inject({
    method: 'GET',
    url: '/api/v1/link-preview?url=' + encodeURIComponent('not-a-url'),
    headers: h,
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_URL');

  const ftp = await app.inject({
    method: 'GET',
    url: '/api/v1/link-preview?url=' + encodeURIComponent('ftp://example.com/file'),
    headers: h,
  });
  assert.equal(ftp.statusCode, 400);

  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});

test('PKG-01: extracts OG metadata from external HTML and caches result', async () => {
  // Cho phép mock server private CHO RIÊNG test này; cleanup ngay sau dùng xong.
  process.env.LINK_PREVIEW_ALLOW_PRIVATE_MOCK = '1';
  const app = await buildApp();
  const user = await prisma.user.create({
    data: {
      username: `lp2_${timestamp}`,
      email: `lp2_${timestamp}@test.local`,
      displayName: 'LP User 2',
    },
  });
  const h = authHeaders(user.id, user.username);

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Bài viết hay về Kiến trúc">
    <meta property="og:description" content="Mô tả chi tiết &amp; đầy đủ">
    <meta property="og:image" content="/img/cover.jpg">
    <meta property="og:site_name" content="Tech Blog">
    <meta name="theme-color" content="#385898">
    <title>Fallback Title</title>
  </head><body>nội dung</body></html>`;

  let requestCount = 0;
  const { server, port } = await startMockServer(html, () => {});
  const originalFetch = server.emit.bind(server);
  server.on('request', () => {
    requestCount++;
  });
  void originalFetch;

  const url = `http://127.0.0.1:${port}/bai-viet`;
  linkPreviewService.clearCache();
  const res1 = await app.inject({
    method: 'GET',
    url: `/api/v1/link-preview?url=${encodeURIComponent(url)}`,
    headers: h,
  });
  assert.equal(res1.statusCode, 200);
  const data = res1.json().data;
  assert.ok(data, 'phải trả preview data');
  assert.equal(data.title, 'Bài viết hay về Kiến trúc');
  assert.equal(data.description, 'Mô tả chi tiết & đầy đủ');
  assert.equal(data.image, `http://127.0.0.1:${port}/img/cover.jpg`);
  assert.equal(data.siteName, 'Tech Blog');
  assert.equal(data.themeColor, '#385898');
  assert.equal(data.domain, '127.0.0.1');

  const countAfterFirst = requestCount;
  const res2 = await app.inject({
    method: 'GET',
    url: `/api/v1/link-preview?url=${encodeURIComponent(url)}`,
    headers: h,
  });
  assert.equal(res2.json().data.title, data.title);
  assert.equal(requestCount, countAfterFirst, 'lần 2 phải hit cache, không fetch lại');

  server.close();
  delete process.env.LINK_PREVIEW_ALLOW_PRIVATE_MOCK;
  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});

test('PKG-01: SSRF guard blocks internal and metadata URLs', async () => {
  const app = await buildApp();
  const user = await prisma.user.create({
    data: {
      username: `lp3_${timestamp}`,
      email: `lp3_${timestamp}@test.local`,
      displayName: 'LP User 3',
    },
  });
  const h = authHeaders(user.id, user.username);

  const metadata = await app.inject({
    method: 'GET',
    url: '/api/v1/link-preview?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'),
    headers: h,
  });
  assert.equal(metadata.statusCode, 400);
  assert.equal(metadata.json().error.code, 'SSRF_BLOCKED');

  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});
