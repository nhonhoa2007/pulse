import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';

test('TASK-18: Post Lifecycle - Pinned Post to Profile & Query Invariants', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `pin_${tag}_${timestamp}`,
        email: `pin_${tag}_${timestamp}@pulse.local`,
        displayName: `Pin User ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');
  const bob = await createUser('bob');

  let post1Id = '';
  let post2Id = '';
  let replyPostId = '';

  // Setup initial posts
  const post1 = await prisma.post.create({
    data: {
      authorId: alice.id,
      content: 'Alice Root Post 1 (Older)',
      createdAt: new Date(Date.now() - 10000),
    },
  });
  post1Id = post1.id;

  const post2 = await prisma.post.create({
    data: {
      authorId: alice.id,
      content: 'Alice Root Post 2 (Newer)',
      createdAt: new Date(Date.now() - 5000),
    },
  });
  post2Id = post2.id;

  const replyPost = await prisma.post.create({
    data: {
      authorId: alice.id,
      content: 'Alice Reply to Post 1',
      replyToId: post1Id,
      rootPostId: post1Id,
      createdAt: new Date(Date.now() - 1000),
    },
  });
  replyPostId = replyPost.id;

  // ---------------------------------------------------------------------------
  // 1. Tác giả ghim bài viết thành công, cập nhật user.pinnedPostId
  // ---------------------------------------------------------------------------
  await t.test('1. Tác giả ghim bài viết thành công, cập nhật user.pinnedPostId', async () => {
    const pinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1Id}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(pinRes.statusCode, 200);
    const body = pinRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.pinnedPostId, post1Id);
    assert.equal(body.data.isPinned, true);

    // Verify user record in database has pinnedPostId
    const updatedUser = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(updatedUser.pinnedPostId, post1Id);
  });

  // ---------------------------------------------------------------------------
  // 2. Ghim bài viết mới tự động thay thế bài viết ghim trước đó
  // ---------------------------------------------------------------------------
  await t.test('2. Ghim bài viết mới tự động thay thế bài viết ghim trước đó', async () => {
    const pin2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post2Id}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(pin2Res.statusCode, 200);
    const body2 = pin2Res.json();
    assert.equal(body2.success, true);
    assert.equal(body2.data.pinnedPostId, post2Id);
    assert.equal(body2.data.isPinned, true);

    // Verify database replaced old pinnedPostId
    const userInDb = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userInDb.pinnedPostId, post2Id);
  });

  // ---------------------------------------------------------------------------
  // 3. Từ chối ghim bài của người khác (HTTP 403 FORBIDDEN)
  // ---------------------------------------------------------------------------
  await t.test('3. Từ chối ghim bài của người khác (HTTP 403 FORBIDDEN)', async () => {
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1Id}/pin`,
      headers: authHeaders(bob.id),
    });

    assert.equal(forbiddenRes.statusCode, 403);
    const json = forbiddenRes.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'FORBIDDEN');

    // Bob's pinnedPostId must remain null
    const bobUser = await prisma.user.findUnique({ where: { id: bob.id } });
    assert.equal(bobUser.pinnedPostId, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Từ chối ghim bài reply hoặc bài đã xóa mềm (HTTP 400)
  // ---------------------------------------------------------------------------
  await t.test('4. Từ chối ghim bài reply hoặc bài đã xóa mềm (HTTP 400)', async () => {
    // Attempt to pin reply post
    const replyPinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${replyPostId}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(replyPinRes.statusCode, 400);
    const replyJson = replyPinRes.json();
    assert.equal(replyJson.success, false);
    assert.equal(replyJson.error.code, 'CANNOT_PIN_REPLY');

    // Create a soft-deleted post
    const deletedPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Soft-deleted root post',
        isDeleted: true,
      },
    });

    const deletedPinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${deletedPost.id}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(deletedPinRes.statusCode, 400);
    const deletedJson = deletedPinRes.json();
    assert.equal(deletedJson.success, false);
    assert.equal(deletedJson.error.code, 'CANNOT_PIN_DELETED');
  });

  // ---------------------------------------------------------------------------
  // 5. Bỏ ghim bài viết thành công (DELETE /posts/:id/pin)
  // ---------------------------------------------------------------------------
  await t.test('5. Bỏ ghim bài viết thành công (DELETE /posts/:id/pin)', async () => {
    const unpinRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${post2Id}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(unpinRes.statusCode, 200);
    const body = unpinRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.pinnedPostId, null);
    assert.equal(body.data.isPinned, false);

    // Verify user in DB has pinnedPostId reset to null
    const userInDb = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userInDb.pinnedPostId, null);
  });

  // ---------------------------------------------------------------------------
  // 6. Xóa bài viết ghim tự động reset pinnedPostId về null
  // ---------------------------------------------------------------------------
  await t.test('6. Xóa bài viết ghim tự động reset pinnedPostId về null', async () => {
    // 6a. Test soft-deletion: Pinned post soft-deleted is reset on profile fetch
    const tempPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post to be soft-deleted while pinned',
      },
    });

    // Pin tempPost
    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${tempPost.id}/pin`,
      headers: authHeaders(alice.id),
    });

    let userCheck = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userCheck.pinnedPostId, tempPost.id);

    // Soft delete the pinned post
    await prisma.post.update({
      where: { id: tempPost.id },
      data: { isDeleted: true },
    });

    // Fetch user profile posts
    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${alice.username}/posts`,
    });
    assert.equal(profileRes.statusCode, 200);

    // Verify pinnedPostId has been cleaned up and reset to null
    userCheck = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userCheck.pinnedPostId, null);

    // 6b. Test hard-deletion: DB Cascade onDelete: SetNull
    const hardDeletePost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post to be hard-deleted while pinned',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${hardDeletePost.id}/pin`,
      headers: authHeaders(alice.id),
    });

    userCheck = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userCheck.pinnedPostId, hardDeletePost.id);

    // Hard delete from database
    await prisma.post.delete({ where: { id: hardDeletePost.id } });

    // Database foreign key constraint automatically sets pinnedPostId to null
    userCheck = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userCheck.pinnedPostId, null);
  });

  // ---------------------------------------------------------------------------
  // 7. Endpoint GET /users/:username/posts luôn đưa bài viết ghim lên vị trí index 0
  // ---------------------------------------------------------------------------
  await t.test('7. Endpoint GET /users/:username/posts luôn đưa bài viết ghim lên vị trí đầu tiên (index 0) với cờ isPinned: true', async () => {
    // Pin the oldest post (post1Id)
    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1Id}/pin`,
      headers: authHeaders(alice.id),
    });

    // Fetch Alice's profile feed
    const feedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${alice.username}/posts`,
    });

    assert.equal(feedRes.statusCode, 200);
    const feedBody = feedRes.json().data;
    const posts = feedBody.posts;

    assert.ok(posts.length >= 2, 'Profile should have at least 2 posts');

    // Index 0 must be post1Id with isPinned: true
    assert.equal(posts[0].id, post1Id);
    assert.equal(posts[0].isPinned, true);

    // All following posts must have isPinned: false
    for (let i = 1; i < posts.length; i++) {
      assert.equal(posts[i].isPinned, false, `Post at index ${i} must have isPinned: false`);
    }

    // Verify post2Id exists in the feed
    assert.ok(posts.some((p) => p.id === post2Id), 'post2Id must exist in the feed');

    // Verify post1Id is not duplicated anywhere in the feed
    const duplicates = posts.filter((p) => p.id === post1Id);
    assert.equal(duplicates.length, 1, 'Pinned post must appear exactly once in feed');
  });

  // ---------------------------------------------------------------------------
  // 8. Edge Cases: Non-author unpin (403) and unauthenticated requests (401)
  // ---------------------------------------------------------------------------
  await t.test('8. Edge Cases: Non-author unpin và yêu cầu chưa đăng nhập', async () => {
    // Bob attempts to unpin Alice's pinned post
    const bobUnpinRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${post1Id}/pin`,
      headers: authHeaders(bob.id),
    });
    assert.equal(bobUnpinRes.statusCode, 403);
    assert.equal(bobUnpinRes.json().error.code, 'FORBIDDEN');

    // Unauthenticated pin attempt
    const unauthPinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1Id}/pin`,
    });
    assert.equal(unauthPinRes.statusCode, 401);

    // Unauthenticated unpin attempt
    const unauthUnpinRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${post1Id}/pin`,
    });
    assert.equal(unauthUnpinRes.statusCode, 401);
  });

  await app.close();
});
