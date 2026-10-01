import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-18: Post Lifecycle - 15-Minute Edit Window & Immutable PostVersion Audit Trail', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `edit_${tag}_${timestamp}`,
        email: `edit_${tag}_${timestamp}@pulse.local`,
        displayName: `Edit User ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');
  const bob = await createUser('bob');
  const charlie = await createUser('charlie');

  // Helper to create a test post
  let post1Id = '';

  // ---------------------------------------------------------------------------
  // 1. Snapshot bản gốc thành PostVersion (versionNumber: 1) ở lần sửa đầu tiên
  //    & Kiểm tra sửa bài thành công trong vòng 15 phút
  // ---------------------------------------------------------------------------
  await t.test('1. Sửa bài thành công trong vòng 15 phút và snapshot bản gốc thành PostVersion v1', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Original post content by Alice with #initialTag and @bob',
        mediaUrls: ['https://pulse.social/uploads/orig.jpg'],
        contentWarning: 'CW: Original spoiler',
        isSensitive: true,
      },
    });

    assert.equal(createRes.statusCode, 201);
    const originalPost = createRes.json().data;
    post1Id = originalPost.id;

    assert.equal(originalPost.isEdited, false);
    assert.equal(originalPost.editCount, 0);
    assert.equal(originalPost.lastEditedAt, null);
    assert.equal(originalPost.content, 'Original post content by Alice with #initialTag and @bob');
    assert.deepEqual(originalPost.hashtags, ['initialtag']);
    assert.deepEqual(originalPost.mentions, ['bob']);

    // Perform first edit within 15-minute window
    const edit1Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post1Id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'First edit content with #updatedTag #trending and @charlie',
        mediaUrls: ['https://pulse.social/uploads/orig.jpg', 'https://pulse.social/uploads/new.jpg'],
        contentWarning: 'CW: Updated spoiler',
        isSensitive: false,
      },
    });

    assert.equal(edit1Res.statusCode, 200);
    const edit1Post = edit1Res.json().data;

    // Verify post properties updated
    assert.equal(edit1Post.id, post1Id);
    assert.equal(edit1Post.isEdited, true);
    assert.equal(edit1Post.editCount, 1);
    assert.ok(edit1Post.lastEditedAt);
    assert.equal(edit1Post.content, 'First edit content with #updatedTag #trending and @charlie');
    assert.equal(edit1Post.contentWarning, 'CW: Updated spoiler');
    assert.equal(edit1Post.isSensitive, false);

    // Verify snapshot in PostVersion table with versionNumber: 1
    const v1Snapshot = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: {
          postId: post1Id,
          versionNumber: 1,
        },
      },
    });

    assert.ok(v1Snapshot, 'PostVersion v1 must be created');
    assert.equal(v1Snapshot.versionNumber, 1);
    assert.equal(v1Snapshot.content, 'Original post content by Alice with #initialTag and @bob');
    assert.deepEqual(v1Snapshot.mediaUrls, ['https://pulse.social/uploads/orig.jpg']);
    assert.equal(v1Snapshot.contentWarning, 'CW: Original spoiler');
    assert.equal(v1Snapshot.isSensitive, true);
    assert.deepEqual(v1Snapshot.hashtags, ['initialtag']);
    assert.deepEqual(v1Snapshot.mentions, ['bob']);
    assert.equal(v1Snapshot.editorId, alice.id);
  });

  // ---------------------------------------------------------------------------
  // 2. Lần sửa thứ 2 tạo PostVersion (versionNumber: 2) và cập nhật editCount: 2
  // ---------------------------------------------------------------------------
  await t.test('2. Lần sửa thứ 2 tạo PostVersion (versionNumber: 2) và cập nhật editCount: 2, isEdited: true', async () => {
    const edit2Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post1Id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Second edit final content with #finalTag',
        contentWarning: null,
      },
    });

    assert.equal(edit2Res.statusCode, 200);
    const edit2Post = edit2Res.json().data;

    assert.equal(edit2Post.editCount, 2);
    assert.equal(edit2Post.isEdited, true);
    assert.equal(edit2Post.content, 'Second edit final content with #finalTag');
    assert.equal(edit2Post.contentWarning, null);

    // Verify snapshot in PostVersion table with versionNumber: 2
    const v2Snapshot = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: {
          postId: post1Id,
          versionNumber: 2,
        },
      },
    });

    assert.ok(v2Snapshot, 'PostVersion v2 must be created');
    assert.equal(v2Snapshot.versionNumber, 2);
    assert.equal(v2Snapshot.content, 'First edit content with #updatedTag #trending and @charlie');
    assert.equal(v2Snapshot.contentWarning, 'CW: Updated spoiler');
    assert.equal(v2Snapshot.isSensitive, false);
    assert.deepEqual(v2Snapshot.hashtags, ['updatedtag', 'trending']);
    assert.deepEqual(v2Snapshot.mentions, ['charlie']);
  });

  // ---------------------------------------------------------------------------
  // 3. Re-parsing chính xác hashtags và mentions sau khi sửa
  // ---------------------------------------------------------------------------
  await t.test('3. Re-parsing chính xác hashtags và mentions sau khi sửa', async () => {
    const edit3Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post1Id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Check out #Pulse #pulse_news and @bob @charlie @bob again',
      },
    });

    assert.equal(edit3Res.statusCode, 200);
    const postData = edit3Res.json().data;

    // Lowercase normalized and deduplicated
    assert.deepEqual(postData.hashtags.sort(), ['pulse', 'pulse_news'].sort());
    assert.deepEqual(postData.mentions.sort(), ['bob', 'charlie'].sort());

    // Verify in database
    const postInDb = await prisma.post.findUnique({
      where: { id: post1Id },
      select: { hashtags: true, mentions: true },
    });
    assert.deepEqual(postInDb.hashtags.sort(), ['pulse', 'pulse_news'].sort());
    assert.deepEqual(postInDb.mentions.sort(), ['bob', 'charlie'].sort());
  });

  // ---------------------------------------------------------------------------
  // 4. Endpoint GET /api/v1/posts/:id/versions trả về danh sách phiên bản đầy đủ
  // ---------------------------------------------------------------------------
  await t.test('4. Endpoint GET /api/v1/posts/:id/versions trả về danh sách phiên bản đầy đủ theo thứ tự', async () => {
    const versionsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post1Id}/versions`,
      headers: authHeaders(alice.id),
    });

    assert.equal(versionsRes.statusCode, 200);
    const body = versionsRes.json().data;

    assert.equal(body.postId, post1Id);
    assert.ok(body.current);
    assert.equal(body.current.versionNumber, 4); // After 3 edits, current is version 4
    assert.equal(body.current.content, 'Check out #Pulse #pulse_news and @bob @charlie @bob again');

    // Versions array contains all 3 previous versions in ascending order
    assert.equal(body.versions.length, 3);
    assert.equal(body.versions[0].versionNumber, 1);
    assert.equal(body.versions[0].content, 'Original post content by Alice with #initialTag and @bob');
    assert.equal(body.versions[1].versionNumber, 2);
    assert.equal(body.versions[1].content, 'First edit content with #updatedTag #trending and @charlie');
    assert.equal(body.versions[2].versionNumber, 3);
    assert.equal(body.versions[2].content, 'Second edit final content with #finalTag');
  });

  // ---------------------------------------------------------------------------
  // 5. Từ chối khi người khác cố sửa bài (HTTP 403 FORBIDDEN)
  // ---------------------------------------------------------------------------
  await t.test('5. Từ chối khi người khác cố sửa bài (HTTP 403 FORBIDDEN)', async () => {
    const forbiddenRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post1Id}`,
      headers: authHeaders(bob.id),
      payload: {
        content: 'Malicious modification by Bob',
      },
    });

    assert.equal(forbiddenRes.statusCode, 403);
    const json = forbiddenRes.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'FORBIDDEN');

    // Verify post content did not change
    const postCheck = await prisma.post.findUnique({
      where: { id: post1Id },
      select: { content: true },
    });
    assert.equal(postCheck.content, 'Check out #Pulse #pulse_news and @bob @charlie @bob again');
  });

  // ---------------------------------------------------------------------------
  // 6. Từ chối sửa bài sau 15 phút với HTTP 403 EDIT_WINDOW_EXPIRED
  // ---------------------------------------------------------------------------
  await t.test('6. Từ chối sửa bài sau 15 phút với HTTP 403 EDIT_WINDOW_EXPIRED', async () => {
    // Create a new post specifically to test expiration
    const expiredPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post created 16 minutes ago',
        createdAt: new Date(Date.now() - 16 * 60 * 1000), // 16 minutes in past
      },
    });

    const expiredRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${expiredPost.id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Attempted edit after edit window has elapsed',
      },
    });

    assert.equal(expiredRes.statusCode, 403);
    const json = expiredRes.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'EDIT_WINDOW_EXPIRED');

    // Verify content remained unchanged and no PostVersion was added
    const dbPost = await prisma.post.findUnique({ where: { id: expiredPost.id } });
    assert.equal(dbPost.content, 'Post created 16 minutes ago');
    assert.equal(dbPost.isEdited, false);

    const versions = await prisma.postVersion.findMany({ where: { postId: expiredPost.id } });
    assert.equal(versions.length, 0);
  });

  // ---------------------------------------------------------------------------
  // 7. Edge Cases: Sửa bài đã bị xóa mềm, bài không tồn tại, hoặc unauthenticated
  // ---------------------------------------------------------------------------
  await t.test('7. Edge Cases: Sửa bài đã bị xóa mềm, không tồn tại hoặc chưa đăng nhập', async () => {
    // Soft deleted post
    const softDeleted = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Soft-deleted post',
        isDeleted: true,
      },
    });

    const editDeletedRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${softDeleted.id}`,
      headers: authHeaders(alice.id),
      payload: { content: 'Trying to edit soft deleted' },
    });
    assert.equal(editDeletedRes.statusCode, 404);
    assert.equal(editDeletedRes.json().error.code, 'POST_NOT_FOUND');

    // Non-existent post
    const notFoundRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/posts/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(alice.id),
      payload: { content: 'Non-existent post' },
    });
    assert.equal(notFoundRes.statusCode, 404);
    assert.equal(notFoundRes.json().error.code, 'POST_NOT_FOUND');

    // Unauthenticated
    const unauthRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post1Id}`,
      payload: { content: 'No auth headers' },
    });
    assert.equal(unauthRes.statusCode, 401);
  });

  await app.close();
});
