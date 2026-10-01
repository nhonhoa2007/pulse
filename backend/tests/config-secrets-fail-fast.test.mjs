/**
 * SEC-03 / SEC-04 hardening tests:
 *  1. buildApp() phải fail-fast khi thiếu JWT_SECRET hoặc COOKIE_SECRET.
 *  2. VAPID keypair nạp từ ENV phải ổn định giữa các lần khởi tạo WebPushService
 *     (không còn sinh key in-memory mỗi lần restart).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../dist/app.js';
import { MissingSecretError } from '../dist/config/Secrets.js';
import { WebPushService } from '../dist/modules/push/WebPushService.js';

test('SEC-03: buildApp fails fast when JWT_SECRET is missing', async () => {
  const saved = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    await assert.rejects(
      () => buildApp(),
      (err) => err instanceof MissingSecretError && err.message.includes('JWT_SECRET')
    );
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('SEC-03: buildApp fails fast when COOKIE_SECRET is missing', async () => {
  const saved = process.env.COOKIE_SECRET;
  try {
    delete process.env.COOKIE_SECRET;
    await assert.rejects(
      () => buildApp(),
      (err) => err instanceof MissingSecretError && err.message.includes('COOKIE_SECRET')
    );
  } finally {
    process.env.COOKIE_SECRET = saved;
  }
});

test('SEC-03: no hardcoded fallback secrets remain in dist build', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const appJs = fs.readFileSync(
    path.join(process.cwd(), 'dist', 'app.js'),
    'utf8'
  );
  assert.equal(appJs.includes('pulse-secret-key-2026-production-token'), false);
  assert.equal(appJs.includes('pulse-cookie-secret-key-123456789'), false);
});

test('SEC-04: VAPID keypair loaded from ENV is stable across service instantiations', () => {
  const serviceA = new WebPushService();
  const serviceB = new WebPushService();
  const keyA = serviceA.getVapidPublicKey();
  const keyB = serviceB.getVapidPublicKey();

  assert.equal(keyA.length, 87, 'uncompressed P-256 public key must be 65 bytes base64url (87 chars)');
  assert.equal(keyB, keyA, 'key must be identical across restarts (persisted via ENV)');

  const vapidTokenA = serviceA.generateVapidToken('https://push.example.com');
  const vapidTokenB = serviceB.generateVapidToken('https://push.example.com');
  const audA = JSON.parse(Buffer.from(vapidTokenA.split('.')[1], 'base64url').toString('utf8')).aud;
  const audB = JSON.parse(Buffer.from(vapidTokenB.split('.')[1], 'base64url').toString('utf8')).aud;
  assert.equal(audA, 'https://push.example.com');
  assert.equal(audB, 'https://push.example.com');
});

test('SEC-04: WebPushService rejects malformed VAPID key encoding', () => {
  const savedPub = process.env.VAPID_PUBLIC_KEY;
  try {
    process.env.VAPID_PUBLIC_KEY = 'not-a-valid-key-encoding!!!';
    assert.throws(() => new WebPushService(), /Invalid VAPID key encoding/);
  } finally {
    process.env.VAPID_PUBLIC_KEY = savedPub;
  }
});
