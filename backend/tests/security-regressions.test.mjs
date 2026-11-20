import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.ts';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { tokenRevocationManager } from '../src/modules/auth/TokenRevocationManager.ts';

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const createdUserIds = [];

function headers(userId) {
  return {
    authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' })}`,
  };
}

after(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.revokedToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.post.deleteMany({ where: { authorId: { in: createdUserIds } } });
  await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

test('private post versions, polls, bookmarks and media honor the viewer access check', async () => {
  const [owner, stranger] = await Promise.all([
    prisma.user.create({
      data: {
        username: `private_owner_${suffix}`,
        email: `private_owner_${suffix}@test.local`,
        displayName: 'Private owner',
        isPrivate: true,
      },
    }),
    prisma.user.create({
      data: {
        username: `private_stranger_${suffix}`,
        email: `private_stranger_${suffix}@test.local`,
        displayName: 'Stranger',
      },
    }),
  ]);
  createdUserIds.push(owner.id, stranger.id);

  const filename = `${crypto.randomUUID()}.webp`;
  const mediaPath = `/uploads/${filename}`;
  await prisma.mediaAsset.create({
    data: { ownerId: owner.id, filename, mimeType: 'image/webp', sizeBytes: 1 },
  });
  const post = await prisma.post.create({
    data: { authorId: owner.id, content: 'private content', mediaUrls: [mediaPath] },
  });
  const poll = await prisma.poll.create({
    data: {
      postId: post.id,
      question: 'Private poll',
      expiresAt: new Date(Date.now() + 60_000),
      choices: { create: [{ index: 0, text: 'A' }, { index: 1, text: 'B' }] },
    },
  });

  for (const url of [
    `/api/v1/posts/${post.id}`,
    `/api/v1/posts/${post.id}/versions`,
    `/api/v1/polls/${poll.id}`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 404, `${url} must hide private content from a guest`);
  }

  const media = await app.inject({ method: 'GET', url: `/api/v1/uploads/${filename}` });
  assert.equal(media.statusCode, 404, 'private post media must not be served to a guest');

  const spoofedVote = await app.inject({
    method: 'POST',
    url: `/api/v1/polls/${poll.id}/vote`,
    payload: { choiceIndex: 0, userId: stranger.id },
  });
  assert.equal(spoofedVote.statusCode, 401, 'a body-supplied user ID must not authorize a vote');

  const bookmarked = await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post.id}/bookmark`,
    headers: headers(stranger.id),
  });
  assert.equal(bookmarked.statusCode, 404);
});

test('refresh and logout reject untrusted origins and malformed bearer tokens are not retained', async () => {
  const refresh = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(refresh.statusCode, 403);

  const fakeToken = `not-a-jwt-${crypto.randomUUID()}`;
  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${fakeToken}` },
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(tokenRevocationManager.isRevoked(fakeToken), false);
});
