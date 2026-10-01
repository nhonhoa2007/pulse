/**
 * SEC-01: Realtime SSE stream authentication via one-time tickets.
 *
 * Invariants:
 *  - GET /realtime/stream không ticket / ticket sai / ticket hết hạn → 401, không hijack response.
 *  - POST /realtime/ticket yêu cầu JWT; trả ticket single-use TTL 30s.
 *  - Ticket đã dùng bị consume; dùng lại → 401.
 *  - Không thể tự định danh qua header x-user-id hay ?userId= nữa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { realtimeStreamController } from '../src/modules/notifications/RealtimeEventStreamController.ts';
import { authHeaders, fetchRealtimeTicket } from './helpers/auth.mjs';

const timestamp = Date.now();

test('SEC-01: stream without ticket is rejected with 401 (no hijack)', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/realtime/stream',
  });
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  await app.close();
});

test('SEC-01: stream with garbage ticket is rejected with 401', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/realtime/stream?ticket=not-a-real-ticket-123',
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('SEC-01: POST /realtime/ticket requires authentication', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/realtime/ticket' });
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.success, false);
  await app.close();
});

test('SEC-01: legacy identity channels (x-user-id, ?userId=) no longer authenticate the stream', async () => {
  const app = await buildApp();
  const user = await prisma.user.create({
    data: {
      username: `sse_legacy_${timestamp}`,
      email: `sse_legacy_${timestamp}@test.local`,
      displayName: 'SSE Legacy',
    },
  });

  const withHeader = await app.inject({
    method: 'GET',
    url: '/api/v1/realtime/stream',
    headers: authHeaders(user.id),
  });
  assert.equal(withHeader.statusCode, 401, 'x-user-id header must not open the stream');

  const withQuery = await app.inject({
    method: 'GET',
    url: `/api/v1/realtime/stream?userId=${user.id}`,
  });
  assert.equal(withQuery.statusCode, 401, 'userId query param must not open the stream');
  await app.close();
});

test('SEC-01: valid ticket opens the stream and is consumed after first use', async () => {
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const user = await prisma.user.create({
    data: {
      username: `sse_valid_${timestamp}`,
      email: `sse_valid_${timestamp}@test.local`,
      displayName: 'SSE Valid',
    },
  });

  const ticket = await fetchRealtimeTicket(app, user.id);

  let connectedPayload = '';
  const sseReq = http.request(
    {
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    },
    (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.on('data', (chunk) => {
        connectedPayload += chunk.toString();
      });
    }
  );
  sseReq.end();

  await new Promise((r) => setTimeout(r, 120));
  assert.ok(connectedPayload.includes('event: CONNECTED'), 'must receive CONNECTED handshake');
  assert.ok(connectedPayload.includes(user.id), 'handshake must bind to the ticket owner');

  sseReq.destroy();

  // Ticket is single-use: replay must be rejected even while the first socket is alive.
  const replay = await app.inject({
    method: 'GET',
    url: `/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`,
  });
  assert.equal(replay.statusCode, 401, 'ticket replay must be rejected');

  await app.close();
});

test('SEC-01: expired ticket is rejected', async () => {
  const app = await buildApp();
  const user = await prisma.user.create({
    data: {
      username: `sse_expired_${timestamp}`,
      email: `sse_expired_${timestamp}@test.local`,
      displayName: 'SSE Expired',
    },
  });

  // Issue directly with a negative TTL to simulate expiration.
  const expiredTicket = realtimeStreamController.issueTicket(user.id, -1000);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/realtime/stream?ticket=${encodeURIComponent(expiredTicket)}`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});
