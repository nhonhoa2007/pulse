import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Security Audit: Direct Messaging (DM) Vulnerability & Invariant Verification Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const timestamp = Date.now();

  // Test principals: Alice (victim), Bob (participant), Charlie (attacker/stranger)
  const alice = await prisma.user.create({
    data: {
      username: `audit_alice_${timestamp}`,
      email: `audit_alice_${timestamp}@pulse.security`,
      displayName: 'Alice Security',
      passwordHash: '$2b$10$encryptedSuperSecretPasswordHashDoNotLeak',
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `audit_bob_${timestamp}`,
      email: `audit_bob_${timestamp}@pulse.security`,
      displayName: 'Bob Security',
      passwordHash: '$2b$10$encryptedSuperSecretPasswordHashDoNotLeak',
    },
  });

  const charlie = await prisma.user.create({
    data: {
      username: `audit_charlie_${timestamp}`,
      email: `audit_charlie_${timestamp}@pulse.security`,
      displayName: 'Charlie Attacker',
      passwordHash: '$2b$10$encryptedSuperSecretPasswordHashDoNotLeak',
    },
  });

  let conversationId = '';
  let aliceMessageId = '';

  // Setup: create conversation between Alice and Bob
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/dm/conversations',
    headers: authHeaders(alice.id),
    payload: { recipientId: bob.id },
  });
  assert.equal(setupRes.statusCode, 201);
  conversationId = setupRes.json().data.id;

  // ---------------------------------------------------------------------------
  // DOMAIN 1: AUTHORIZATION & ACCESS CONTROL (IDOR & BROKEN OBJECT LEVEL AUTH)
  // ---------------------------------------------------------------------------
  await t.test('AUDIT-1.1: IDOR - Stranger Charlie cannot read messages of Alice & Bob', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(charlie.id),
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT-1.2: IDOR - Stranger Charlie cannot inject messages into Alice & Bob conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(charlie.id),
      payload: { content: 'Malicious unauthorized message from Charlie' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT-1.3: IDOR - Stranger Charlie cannot mark Alice & Bob conversation as read', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/conversations/${conversationId}/read`,
      headers: authHeaders(charlie.id),
      payload: {},
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT-1.4: IDOR - User cannot delete another user\'s message in conversation', async () => {
    // Alice sends message
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: 'Alice private sensitive message' },
    });
    assert.equal(sendRes.statusCode, 201);
    aliceMessageId = sendRes.json().data.id;

    // Bob tries to delete Alice's message
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/messages/${aliceMessageId}`,
      headers: authHeaders(bob.id),
    });
    assert.equal(deleteRes.statusCode, 403);
    assert.equal(deleteRes.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT-1.5: Conversation Enumeration - Non-participant sees only own conversations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(charlie.id),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.conversations.length, 0, 'Charlie must not see any of Alice & Bob conversations');
  });

  // ---------------------------------------------------------------------------
  // DOMAIN 2: INJECTION TESTING (SQLi & Stored XSS)
  // ---------------------------------------------------------------------------
  await t.test('AUDIT-2.1: SQL Injection - Malicious SQL injection payloads in message content are safely parameterized', async () => {
    const sqliPayloads = [
      "'; DROP TABLE dm_messages; --",
      "' OR 1=1 --",
      "' UNION SELECT null, username, passwordHash FROM users --",
      "Robert'); DROP TABLE \"dm_messages\";--",
    ];

    for (const payload of sqliPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dm/conversations/${conversationId}/messages`,
        headers: authHeaders(alice.id),
        payload: { content: payload },
      });
      assert.equal(res.statusCode, 201);
      assert.equal(res.json().data.content, payload, 'Payload must be stored as literal text without SQL execution');
    }

    // Verify dm_messages table still exists and is healthy
    const count = await prisma.dmMessage.count({ where: { conversationId } });
    assert.ok(count >= 4);
  });

  await t.test('AUDIT-2.2: SQL Injection - SQLi in conversationId parameter is safely rejected or handled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: "/api/v1/dm/conversations/'%20OR%201=1%20--/messages",
      headers: authHeaders(alice.id),
    });
    // Should be 404 NOT_FOUND since no conversation matches literal ID
    assert.equal(res.statusCode, 404);
  });

  await t.test('AUDIT-2.3: Stored XSS - HTML/Script payloads in message content are safely handled', async () => {
    const xssPayloads = [
      "<script>alert('XSS-1')</script>",
      "<img src=x onerror=alert('XSS-2')>",
      "<svg/onload=alert('XSS-3')>",
      "<iframe src=\"javascript:alert('XSS-4')\"></iframe>",
    ];

    for (const xss of xssPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dm/conversations/${conversationId}/messages`,
        headers: authHeaders(alice.id),
        payload: { content: xss },
      });
      assert.equal(res.statusCode, 201);
      assert.equal(res.json().data.content, xss);
    }
  });

  await t.test('AUDIT-2.4: Input Validation - Length bounds (5000 max, 0 min, whitespace rejection)', async () => {
    // Rejects empty
    const emptyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: '' },
    });
    assert.equal(emptyRes.statusCode, 400);

    // Rejects pure whitespace
    const wsRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: '    \n\t   ' },
    });
    assert.equal(wsRes.statusCode, 400);

    // Rejects > 5000 chars
    const tooLongRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: 'a'.repeat(5001) },
    });
    assert.equal(tooLongRes.statusCode, 400);

    // Accepts exactly 5000 chars
    const maxRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: 'a'.repeat(5000) },
    });
    assert.equal(maxRes.statusCode, 201);
  });

  // ---------------------------------------------------------------------------
  // DOMAIN 3: REAL-TIME SSE SECURITY & UNAUTHORIZED SUBSCRIPTION VULNERABILITY
  // ---------------------------------------------------------------------------
  await t.test('AUDIT-3.1 (FIXED by SEC-01/SEC-02): unauthenticated client cannot subscribe to arbitrary user SSE stream via ?userId=', async () => {
    let interceptedEvent = null;
    let attackerStatusCode = null;

    // Attacker Charlie connects to SSE WITHOUT ANY AUTHENTICATION, claiming Alice's userId via query param ?userId=
    const attackerSseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?userId=${alice.id}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        attackerStatusCode = res.statusCode;
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: dm.message.new')) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  interceptedEvent = JSON.parse(line.slice(6));
                } catch {}
              }
            }
          }
        });
      }
    );
    attackerSseReq.end();

    // Wait for the rejected handshake
    await new Promise((r) => setTimeout(r, 120));

    // Bob sends a sensitive private message to Alice
    const secretContent = `TopSecret_${timestamp}_Password123`;
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(bob.id),
      payload: { content: secretContent },
    });
    assert.equal(sendRes.statusCode, 201);

    await new Promise((r) => setTimeout(r, 180));
    attackerSseReq.destroy();

    // VERIFICATION THE FLAW IS FIXED: the unauthenticated subscription is rejected 401
    // and no private DM content ever reaches the attacker.
    assert.equal(attackerStatusCode, 401, 'Legacy ?userId= subscription must be rejected with 401');
    assert.equal(interceptedEvent, null, 'Attacker must NOT intercept any private DM SSE event');
  });

  // ---------------------------------------------------------------------------
  // DOMAIN 4: DATA PRIVACY & SOFT DELETE MASKING
  // ---------------------------------------------------------------------------
  await t.test('AUDIT-4.1: Data Privacy - Soft-deleted message content and mediaUrls are strictly masked in API', async () => {
    // Bob sends a message containing sensitive info
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(bob.id),
      payload: {
        content: 'Confidential bank PIN 9988',
        mediaUrls: ['https://cdn.pulse.social/receipt.png'],
      },
    });
    const msgId = sendRes.json().data.id;

    // Bob soft-deletes the message
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/messages/${msgId}`,
      headers: authHeaders(bob.id),
    });
    assert.equal(delRes.statusCode, 200);

    // Alice queries message list
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/conversations/${conversationId}/messages`,
      headers: authHeaders(alice.id),
    });
    const messages = listRes.json().data.messages;
    const deletedMsg = messages.find((m) => m.id === msgId);

    assert.ok(deletedMsg);
    assert.equal(deletedMsg.isDeleted, true);
    assert.equal(deletedMsg.content, 'This message was deleted', 'Content must be masked with placeholder');
    assert.deepEqual(deletedMsg.mediaUrls, [], 'mediaUrls must be empty array for deleted message');
    assert.equal(deletedMsg.content.includes('9988'), false, 'Sensitive content must not appear in response');
  });

  await t.test('AUDIT-4.2: Data Privacy - No sensitive user fields (passwordHash, email) exposed in DmUserSummary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/conversations',
      headers: authHeaders(alice.id),
    });
    const conv = res.json().data.conversations[0];
    const otherUser = conv.otherUser;

    assert.ok(otherUser.id);
    assert.ok(otherUser.username);
    assert.ok(otherUser.displayName);
    assert.equal(otherUser.passwordHash, undefined, 'passwordHash must never be exposed');
    assert.equal(otherUser.email, undefined, 'email must never be exposed in DM summary');
  });

  await app.close();
});
