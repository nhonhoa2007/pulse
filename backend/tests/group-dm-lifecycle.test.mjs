import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-20 Pillar 3: Group DM Lifecycle, Roles, Messaging, SSE & Read Receipts Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  // Listen on random port for SSE connection
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const timestamp = Date.now();
  const createdUserIds = [];
  const createdGroupIds = [];

  // Helper to create test user
  async function createTestUser(prefix, extra = {}) {
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
        email: `${prefix}_${timestamp}_${Math.random().toString(36).substring(2, 7)}@pulse.test`,
        displayName: `${prefix} User`,
        ...extra,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  // Seed Users
  const creatorAdmin = await createTestUser('gdm_admin');
  const memberBob = await createTestUser('gdm_bob');
  const memberCharlie = await createTestUser('gdm_charlie');
  const prospectiveDave = await createTestUser('gdm_dave');
  const blockedEve = await createTestUser('gdm_eve');
  const strangerFrank = await createTestUser('gdm_frank');

  // Creator blocks Eve
  await prisma.block.create({
    data: { blockerId: creatorAdmin.id, blockedId: blockedEve.id },
  });

  let targetGroupId = '';
  let textMessageId = '';
  let imageMessageId = '';

  t.after(async () => {
    // Teardown
    if (createdGroupIds.length > 0) {
      await prisma.groupReadReceipt.deleteMany({ where: { conversationId: { in: createdGroupIds } } });
      await prisma.groupMessage.deleteMany({ where: { conversationId: { in: createdGroupIds } } });
      await prisma.groupMember.deleteMany({ where: { conversationId: { in: createdGroupIds } } });
      await prisma.groupConversation.deleteMany({ where: { id: { in: createdGroupIds } } });
    }
    await prisma.block.deleteMany({
      where: {
        OR: [{ blockerId: { in: createdUserIds } }, { blockedId: { in: createdUserIds } }],
      },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. Group Creation & Constraints
  // -------------------------------------------------------------------------
  await t.test('1a. POST /api/v1/dm/groups rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      payload: { title: 'Unauthorized Group', memberIds: [memberBob.id] },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'UNAUTHORIZED');
  });

  await t.test('1b. POST /api/v1/dm/groups enforces title validation (1-100 chars)', async () => {
    // Missing title
    const resEmpty = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { title: '', memberIds: [memberBob.id] },
    });
    assert.equal(resEmpty.statusCode, 400);

    // Whitespace-only title
    const resWhitespace = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { title: '    ', memberIds: [memberBob.id] },
    });
    assert.equal(resWhitespace.statusCode, 400);

    // Title exceeding 100 chars
    const resLong = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { title: 'X'.repeat(101), memberIds: [memberBob.id] },
    });
    assert.equal(resLong.statusCode, 400);
  });

  await t.test('1c. POST /api/v1/dm/groups enforces minimum member constraint', async () => {
    // Empty memberIds array
    const resNoMembers = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { title: 'Solo Group Attempt', memberIds: [] },
    });
    assert.equal(resNoMembers.statusCode, 400);
  });

  await t.test('1d. POST /api/v1/dm/groups enforces two-way block invariant (403 FORBIDDEN)', async () => {
    // Creator blocks Eve -> creation with Eve must be rejected
    const resWithBlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { title: 'Blocked Group', memberIds: [blockedEve.id, memberBob.id] },
    });
    assert.equal(resWithBlocked.statusCode, 403);
    assert.equal(resWithBlocked.json().error.code, 'FORBIDDEN');
  });

  await t.test('1e. POST /api/v1/dm/groups creates group with creator as ADMIN and others as MEMBER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': creatorAdmin.id },
      payload: {
        title: 'Pulse Engineering Team',
        memberIds: [memberBob.id, memberCharlie.id],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.title, 'Pulse Engineering Team');
    assert.equal(body.data.creatorId, creatorAdmin.id);
    assert.equal(body.data.myRole, 'ADMIN');
    assert.equal(body.data.members.length, 3);

    const adminRecord = body.data.members.find((m) => m.userId === creatorAdmin.id);
    const bobRecord = body.data.members.find((m) => m.userId === memberBob.id);
    const charlieRecord = body.data.members.find((m) => m.userId === memberCharlie.id);

    assert.ok(adminRecord && adminRecord.role === 'ADMIN', 'Creator must be ADMIN');
    assert.ok(bobRecord && bobRecord.role === 'MEMBER', 'Participant Bob must be MEMBER');
    assert.ok(charlieRecord && charlieRecord.role === 'MEMBER', 'Participant Charlie must be MEMBER');

    targetGroupId = body.data.id;
    createdGroupIds.push(targetGroupId);
  });

  // -------------------------------------------------------------------------
  // 2. Membership Management (Add, Kick, Permissions & Voluntary Leave)
  // -------------------------------------------------------------------------
  await t.test('2a. POST /api/v1/dm/groups/:id/members: non-admin gets 403 when adding member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/members`,
      headers: { 'x-user-id': memberBob.id }, // Bob is MEMBER
      payload: { userId: prospectiveDave.id },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('2b. POST /api/v1/dm/groups/:id/members: admin successfully adds new member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/members`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { userId: prospectiveDave.id },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.userId, prospectiveDave.id);
    assert.equal(body.data.role, 'MEMBER');

    // Verify group now has 4 members
    const groupRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}`,
      headers: { 'x-user-id': creatorAdmin.id },
    });
    assert.equal(groupRes.json().data.members.length, 4);
  });

  await t.test('2c. POST /api/v1/dm/groups/:id/members: block invariant check prevents adding blocked user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/members`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { userId: blockedEve.id },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('2d. DELETE /api/v1/dm/groups/:id/members/:userId: non-admin cannot kick another member (403)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${targetGroupId}/members/${prospectiveDave.id}`,
      headers: { 'x-user-id': memberBob.id },
    });
    assert.equal(res.statusCode, 403);
  });

  await t.test('2e. DELETE /api/v1/dm/groups/:id/members/:userId: member voluntarily leaves group (200)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${targetGroupId}/members/${prospectiveDave.id}`,
      headers: { 'x-user-id': prospectiveDave.id }, // Self-leave
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // Prospective Dave is now non-member; querying group should yield 403
    const checkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}`,
      headers: { 'x-user-id': prospectiveDave.id },
    });
    assert.equal(checkRes.statusCode, 403);
  });

  await t.test('2f. DELETE /api/v1/dm/groups/:id/members/:userId: admin kicks member (200)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${targetGroupId}/members/${memberCharlie.id}`,
      headers: { 'x-user-id': creatorAdmin.id }, // Admin kicks Charlie
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // Verify Charlie is no longer in group
    const groupRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}`,
      headers: { 'x-user-id': creatorAdmin.id },
    });
    const remainingMemberIds = groupRes.json().data.members.map((m) => m.userId);
    assert.equal(remainingMemberIds.includes(memberCharlie.id), false);
  });

  // -------------------------------------------------------------------------
  // 3. Group Messaging & IDOR Protections
  // -------------------------------------------------------------------------
  await t.test('3a. POST /api/v1/dm/groups/:id/messages: non-member gets 403 FORBIDDEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': strangerFrank.id },
      payload: { content: 'Intruder message' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  await t.test('3b. POST /api/v1/dm/groups/:id/messages: sends TEXT and IMAGE messages successfully', async () => {
    // 1. Text message
    const resText = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': memberBob.id },
      payload: { content: 'Sprint planning agenda: TASK-20 deployment', messageType: 'TEXT' },
    });
    assert.equal(resText.statusCode, 201);
    const bodyText = resText.json();
    assert.equal(bodyText.success, true);
    assert.equal(bodyText.data.content, 'Sprint planning agenda: TASK-20 deployment');
    assert.equal(bodyText.data.senderId, memberBob.id);
    assert.equal(bodyText.data.isDeleted, false);
    textMessageId = bodyText.data.id;

    // 2. Image message
    const resImage = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: {
        content: 'System Architecture Diagram',
        messageType: 'IMAGE',
        mediaUrls: ['https://cdn.pulse.social/diagram.png'],
      },
    });
    assert.equal(resImage.statusCode, 201);
    const bodyImage = resImage.json();
    assert.equal(bodyImage.success, true);
    assert.equal(bodyImage.data.mediaUrls[0], 'https://cdn.pulse.social/diagram.png');
    imageMessageId = bodyImage.data.id;
  });

  await t.test('3c. DELETE /api/v1/dm/groups/:id/messages/:messageId: non-author gets 403, author soft-deletes with content masked', async () => {
    // Creator Admin tries to delete Bob's text message -> 403 (author only)
    const resAdminDeleteBob = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${targetGroupId}/messages/${textMessageId}`,
      headers: { 'x-user-id': creatorAdmin.id },
    });
    assert.equal(resAdminDeleteBob.statusCode, 403);

    // Bob deletes own message -> 200
    const resBobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${targetGroupId}/messages/${textMessageId}`,
      headers: { 'x-user-id': memberBob.id },
    });
    assert.equal(resBobDelete.statusCode, 200);

    // Query messages: verify content is masked
    const queryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': creatorAdmin.id },
    });
    const deletedMsg = queryRes.json().data.messages.find((m) => m.id === textMessageId);
    assert.ok(deletedMsg, 'Deleted message must still exist in history');
    assert.equal(deletedMsg.isDeleted, true);
    assert.equal(deletedMsg.content, 'This message was deleted');
  });

  // -------------------------------------------------------------------------
  // 4. Message History, Pagination & Read Receipts
  // -------------------------------------------------------------------------
  await t.test('4a. GET /api/v1/dm/groups/:id/messages: cursor pagination and ordering', async () => {
    // Send 2 more messages from Admin
    await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { content: 'History message A' },
    });
    const msgB = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { content: 'History message B' },
    });

    // Request limit=2
    const page1Res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}/messages?limit=2`,
      headers: { 'x-user-id': memberBob.id },
    });
    assert.equal(page1Res.statusCode, 200);
    const page1 = page1Res.json().data;
    assert.equal(page1.messages.length, 2);
    assert.ok(page1.nextCursor);

    // Next page with cursor
    const page2Res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${targetGroupId}/messages?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      headers: { 'x-user-id': memberBob.id },
    });
    assert.equal(page2Res.statusCode, 200);
    const page2 = page2Res.json().data;
    assert.ok(page2.messages.length > 0);

    // Ensure no overlapping message IDs between pages
    const page1Ids = new Set(page1.messages.map((m) => m.id));
    for (const msg of page2.messages) {
      assert.equal(page1Ids.has(msg.id), false, `Page 2 message ${msg.id} must not duplicate Page 1`);
    }
  });

  await t.test('4b. PUT /api/v1/dm/groups/:id/read: updates read receipt and unread count', async () => {
    // Query group listing for Bob: should have unread messages
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': memberBob.id },
    });
    const groupBefore = listBefore.json().data.groups.find((g) => g.id === targetGroupId);
    assert.ok(groupBefore.unreadCount > 0, 'Bob should have unread messages');

    // Bob marks group as read up to imageMessageId
    const readRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/groups/${targetGroupId}/read`,
      headers: { 'x-user-id': memberBob.id },
      payload: { messageId: imageMessageId },
    });
    assert.equal(readRes.statusCode, 200);
    const receipt = readRes.json().data;
    assert.equal(receipt.userId, memberBob.id);
    assert.equal(receipt.conversationId, targetGroupId);
    assert.equal(receipt.lastReadMessageId, imageMessageId);
  });

  // -------------------------------------------------------------------------
  // 5. Real-time SSE Broadcasting (dm.group.message.new)
  // -------------------------------------------------------------------------
  await t.test('5. Real-time SSE stream receives dm.group.message.new event when member posts', async () => {
    let receivedGroupMessageEvent = false;
    let sseEventData = null;

    // Connect Bob to SSE stream
    const sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?userId=${memberBob.id}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: dm.group.message.new')) {
            receivedGroupMessageEvent = true;
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  sseEventData = JSON.parse(line.slice(6));
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
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Admin sends message to group
    const broadcastContent = `Realtime SSE Broadcast Test ${Date.now()}`;
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${targetGroupId}/messages`,
      headers: { 'x-user-id': creatorAdmin.id },
      payload: { content: broadcastContent, messageType: 'TEXT' },
    });
    assert.equal(sendRes.statusCode, 201);

    // Wait for SSE propagation
    for (let i = 0; i < 20; i++) {
      if (receivedGroupMessageEvent) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    sseReq.destroy();

    assert.equal(receivedGroupMessageEvent, true, 'Connected member Bob must receive dm.group.message.new SSE event');
    assert.ok(sseEventData, 'SSE event data payload must be parsed');
    assert.equal(sseEventData.conversationId, targetGroupId);
    assert.equal(sseEventData.message.content, broadcastContent);
    assert.equal(sseEventData.message.senderId, creatorAdmin.id);
  });
});
