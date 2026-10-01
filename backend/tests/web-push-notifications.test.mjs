import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';
import { webPushService } from '../dist/modules/push/WebPushService.js';

test('TASK-20 Pillar 4: Web Push Notifications (RFC 8030 / RFC 8292 VAPID) Comprehensive Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testUser = await prisma.user.create({
    data: {
      username: `wp_tester_${timestamp}`,
      email: `wp_tester_${timestamp}@pulse.test`,
      displayName: 'WebPush Tester',
    },
  });

  // Mock HTTP Push Service server simulating Mozilla / FCM push endpoints
  let mockServerStatusCode = 201;
  let capturedAuthorizationHeader = '';
  let capturedPushPayload = '';

  const mockPushServer = http.createServer((req, res) => {
    capturedAuthorizationHeader = req.headers['authorization'] || '';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      capturedPushPayload = body;
      res.writeHead(mockServerStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: mockServerStatusCode, message: 'Mock response' }));
    });
  });

  await new Promise((resolve) => mockPushServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockPushServer.address().port;
  const mockPushEndpoint = `http://127.0.0.1:${mockPort}/push/v2/test-device-token`;

  t.after(async () => {
    await new Promise((resolve) => mockPushServer.close(resolve));
    await prisma.webPushSubscription.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. GET /api/v1/push/vapid-public-key
  // -------------------------------------------------------------------------
  await t.test('1. GET /api/v1/push/vapid-public-key returns RFC 8292 NIST P-256 public key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(typeof body.data.publicKey === 'string', 'Public key must be string');

    // Decode Base64URL to verify P-256 uncompressed EC public key
    const keyBuffer = Buffer.from(body.data.publicKey, 'base64url');
    assert.equal(
      keyBuffer.length,
      65,
      `P-256 uncompressed EC public key must be exactly 65 bytes, got ${keyBuffer.length}`
    );
    assert.equal(
      keyBuffer[0],
      0x04,
      'First byte must be 0x04 indicating uncompressed elliptic curve point'
    );
    assert.equal(
      body.data.publicKey,
      webPushService.getVapidPublicKey(),
      'Returned key must match service instance key'
    );
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/v1/push/subscriptions (Registration & Upsert)
  // -------------------------------------------------------------------------
  await t.test('2a. POST /api/v1/push/subscriptions rejects unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      payload: {
        endpoint: mockPushEndpoint,
        keys: { p256dh: 'sample-p256dh', auth: 'sample-auth' },
      },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'UNAUTHORIZED');
  });

  await t.test('2b. POST /api/v1/push/subscriptions validates missing endpoint or keys (400 BAD_REQUEST)', async () => {
    // Missing keys
    const resNoKeys = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: { endpoint: mockPushEndpoint },
    });
    assert.equal(resNoKeys.statusCode, 400);

    // Missing endpoint
    const resNoEndpoint = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: { keys: { p256dh: 'abc', auth: 'def' } },
    });
    assert.equal(resNoEndpoint.statusCode, 400);
  });

  await t.test('2c. POST /api/v1/push/subscriptions registers valid subscription and handles upsert', async () => {
    const initialPayload = {
      endpoint: mockPushEndpoint,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y1',
        auth: 'tBHItJI5svbpez7KI4CCXg1',
      },
      userAgent: 'Mozilla/5.0 Pulse Browser v1',
    };

    // First insert
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: initialPayload,
    });
    assert.equal(res1.statusCode, 201);
    const body1 = res1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.data.endpoint, mockPushEndpoint);
    assert.equal(body1.data.userId, testUser.id);
    assert.equal(body1.data.p256dh, initialPayload.keys.p256dh);

    // Re-register with updated keys & userAgent (upsert test)
    const updatedPayload = {
      endpoint: mockPushEndpoint,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y2',
        auth: 'tBHItJI5svbpez7KI4CCXg2',
      },
      userAgent: 'Mozilla/5.0 Pulse Browser v2 Updated',
    };

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: updatedPayload,
    });
    assert.equal(res2.statusCode, 201);

    // Verify exactly 1 subscription exists with updated attributes
    const count = await prisma.webPushSubscription.count({
      where: { endpoint: mockPushEndpoint },
    });
    assert.equal(count, 1, 'Subscription record must be upserted without duplication');

    const inDb = await prisma.webPushSubscription.findUnique({
      where: { endpoint: mockPushEndpoint },
    });
    assert.equal(inDb.p256dh, updatedPayload.keys.p256dh);
    assert.equal(inDb.auth, updatedPayload.keys.auth);
    assert.equal(inDb.userAgent, updatedPayload.userAgent);
  });

  // -------------------------------------------------------------------------
  // 3. RFC 8292 VAPID Token Generation & Header Inspection
  // -------------------------------------------------------------------------
  await t.test('3. RFC 8292 VAPID Token: validates ES256 JWT header, claims (aud, exp, sub), and Authorization format', async () => {
    mockServerStatusCode = 201;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/test',
      headers: authHeaders(testUser.id),
      payload: {
        title: 'RFC 8292 Compliance Check',
        body: 'Testing VAPID JWT generation',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.sent, 1, 'One push notification sent');

    // Verify Authorization Header format: 'vapid t=<token>, k=<public_key>'
    assert.ok(
      capturedAuthorizationHeader.startsWith('vapid t='),
      `Header must begin with 'vapid t=': ${capturedAuthorizationHeader}`
    );
    assert.ok(
      capturedAuthorizationHeader.includes(', k='),
      'Header must contain public key parameter ", k="'
    );

    const match = capturedAuthorizationHeader.match(/vapid t=([^,]+), k=(.+)/);
    assert.ok(match, 'Authorization header must conform to RFC 8292 vapid scheme');

    const [, token, rawPublicKey] = match;
    assert.equal(
      rawPublicKey,
      webPushService.getVapidPublicKey(),
      'k parameter must match VAPID public key'
    );

    // Verify JWT components
    const tokenParts = token.split('.');
    assert.equal(tokenParts.length, 3, 'VAPID token must be a valid 3-part compact JWS');

    const [headerB64, claimsB64] = tokenParts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));

    // Header assertions (RFC 8292 §2.1)
    assert.equal(header.typ, 'JWT');
    assert.equal(header.alg, 'ES256');

    // Claims assertions (RFC 8292 §2.2)
    assert.equal(
      claims.aud,
      `http://127.0.0.1:${mockPort}`,
      'aud claim must match the push service origin'
    );
    assert.ok(claims.exp > Date.now() / 1000, 'exp claim must be in the future');
    assert.ok(
      claims.exp <= Date.now() / 1000 + 24 * 60 * 60,
      'exp claim must not exceed 24 hours'
    );
    assert.ok(
      claims.sub.startsWith('mailto:') || claims.sub.startsWith('https://'),
      'sub claim must be a mailto: or https: URI'
    );
  });

  // -------------------------------------------------------------------------
  // 4. Auto-Pruning on HTTP 404 / 410 (Dead Endpoints)
  // -------------------------------------------------------------------------
  await t.test('4a. Auto-Pruning: cleans up expired subscription when push service returns HTTP 410 Gone', async () => {
    mockServerStatusCode = 410; // Endpoint expired / unregistered

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/test',
      headers: authHeaders(testUser.id),
      payload: { title: 'Auto-prune test 410' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.sent, 0, 'Sent count should be 0 for pruned endpoint');

    // Verify database record has been deleted
    const sub = await prisma.webPushSubscription.findUnique({
      where: { endpoint: mockPushEndpoint },
    });
    assert.equal(sub, null, 'Subscription must be auto-pruned from database on 410 Gone');
  });

  await t.test('4b. Auto-Pruning: cleans up invalid subscription when push service returns HTTP 404 Not Found', async () => {
    // Re-insert subscription
    await prisma.webPushSubscription.create({
      data: {
        userId: testUser.id,
        endpoint: mockPushEndpoint,
        p256dh: 'sample-p256dh-404',
        auth: 'sample-auth-404',
      },
    });

    mockServerStatusCode = 404; // Not Found

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/test',
      headers: authHeaders(testUser.id),
      payload: { title: 'Auto-prune test 404' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.sent, 0);

    // Verify database record has been pruned
    const sub = await prisma.webPushSubscription.findUnique({
      where: { endpoint: mockPushEndpoint },
    });
    assert.equal(sub, null, 'Subscription must be auto-pruned from database on 404 Not Found');
  });

  // -------------------------------------------------------------------------
  // 5. DELETE /api/v1/push/subscriptions (Unsubscribe)
  // -------------------------------------------------------------------------
  await t.test('5. DELETE /api/v1/push/subscriptions unregisters subscription', async () => {
    const unregisterEndpoint = `http://127.0.0.1:${mockPort}/push/unsub-${Date.now()}`;

    // Create subscription to delete
    await prisma.webPushSubscription.create({
      data: {
        userId: testUser.id,
        endpoint: unregisterEndpoint,
        p256dh: 'p256dh-to-delete',
        auth: 'auth-to-delete',
      },
    });

    // Delete request
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscriptions',
      headers: authHeaders(testUser.id),
      payload: { endpoint: unregisterEndpoint },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // Verify deleted in DB
    const sub = await prisma.webPushSubscription.findUnique({
      where: { endpoint: unregisterEndpoint },
    });
    assert.equal(sub, null, 'Deleted subscription must not exist in DB');
  });
});
