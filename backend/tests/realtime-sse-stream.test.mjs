import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Realtime SSE Stream: client connects, receives heartbeat and live pushed events', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const timestamp = Date.now();
  const user = await prisma.user.create({
    data: {
      username: `sse_user_${timestamp}`,
      email: `sse_user_${timestamp}@test.local`,
      displayName: 'SSE User',
    },
  });

  const actor = await prisma.user.create({
    data: {
      username: `sse_actor_${timestamp}`,
      email: `sse_actor_${timestamp}@test.local`,
      displayName: 'SSE Actor',
    },
  });

  // Connect SSE client via native http request
  let receivedConnectedEvent = false;
  let receivedNotificationEvent = false;

  const sseReq = http.request(
    {
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/realtime/stream?userId=${user.id}`,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
    },
    (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'text/event-stream');

      res.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.includes('event: CONNECTED')) {
          receivedConnectedEvent = true;
        }
        if (text.includes('event: NEW_NOTIFICATION')) {
          receivedNotificationEvent = true;
        }
      });
    }
  );

  sseReq.end();

  // Wait a moment for connection handshake
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(receivedConnectedEvent, true, 'Client should receive CONNECTED event on handshake');

  // Trigger an action that emits NEW_NOTIFICATION to user:
  // Actor creates a post and mentions user
  await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': actor.id },
    payload: { content: `Hello @${user.username} from SSE test!` },
  });

  // Wait for event to arrive
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(receivedNotificationEvent, true, 'Connected client must receive NEW_NOTIFICATION SSE event');

  sseReq.destroy();
  await app.close();
});
