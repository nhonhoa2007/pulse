import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-20 Pillar 3: Group Direct Messaging (Group DMs) Comprehensive Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const alice = await prisma.user.create({
    data: {
      username: `gdm_alice_${timestamp}`,
      email: `gdm_alice_${timestamp}@test.local`,
      displayName: 'Alice Admin',
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `gdm_bob_${timestamp}`,
      email: `gdm_bob_${timestamp}@test.local`,
      displayName: 'Bob Member',
    },
  });

  const charlie = await prisma.user.create({
    data: {
      username: `gdm_charlie_${timestamp}`,
      email: `gdm_charlie_${timestamp}@test.local`,
      displayName: 'Charlie Member',
    },
  });

  const daveStranger = await prisma.user.create({
    data: {
      username: `gdm_dave_${timestamp}`,
      email: `gdm_dave_${timestamp}@test.local`,
      displayName: 'Dave Stranger',
    },
  });

  const eveBlocked = await prisma.user.create({
    data: {
      username: `gdm_eve_${timestamp}`,
      email: `gdm_eve_${timestamp}@test.local`,
      displayName: 'Eve Blocked',
    },
  });

  // Block relationship: Alice blocks Eve
  await prisma.block.create({
    data: { blockerId: alice.id, blockedId: eveBlocked.id },
  });

  let testGroupId = '';
  let sentMessageId = '';

  t.after(async () => {
    if (testGroupId) {
      await prisma.groupConversation.delete({ where: { id: testGroupId } }).catch(() => {});
    }
    await prisma.block.deleteMany({ where: { blockerId: alice.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice.id, bob.id, charlie.id, daveStranger.id, eveBlocked.id] } },
    });
    await app.close();
  });

  // 1. Creation validations
  await t.test('1a. POST /api/v1/dm/groups rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      payload: { title: 'Test Group', memberIds: [bob.id] },
    });
    assert.equal(res.statusCode, 401);
  });

  await t.test('1b. POST /api/v1/dm/groups rejects empty title or missing members with 400', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': alice.id },
      payload: { title: '', memberIds: [bob.id] },
    });
    assert.equal(res1.statusCode, 400);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': alice.id },
      payload: { title: 'Valid Title', memberIds: [] },
    });
    assert.equal(res2.statusCode, 400);
  });

  await t.test('1c. POST /api/v1/dm/groups enforces two-way block invariant with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': alice.id },
      payload: { title: 'Blocked Group Attempt', memberIds: [eveBlocked.id] },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  await t.test('1d. POST /api/v1/dm/groups creates group with creator as ADMIN and others as MEMBER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': alice.id },
      payload: { title: 'Pulse Core Team', memberIds: [bob.id, charlie.id] },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.title, 'Pulse Core Team');
    assert.equal(body.data.creatorId, alice.id);
    assert.equal(body.data.myRole, 'ADMIN');
    assert.equal(body.data.members.length, 3);

    const aliceMember = body.data.members.find((m) => m.userId === alice.id);
    const bobMember = body.data.members.find((m) => m.userId === bob.id);
    assert.equal(aliceMember.role, 'ADMIN');
    assert.equal(bobMember.role, 'MEMBER');

    testGroupId = body.data.id;
  });

  // 2. Listing groups
  await t.test('2. GET /api/v1/dm/groups lists groups for active member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': bob.id },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.groups.some((g) => g.id === testGroupId));

    // Stranger Dave sees empty list
    const strangerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/dm/groups',
      headers: { 'x-user-id': daveStranger.id },
    });
    assert.equal(strangerRes.statusCode, 200);
    assert.equal(strangerRes.json().data.groups.length, 0);
  });

  // 3. IDOR Protection on group details
  await t.test('3. GET /api/v1/dm/groups/:id rejects non-member with 403 FORBIDDEN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${testGroupId}`,
      headers: { 'x-user-id': daveStranger.id },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  // 4. Role Permissions: updating group settings
  await t.test('4. PATCH /api/v1/dm/groups/:id requires ADMIN role (MEMBER gets 403)', async () => {
    // Bob (MEMBER) tries to update title -> 403
    const bobRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dm/groups/${testGroupId}`,
      headers: { 'x-user-id': bob.id },
      payload: { title: 'Hacked by Bob' },
    });
    assert.equal(bobRes.statusCode, 403);

    // Alice (ADMIN) updates title -> 200
    const aliceRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dm/groups/${testGroupId}`,
      headers: { 'x-user-id': alice.id },
      payload: { title: 'Pulse Core Team (Updated)' },
    });
    assert.equal(aliceRes.statusCode, 200);
    assert.equal(aliceRes.json().data.title, 'Pulse Core Team (Updated)');
  });

  // 5. Messaging lifecycle
  await t.test('5a. POST /api/v1/dm/groups/:id/messages rejects non-member with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${testGroupId}/messages`,
      headers: { 'x-user-id': daveStranger.id },
      payload: { content: 'I am not a member' },
    });
    assert.equal(res.statusCode, 403);
  });

  await t.test('5b. POST /api/v1/dm/groups/:id/messages allows members to send messages', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${testGroupId}/messages`,
      headers: { 'x-user-id': bob.id },
      payload: { content: 'Hello team from Bob!' },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.content, 'Hello team from Bob!');
    assert.equal(body.data.senderId, bob.id);
    assert.equal(body.data.isDeleted, false);

    sentMessageId = body.data.id;
  });

  await t.test('5c. GET /api/v1/dm/groups/:id/messages paginates messages for members', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${testGroupId}/messages`,
      headers: { 'x-user-id': charlie.id },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.messages.some((m) => m.id === sentMessageId));
  });

  // 6. Message deletion IDOR and masking
  await t.test('6. DELETE /api/v1/dm/groups/:id/messages/:messageId enforces author-only deletion', async () => {
    // Alice (admin, but not author) tries to delete Bob's message -> 403
    const aliceRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${testGroupId}/messages/${sentMessageId}`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(aliceRes.statusCode, 403);

    // Bob (author) deletes own message -> 200
    const bobRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${testGroupId}/messages/${sentMessageId}`,
      headers: { 'x-user-id': bob.id },
    });
    assert.equal(bobRes.statusCode, 200);

    // Query messages: content must be masked as 'This message was deleted'
    const queryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${testGroupId}/messages`,
      headers: { 'x-user-id': alice.id },
    });
    const msg = queryRes.json().data.messages.find((m) => m.id === sentMessageId);
    assert.equal(msg.content, 'This message was deleted');
    assert.equal(msg.isDeleted, true);
  });

  // 7. Read receipts
  await t.test('7. PUT /api/v1/dm/groups/:id/read updates user read receipt', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/groups/${testGroupId}/read`,
      headers: { 'x-user-id': alice.id },
      payload: { messageId: sentMessageId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
  });

  // 8. Member removal & voluntary leave
  await t.test('8. DELETE /api/v1/dm/groups/:id/members/:userId allows voluntary leave and admin kick', async () => {
    // Charlie voluntarily leaves -> 200
    const leaveRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${testGroupId}/members/${charlie.id}`,
      headers: { 'x-user-id': charlie.id },
    });
    assert.equal(leaveRes.statusCode, 200);

    // Bob (member) cannot kick Alice -> 403
    const bobKickRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${testGroupId}/members/${alice.id}`,
      headers: { 'x-user-id': bob.id },
    });
    assert.equal(bobKickRes.statusCode, 403);

    // Alice (admin) kicks Bob -> 200
    const aliceKickRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${testGroupId}/members/${bob.id}`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(aliceKickRes.statusCode, 200);
  });
});
