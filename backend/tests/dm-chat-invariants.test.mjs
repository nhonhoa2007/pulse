import { authHeaders, fetchRealtimeTicket } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Direct Messaging (1-1 DMs): Complete Invariants, Lifecycle, Realtime SSE & IDOR Protection', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const timestamp = Date.now();

  // Create 3 test users: userA, userB, userC (stranger)
  const userA = await prisma.user.create({
    data: {
      username: `dm_user_a_${timestamp}`,
      email: `dm_user_a_${timestamp}@pulse.local`,
      displayName: 'Alice User A',
    },
  });

  const userB = await prisma.user.create({
    data: {
      username: `dm_user_b_${timestamp}`,
      email: `dm_user_b_${timestamp}@pulse.local`,
      displayName: 'Bob User B',
    },
  });

  const userC = await prisma.user.create({
    data: {
      username: `dm_user_c_${timestamp}`,
      email: `dm_user_c_${timestamp}@pulse.local`,
      displayName: 'Charlie Stranger C',
    },
  });

  let conversationId = '';
  let sentMessageId = '';

  // -------------------------------------------------------------------------
  // 1. CONVERSATION CREATION & CANONICAL DEDUPLICATION
  // -------------------------------------------------------------------------
  await t.test('POST /dm/conversations: User A creates conversation with User B (201 Created)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
      payload: { recipientId: userB.id },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.otherUser.id, userB.id);
    assert.equal(body.data.otherUser.username, userB.username);
    assert.equal(body.data.unreadCount, 0);
    assert.equal(body.data.lastMessage, null);

    conversationId = body.data.id;
  });

  await t.test('POST /dm/conversations: User B initiates conversation with User A returns same conversation (200 Deduplicated)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userB.id),
      payload: { recipientId: userA.id },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, conversationId, 'Canonical ordering must guarantee exact same conversation ID');
    assert.equal(body.data.otherUser.id, userA.id);
  });

  // -------------------------------------------------------------------------
  // 2. VALIDATION & SELF-DM REJECTION
  // -------------------------------------------------------------------------
  await t.test('POST /dm/conversations: rejects Self-DM with 400 BAD_REQUEST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
      payload: { recipientId: userA.id },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_REQUEST');
    assert.match(body.error.message, /Self-DM/i);
  });

  await t.test('POST /dm/conversations: rejects missing recipientId with 400 BAD_REQUEST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
      payload: {},
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /dm/conversations: returns 404 for non-existent recipient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
      payload: { recipientId: '00000000-0000-0000-0000-000000000000' },
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 3. TWO-WAY SOCIAL GRAPH BLOCK PREVENTION
  // -------------------------------------------------------------------------
  await t.test('Block Invariant: User A blocks User C -> DM creation rejected with 403', async () => {
    // A blocks C
    await prisma.block.create({
      data: { blockerId: userA.id, blockedId: userC.id },
    });

    // A tries to DM C
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
      payload: { recipientId: userC.id },
    });
    assert.equal(resA.statusCode, 403);
    assert.equal(resA.json().error.code, 'FORBIDDEN');

    // C tries to DM A (two-way block check)
    const resC = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userC.id),
      payload: { recipientId: userA.id },
    });
    assert.equal(resC.statusCode, 403);
    assert.equal(resC.json().error.code, 'FORBIDDEN');

    // Clean up block
    await prisma.block.deleteMany({
      where: { blockerId: userA.id, blockedId: userC.id },
    });
  });

  // -------------------------------------------------------------------------
  // 4. REAL-TIME SSE STREAM & MESSAGE SENDING
  // -------------------------------------------------------------------------
  await t.test('POST /dm/conversations/:id/messages: sends message and delivers dm.message.new via SSE', async () => {
    let receivedNewMessageEvent = false;
    let eventPayload = null;

    // Connect User B to SSE stream
    const sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?ticket=${await fetchRealtimeTicket(app, userB.id)}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: dm.message.new')) {
            receivedNewMessageEvent = true;
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  eventPayload = JSON.parse(line.slice(6));
                } catch {
                  // ignore partial json
                }
              }
            }
          }
        });
      }
    );
    sseReq.end();

    // Handshake wait
    await new Promise((r) => setTimeout(r, 100));

    // User A sends message to User B
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(userA.id),
      payload: {
        content: 'Hello Bob! This is our first direct message.',
        messageType: 'TEXT',
      },
    });

    assert.equal(sendRes.statusCode, 201);
    const body = sendRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.content, 'Hello Bob! This is our first direct message.');
    assert.equal(body.data.senderId, userA.id);
    assert.equal(body.data.isDeleted, false);
    sentMessageId = body.data.id;

    // Wait for SSE delivery
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(receivedNewMessageEvent, true, 'User B must receive dm.message.new SSE event');
    assert.equal(eventPayload?.conversationId, conversationId);
    assert.equal(eventPayload?.message?.id, sentMessageId);

    sseReq.destroy();
  });

  // -------------------------------------------------------------------------
  // 5. UNREAD COUNTER & CONVERSATION LIST
  // -------------------------------------------------------------------------
  await t.test('GET /dm/conversations: lists conversations with preview and accurate unread count', async () => {
    // Send a 2nd message from A to B
    await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(userA.id),
      payload: { content: 'Second message from Alice' },
    });

    // User B checks conversation list: unreadCount should be 2
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userB.id),
    });

    assert.equal(resB.statusCode, 200);
    const listB = resB.json().data.conversations;
    assert.equal(listB.length, 1);
    assert.equal(listB[0].unreadCount, 2);
    assert.equal(listB[0].lastMessage.content, 'Second message from Alice');

    // User A checks conversation list: unreadCount should be 0 for sender
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userA.id),
    });

    assert.equal(resA.statusCode, 200);
    const listA = resA.json().data.conversations;
    assert.equal(listA[0].unreadCount, 0);
  });

  // -------------------------------------------------------------------------
  // 6. READ RECEIPTS & REALTIME SSE EVENT
  // -------------------------------------------------------------------------
  await t.test('PUT /dm/conversations/:id/read: marks conversation as read and emits dm.read_receipt.updated', async () => {
    let receivedReadReceiptEvent = false;

    // Connect User A to SSE stream
    const sseReqA = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?ticket=${await fetchRealtimeTicket(app, userA.id)}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: dm.read_receipt.updated')) {
            receivedReadReceiptEvent = true;
          }
        });
      }
    );
    sseReqA.end();

    await new Promise((r) => setTimeout(r, 100));

    // User B marks conversation as read
    const readRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/conversations/${conversationId}/read`,
      headers: authHeaders(userB.id),
      payload: {},
    });

    assert.equal(readRes.statusCode, 200);
    const readBody = readRes.json();
    assert.equal(readBody.success, true);
    assert.equal(readBody.data.userId, userB.id);

    // Wait for SSE delivery to User A
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(receivedReadReceiptEvent, true, 'User A must receive dm.read_receipt.updated SSE event');

    sseReqA.destroy();

    // Verify User B now has 0 unread messages
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(userB.id),
    });
    assert.equal(verifyRes.json().data.conversations[0].unreadCount, 0);
  });

  // -------------------------------------------------------------------------
  // 7. CURSOR-BASED PAGINATION & MESSAGE LISTING
  // -------------------------------------------------------------------------
  await t.test('GET /dm/conversations/:id/messages: cursor-based pagination works correctly', async () => {
    // Populate 3 more messages
    for (let i = 1; i <= 3; i++) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/dm/conversations/${conversationId}/messages`,
        headers: authHeaders(userA.id),
        payload: { content: `Pagination message ${i}` },
      });
    }

    // Query with limit = 2
    const page1Res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages?limit=2`,
      headers: authHeaders(userA.id),
    });

    assert.equal(page1Res.statusCode, 200);
    const page1 = page1Res.json().data;
    assert.equal(page1.messages.length, 2);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);

    // Query next page with cursor
    const page2Res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages?limit=2&cursor=${page1.nextCursor}&direction=before`,
      headers: authHeaders(userA.id),
    });

    assert.equal(page2Res.statusCode, 200);
    const page2 = page2Res.json().data;
    assert.equal(page2.messages.length, 2);
  });

  // -------------------------------------------------------------------------
  // 8. SOFT DELETE & CONTENT MASKING
  // -------------------------------------------------------------------------
  await t.test('DELETE /dm/messages/:id: only sender can delete, content masked in future queries', async () => {
    // User B tries to delete User A's message -> 403
    const unauthorizedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/messages/${sentMessageId}`,
      headers: authHeaders(userB.id),
    });
    assert.equal(unauthorizedDelete.statusCode, 403);
    assert.equal(unauthorizedDelete.json().error.code, 'FORBIDDEN');

    // User A deletes their own message -> 200
    const authorizedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/messages/${sentMessageId}`,
      headers: authHeaders(userA.id),
    });
    assert.equal(authorizedDelete.statusCode, 200);
    assert.equal(authorizedDelete.json().data.deleted, true);

    // Verify content is masked as 'This message was deleted'
    const messagesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(userB.id),
    });

    const msgs = messagesRes.json().data.messages;
    const targetMsg = msgs.find((m) => m.id === sentMessageId);
    assert.ok(targetMsg, 'Deleted message should still exist as soft-deleted record');
    assert.equal(targetMsg.content, 'This message was deleted');
    assert.equal(targetMsg.isDeleted, true);
    assert.deepEqual(targetMsg.mediaUrls, []);
  });

  // -------------------------------------------------------------------------
  // 9. IDOR SECURITY INVARIANTS
  // -------------------------------------------------------------------------
  await t.test('IDOR Protection: Stranger User C cannot access conversation messages', async () => {
    // User C tries to read messages of A & B
    const readAttempt = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(userC.id),
    });
    assert.equal(readAttempt.statusCode, 403);
    assert.equal(readAttempt.json().error.code, 'FORBIDDEN');

    // User C tries to send message into A & B conversation
    const sendAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(userC.id),
      payload: { content: 'Malicious injection from C' },
    });
    assert.equal(sendAttempt.statusCode, 403);
    assert.equal(sendAttempt.json().error.code, 'FORBIDDEN');

    // User C tries to mark A & B conversation as read
    const markAttempt = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/conversations/${conversationId}/read`,
      headers: authHeaders(userC.id),
      payload: {},
    });
    assert.equal(markAttempt.statusCode, 403);
    assert.equal(markAttempt.json().error.code, 'FORBIDDEN');
  });

  await app.close();
});
