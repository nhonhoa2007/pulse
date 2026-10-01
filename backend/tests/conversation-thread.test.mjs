import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Conversation Thread: 3-tier reply chain flattened with rootPostId in single query', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  // 1. Create 3 authors
  const user1 = await prisma.user.create({
    data: {
      username: `thread_u1_${timestamp}`,
      email: `thread_u1_${timestamp}@test.local`,
      displayName: 'Thread Author 1',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      username: `thread_u2_${timestamp}`,
      email: `thread_u2_${timestamp}@test.local`,
      displayName: 'Thread Author 2',
    },
  });

  const user3 = await prisma.user.create({
    data: {
      username: `thread_u3_${timestamp}`,
      email: `thread_u3_${timestamp}@test.local`,
      displayName: 'Thread Author 3',
    },
  });

  // 2. Post A (Level 1 Root Post)
  const resA = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: authHeaders(user1.id),
    payload: { content: 'Level 1: Root discussion post #architecture' },
  });
  assert.equal(resA.statusCode, 201);
  const postA = resA.json().data;
  assert.equal(postA.rootPostId, null);
  assert.equal(postA.replyToId, null);

  // 3. Post B (Level 2 Reply to A)
  const resB = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: authHeaders(user2.id),
    payload: { content: 'Level 2: Replying to post A', replyToId: postA.id },
  });
  assert.equal(resB.statusCode, 201);
  const postB = resB.json().data;
  assert.equal(postB.replyToId, postA.id);
  assert.equal(postB.rootPostId, postA.id);

  // 4. Post C (Level 3 Reply to B)
  const resC = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: authHeaders(user3.id),
    payload: { content: 'Level 3: Deep reply to post B', replyToId: postB.id },
  });
  assert.equal(resC.statusCode, 201);
  const postC = resC.json().data;
  assert.equal(postC.replyToId, postB.id);
  assert.equal(postC.rootPostId, postA.id, 'Post C rootPostId must point to original Root Post A');

  // 5. Query Thread from Post C's ID (should resolve back to root A and bring all replies)
  const threadFromC = await app.inject({
    method: 'GET',
    url: `/api/v1/posts/${postC.id}/thread`,
    headers: authHeaders(user1.id),
  });
  assert.equal(threadFromC.statusCode, 200);
  const dataC = threadFromC.json().data;

  assert.equal(dataC.rootPost.id, postA.id, 'Root post must be Post A');
  assert.equal(dataC.replies.length, 2, 'Must include both replies B and C');

  const replyIds = dataC.replies.map((r) => r.id);
  assert.deepEqual(replyIds, [postB.id, postC.id], 'Replies must be ordered chronologically');

  // Check parent repliesCount counters
  const dbPostA = await prisma.post.findUnique({ where: { id: postA.id } });
  const dbPostB = await prisma.post.findUnique({ where: { id: postB.id } });
  assert.equal(dbPostA.repliesCount, 1);
  assert.equal(dbPostB.repliesCount, 1);

  await app.close();
});
