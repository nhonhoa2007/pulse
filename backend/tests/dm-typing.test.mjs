/**
 * PKG-05: DM Typing Indicator.
 *  - POST /dm/conversations/:id/typing yêu cầu auth; non-participant → 403;
 *    conversation không tồn tại → 404.
 *  - SSE event dm.typing tới ĐÚNG đối phương (không echo lại người gửi).
 *  - Throttle 2s: heartbeat liên tiếp trong 2s → sent=false, không broadcast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders, fetchRealtimeTicket } from './helpers/auth.mjs';

const timestamp = Date.now();

async function makeUser(prefix) {
  return prisma.user.create({
    data: {
      username: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`,
      email: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}@test.local`,
      displayName: `Typing ${prefix}`,
    },
  });
}

test('PKG-05: typing endpoint — auth, participant gate, SSE delivery, throttle', async () => {
  const app = await buildApp();
  let sseReq = null;
  try {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const serverPort = app.server.address().port;

    const alice = await makeUser('typing_a');
    const bob = await makeUser('typing_b');
    const stranger = await makeUser('typing_s');

    const conv = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(alice.id, alice.username),
      payload: { recipientId: bob.id },
    });
    assert.equal(conv.statusCode, 201, conv.body);
    const conversationId = conv.json().data.id;

    // 1. Không auth → 401
    const unauth = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/typing`,
    });
    assert.equal(unauth.statusCode, 401);

    // 2. Non-participant → 403
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/typing`,
      headers: authHeaders(stranger.id, stranger.username),
    });
    assert.equal(forbidden.statusCode, 403);

    // 3. Conversation không tồn tại → 404
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/khong-ton-tai/typing`,
      headers: authHeaders(alice.id, alice.username),
    });
    assert.equal(missing.statusCode, 404);

    // 4. Bob mở SSE lắng nghe — nhận dm.typing từ Alice
    const ticket = await fetchRealtimeTicket(app, bob.id);
    let typingEvent = null;
    sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: dm.typing')) {
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  typingEvent = JSON.parse(line.slice(6));
                } catch {}
              }
            }
          }
        });
      }
    );
    sseReq.end();
    await new Promise((r) => setTimeout(r, 120));

    const heartbeat = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/typing`,
      headers: authHeaders(alice.id, alice.username),
    });
    assert.equal(heartbeat.statusCode, 200);
    assert.equal(heartbeat.json().data.sent, true);
    await new Promise((r) => setTimeout(r, 150));

    assert.ok(typingEvent, 'Bob phải nhận event dm.typing');
    assert.equal(typingEvent.conversationId, conversationId);
    assert.equal(typingEvent.userId, alice.id);
    assert.equal(typingEvent.username, alice.username);

    // 5. Throttle: heartbeat lại ngay → sent=false
    const throttled = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/typing`,
      headers: authHeaders(alice.id, alice.username),
    });
    assert.equal(throttled.json().data.sent, false, 'heartbeat trong 2s phải bị throttle');
  } finally {
    if (sseReq) sseReq.destroy();
    await new Promise((r) => setTimeout(r, 120));
    await app.close();
  }
});
