/**
 * PKG-09: Media Pipeline v2 — sharp processing + EXIF strip + altText registry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

function buildMultipart(fields) {
  const boundary = `----pulseBoundary${crypto.randomBytes(6).toString('hex')}`;
  const parts = [];
  for (const f of fields) {
    if (f.filename) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
            `Content-Type: ${f.type}\r\n\r\n`
        )
      );
      parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(f.value));
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${f.name}"\r\n\r\n` +
            `${f.value}\r\n`
        )
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function makeUser(prefix) {
  return prisma.user.create({
    data: {
      username: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`,
      email: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}@test.local`,
      displayName: `Media ${prefix}`,
    },
  });
}

function makeJpeg(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 56, g: 88, b: 152 } },
  })
    .withMetadata()
    .jpeg()
    .toBuffer();
}

test('PKG-09: upload requires auth', async () => {
  const app = await buildApp();
  const form = buildMultipart([
    { name: 'file', filename: 'x.jpg', type: 'image/jpeg', value: Buffer.from('fake') },
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/media/upload',
    payload: form.payload,
    headers: form.headers,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('PKG-09: jpeg → WebP, resized ≤1600, EXIF stripped, altText saved', async () => {
  const app = await buildApp();
  const user = await makeUser('media_proc');
  const h = authHeaders(user.id, user.username);

  const bigImage = await makeJpeg(3200, 2000);
  const form = buildMultipart([
    { name: 'file', filename: 'photo.jpg', type: 'image/jpeg', value: bigImage },
    { name: 'altText', value: 'Biểu đồ kiến trúc Pulse' },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/media/upload',
    payload: form.payload,
    headers: { ...h, ...form.headers },
  });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;
  assert.ok(data.url.endsWith('.webp'), 'JPEG phải được convert sang WebP');
  assert.equal(data.altText, 'Biểu đồ kiến trúc Pulse');
  assert.ok(data.width <= 1600, `width phải ≤ 1600, got ${data.width}`);
  assert.ok(data.height <= 1600);

  const filePath = path.join(uploadsDir, path.basename(data.relativeUrl));
  assert.ok(fs.existsSync(filePath));
  const meta = await sharp(filePath).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined, 'EXIF phải bị strip');

  const asset = await prisma.mediaAsset.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(asset);
  assert.equal(asset.altText, 'Biểu đồ kiến trúc Pulse');
  assert.equal(asset.mimeType, 'image/webp');

  fs.unlinkSync(filePath);
  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});

test('PKG-09: small image không bị phóng to (withoutEnlargement)', async () => {
  const app = await buildApp();
  const user = await makeUser('media_small');
  const small = await makeJpeg(120, 80);
  const form = buildMultipart([
    { name: 'file', filename: 'small.jpg', type: 'image/jpeg', value: small },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/media/upload',
    payload: form.payload,
    headers: { ...authHeaders(user.id, user.username), ...form.headers },
  });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;
  assert.equal(data.width, 120, 'giữ nguyên kích thước nhỏ');
  assert.equal(data.height, 80);

  fs.unlinkSync(path.join(uploadsDir, path.basename(data.relativeUrl)));
  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});

test('PKG-09: GIF được giữ nguyên bản gốc', async () => {
  const app = await buildApp();
  const user = await makeUser('media_gif');
  const gifBuffer = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .gif()
    .toBuffer();
  const form = buildMultipart([
    { name: 'file', filename: 'anim.gif', type: 'image/gif', value: gifBuffer },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/media/upload',
    payload: form.payload,
    headers: { ...authHeaders(user.id, user.username), ...form.headers },
  });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;
  assert.ok(data.url.endsWith('.gif'), 'GIF giữ đuôi .gif');

  fs.unlinkSync(path.join(uploadsDir, path.basename(data.relativeUrl)));
  await prisma.user.delete({ where: { id: user.id } });
  await app.close();
});
