import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';
import { webPushService } from '../dist/modules/push/WebPushService.js';

test('TASK-20 Pillar 4: Web Push Notifications (RFC 8030 / RFC 8292 VAPID) Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testUser = await prisma.user.create({
    data: {
      username: `push_tester_${timestamp}`,
      email: `push_tester_${timestamp}@test.local`,
      displayName: 'Push Tester',
    },
  });

  // Setup Mock Push Service Server to test RFC 8030 delivery & auto-pruning
  let mockStatusCode = 201;
  let lastAuthHeader = '';
  let lastBody = '';

  const mockServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers['authorization'] || '';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      lastBody = body;
      res.writeHead(mockStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: mockStatusCode }));
    });
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  const mockEndpoint = `http://127.0.0.1:${mockPort}/fcm/send/test-sub-token`;

  t.after(async () => {
    await new Promise((resolve) => mockServer.close(resolve));
    await prisma.webPushSubscription.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    await app.close();
  });

  // 1. VAPID Public Key endpoint
  await t.test('1. GET /api/v1/push/vapid-public-key returns RFC 8292 NIST P-256 public key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(typeof body.data.publicKey === 'string');

    // Base64URL decoding of uncompressed P-256 public key should be 65 bytes starting with 0x04
    const pubBuf = Buffer.from(body.data.publicKey, 'base64url');
    assert.equal(pubBuf.length, 65, 'Uncompressed P-256 EC key must be 65 bytes');
    assert.equal(pubBuf[0], 0x04, 'Uncompressed EC key must start with 0x04 byte');
  });

  // 2. Register subscription
  await t.test('2a. POST /api/v1/push/subscriptions rejects unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      payload: {
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test',
        keys: { p256dh: 'BNc...', auth: 'xyz...' },
      },
    });
    assert.equal(res.statusCode, 401);
  });

  await t.test('2b. POST /api/v1/push/subscriptions registers valid subscription and handles upsert', async () => {
    const payload = {
      endpoint: mockEndpoint,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
      userAgent: 'Mozilla/5.0 Pulse Browser Tester',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload,
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.endpoint, mockEndpoint);
    assert.equal(body.data.userId, testUser.id);
    assert.equal(body.data.p256dh, payload.keys.p256dh);
    assert.equal(body.data.auth, payload.keys.auth);

    // Verify persisted in DB
    const subInDb = await prisma.webPushSubscription.findUnique({
      where: { endpoint: mockEndpoint },
    });
    assert.ok(subInDb, 'Subscription must exist in DB');
  });

  // 3. VAPID Header verification & Delivery
  await t.test('3. POST /api/v1/push/test delivers notification with valid RFC 8292 VAPID header', async () => {
    mockStatusCode = 201;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/test',
      headers: authHeaders(testUser.id),
      payload: { title: 'Test Title', body: 'Test Message' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.sent, 1);

    // Verify VAPID Authorization header sent to mock push service
    assert.ok(lastAuthHeader.startsWith('vapid t='), `Auth header must start with 'vapid t=': ${lastAuthHeader}`);
    assert.ok(lastAuthHeader.includes(', k='), 'Auth header must include , k=');

    // Extract JWT from vapid header
    const match = lastAuthHeader.match(/vapid t=([^,]+), k=(.+)/);
    assert.ok(match, 'Must match vapid header pattern');
    const jwtToken = match[1];
    const publicKeyB64 = match[2];

    assert.equal(publicKeyB64, webPushService.getVapidPublicKey());

    const [headerB64, payloadB64] = jwtToken.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    assert.equal(header.alg, 'ES256');
    assert.equal(header.typ, 'JWT');
    assert.equal(claims.aud, `http://127.0.0.1:${mockPort}`);
    assert.ok(claims.exp > Date.now() / 1000);
    assert.ok(claims.sub);
  });

  // 4. Auto-Pruning invariant on HTTP 404 / 410
  await t.test('4. Auto-Pruning: Web push service deletes subscription when server returns 410 Gone', async () => {
    mockStatusCode = 410; // Endpoint expired / unregistered

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/test',
      headers: authHeaders(testUser.id),
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.sent, 0);

    // Verify subscription was pruned from database
    const subAfterPruning = await prisma.webPushSubscription.findUnique({
      where: { endpoint: mockEndpoint },
    });
    assert.equal(subAfterPruning, null, 'Subscription must be automatically pruned on 410 Gone');
  });

  // 5. Unsubscribe endpoint
  await t.test('5. DELETE /api/v1/push/subscriptions unregisters subscription', async () => {
    // Re-register
    const endpointToDelete = `https://example.com/push/active-sub-to-delete-${Date.now()}`;
    await prisma.webPushSubscription.create({
      data: {
        userId: testUser.id,
        endpoint: endpointToDelete,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: { endpoint: endpointToDelete },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);

    const deleted = await prisma.webPushSubscription.findUnique({
      where: { endpoint: endpointToDelete },
    });
    assert.equal(deleted, null);
  });
});
