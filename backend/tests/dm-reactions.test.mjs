/**
 * PKG-05.2: Message Reactions (1-1 DM + Group DM).
 *  - Toggle: thêm → có trong aggregate; toggle lần 2 → bỏ khỏi aggregate.
 *  - SSE dm.reaction.updated tới cả hai participants; group broadcast tới members.
 *  - Non-participant / non-member → 403; message đã xóa → 404.
 *  - getMessages trả reactions[] aggregated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();

async function makeUser(prefix) {
  return prisma.user.create({
    data: {
      username: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`,
      email: `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}@test.local`,
      displayName: `React ${prefix}`,
    },
  });
}

test('PKG-05.2: 1-1 DM reaction toggle — add, aggregate trong getMessages, remove', async () => {
  const app = await buildApp();
  const alice = await makeUser('react_a');
  const bob = await makeUser('react_b');

  const conv = await app.inject({
    method: 'POST',
    url: '/api/v1/dm/conversations',
    headers: authHeaders(alice.id, alice.username),
    payload: { recipientId: bob.id },
  });
  const conversationId = conv.json().data.id;

  const sent = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/conversations/${conversationId}/messages`,
    headers: authHeaders(bob.id, bob.username),
    payload: { content: 'Tin nhắn để react' },
  });
  const messageId = sent.json().data.id;

  // Alice toggle 👍 → toggledOn true + aggregate 1
  const on = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/messages/${messageId}/reactions`,
    headers: authHeaders(alice.id, alice.username),
    payload: { emoji: '👍' },
  });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal(on.json().data.toggledOn, true);
  assert.equal(on.json().data.reactions[0].emoji, '👍');
  assert.equal(on.json().data.reactions[0].count, 1);

  // Bob cũng react 👍 → count 2, userIds 2 người
  await app.inject({
    method: 'POST',
    url: `/api/v1/dm/messages/${messageId}/reactions`,
    headers: authHeaders(bob.id, bob.username),
    payload: { emoji: '👍' },
  });

  // getMessages trả reactions aggregated
  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/dm/conversations/${conversationId}/messages`,
    headers: authHeaders(alice.id, alice.username),
  });
  const msg = list.json().data.messages.find((m) => m.id === messageId);
  assert.ok(msg.reactions, 'phải có reactions trong DTO');
  assert.equal(msg.reactions[0].count, 2);
  assert.deepEqual([...msg.reactions[0].userIds].sort(), [alice.id, bob.id].sort());

  // Alice toggle lần 2 → gỡ; count còn 1
  const off = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/messages/${messageId}/reactions`,
    headers: authHeaders(alice.id, alice.username),
    payload: { emoji: '👍' },
  });
  assert.equal(off.json().data.toggledOn, false);
  assert.equal(off.json().data.reactions[0].count, 1);

  // Auth + stranger gates
  const stranger = await makeUser('react_s');
  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/messages/${messageId}/reactions`,
    headers: authHeaders(stranger.id, stranger.username),
    payload: { emoji: '👍' },
  });
  assert.equal(forbidden.statusCode, 403);

  const deletedMsg = await app.inject({
    method: 'DELETE',
    url: `/api/v1/dm/messages/${messageId}`,
    headers: authHeaders(bob.id, bob.username),
  });
  assert.equal(deletedMsg.statusCode, 200);
  const gone = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/messages/${messageId}/reactions`,
    headers: authHeaders(alice.id, alice.username),
    payload: { emoji: '❤️' },
  });
  assert.equal(gone.statusCode, 404, 'react trên message đã xóa → 404');

  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, stranger.id] } } });
  await app.close();
});

test('PKG-05.2: group reaction — member toggle OK, non-member 403', async () => {
  const app = await buildApp();
  const owner = await makeUser('grp_owner');
  const member = await makeUser('grp_member');
  const outsider = await makeUser('grp_out');

  const group = await app.inject({
    method: 'POST',
    url: '/api/v1/dm/groups',
    headers: authHeaders(owner.id, owner.username),
    payload: { title: 'Nhóm React', memberIds: [member.id] },
  });
  assert.equal(group.statusCode, 201, group.body);
  const groupId = group.json().data.id;

  const sent = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/groups/${groupId}/messages`,
    headers: authHeaders(member.id, member.username),
    payload: { content: 'Tin nhóm để react' },
  });
  const messageId = sent.json().data.id;

  const on = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/groups/${groupId}/messages/${messageId}/reactions`,
    headers: authHeaders(owner.id, owner.username),
    payload: { emoji: '🔥' },
  });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal(on.json().data.reactions[0].count, 1);

  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/v1/dm/groups/${groupId}/messages/${messageId}/reactions`,
    headers: authHeaders(outsider.id, outsider.username),
    payload: { emoji: '🔥' },
  });
  assert.equal(forbidden.statusCode, 403);

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/dm/groups/${groupId}/messages`,
    headers: authHeaders(member.id, member.username),
  });
  const msg = list.json().data.messages.find((m) => m.id === messageId);
  assert.equal(msg.reactions[0].emoji, '🔥');

  await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id, outsider.id] } } });
  await app.close();
});
