import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Concurrency & Atomic Invariants: 50 concurrent likes/unlikes maintain exact likesCount', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  // 1. Create post author and post
  const author = await prisma.user.create({
    data: {
      username: `author_conc_${timestamp}`,
      email: `author_conc_${timestamp}@test.local`,
      displayName: 'Post Author',
    },
  });

  const postRes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: authHeaders(author.id),
    payload: { content: 'High concurrency like test post' },
  });
  assert.equal(postRes.statusCode, 201);
  const post = postRes.json().data;

  // 2. Create 50 distinct users
  const userPromises = Array.from({ length: 50 }, (_, i) =>
    prisma.user.create({
      data: {
        username: `liker_${timestamp}_${i}`,
        email: `liker_${timestamp}_${i}@test.local`,
        displayName: `Liker ${i}`,
      },
    })
  );
  const likers = await Promise.all(userPromises);
  assert.equal(likers.length, 50);

  // 3. Fire 50 concurrent LIKE requests
  const likeResponses = await Promise.all(
    likers.map((user) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/like`,
        headers: authHeaders(user.id),
      })
    )
  );

  for (const res of likeResponses) {
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.liked, true);
  }

  // 4. Verify likesCount on Post exactly matches 50
  const postAfterLikes = await prisma.post.findUnique({
    where: { id: post.id },
    select: { likesCount: true },
  });
  const dbLikeCount = await prisma.like.count({
    where: { postId: post.id },
  });

  assert.equal(postAfterLikes.likesCount, 50, 'likesCount on Post must equal 50');
  assert.equal(dbLikeCount, 50, 'Number of Like records in DB must equal 50');

  // 5. Fire 20 concurrent UNLIKE requests
  const unlikeResponses = await Promise.all(
    likers.slice(0, 20).map((user) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/like`,
        headers: authHeaders(user.id),
      })
    )
  );

  for (const res of unlikeResponses) {
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.liked, false);
  }

  // 6. Verify likesCount decreased to 30 with 0 skew
  const postAfterUnlikes = await prisma.post.findUnique({
    where: { id: post.id },
    select: { likesCount: true },
  });
  const dbLikeCountAfter = await prisma.like.count({
    where: { postId: post.id },
  });

  assert.equal(postAfterUnlikes.likesCount, 30, 'likesCount on Post must equal 30');
  assert.equal(dbLikeCountAfter, 30, 'Number of Like records in DB must equal 30');

  await app.close();
});
