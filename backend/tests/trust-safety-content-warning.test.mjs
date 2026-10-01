import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-18: Trust & Safety - Content Warnings, Sensitive Media & ActivityPub Interop', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `cw_${tag}_${timestamp}`,
        email: `cw_${tag}_${timestamp}@pulse.local`,
        displayName: `CW User ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');

  let testPostId = '';

  // ---------------------------------------------------------------------------
  // 1. Tạo bài viết với isSensitive: true và contentWarning
  // ---------------------------------------------------------------------------
  await t.test('1. Tạo bài viết với isSensitive: true và contentWarning', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post with sensitive content warning attached',
        mediaUrls: ['https://pulse.social/uploads/cw-test.png'],
        contentWarning: 'Cảnh báo tiết lộ nội dung phim',
        isSensitive: true,
      },
    });

    assert.equal(createRes.statusCode, 201);
    const post = createRes.json().data;
    testPostId = post.id;

    assert.equal(post.contentWarning, 'Cảnh báo tiết lộ nội dung phim');
    assert.equal(post.isSensitive, true);

    // Verify in database
    const dbPost = await prisma.post.findUnique({ where: { id: testPostId } });
    assert.equal(dbPost.contentWarning, 'Cảnh báo tiết lộ nội dung phim');
    assert.equal(dbPost.isSensitive, true);
  });

  // ---------------------------------------------------------------------------
  // 2. Chỉnh sửa bài viết cập nhật được cờ cảnh báo nội dung
  // ---------------------------------------------------------------------------
  await t.test('2. Chỉnh sửa bài viết cập nhật được cờ cảnh báo nội dung', async () => {
    // 2a. Update to new content warning and sensitive: false
    const edit1Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${testPostId}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Updated post content',
        contentWarning: 'Cảnh báo: Ánh sáng nhấp nháy',
        isSensitive: false,
      },
    });

    assert.equal(edit1Res.statusCode, 200);
    const editedPost1 = edit1Res.json().data;
    assert.equal(editedPost1.contentWarning, 'Cảnh báo: Ánh sáng nhấp nháy');
    assert.equal(editedPost1.isSensitive, false);
    assert.equal(editedPost1.isEdited, true);
    assert.equal(editedPost1.editCount, 1);

    // Verify snapshot in PostVersion contains original warning
    const v1 = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: { postId: testPostId, versionNumber: 1 },
      },
    });
    assert.ok(v1);
    assert.equal(v1.contentWarning, 'Cảnh báo tiết lộ nội dung phim');
    assert.equal(v1.isSensitive, true);

    // 2b. Clear content warning by passing null
    const edit2Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${testPostId}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Clean post without any warning',
        contentWarning: null,
      },
    });

    assert.equal(edit2Res.statusCode, 200);
    const editedPost2 = edit2Res.json().data;
    assert.equal(editedPost2.contentWarning, null);
    assert.equal(editedPost2.isSensitive, false);

    // Verify snapshot in PostVersion v2 contains first edit's warning
    const v2 = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: { postId: testPostId, versionNumber: 2 },
      },
    });
    assert.ok(v2);
    assert.equal(v2.contentWarning, 'Cảnh báo: Ánh sáng nhấp nháy');
  });

  // ---------------------------------------------------------------------------
  // 3. Outbox ActivityPub sinh Note chứa đúng trường summary và sensitive
  // ---------------------------------------------------------------------------
  await t.test('3. Outbox ActivityPub sinh Note chứa đúng trường summary và sensitive', async () => {
    // Alice creates a fresh post with content warning specifically for ActivityPub federation test
    const fedPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'ActivityPub federated note with spoiler warning',
        contentWarning: 'Spoiler Alert: Season 4 Finale',
        isSensitive: true,
      },
    });
    assert.equal(fedPostRes.statusCode, 201);
    const fedPost = fedPostRes.json().data;

    // Fetch Alice's ActivityPub Outbox
    const outboxRes = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}/outbox?page=true`,
    });

    assert.equal(outboxRes.statusCode, 200);
    const outboxPage = outboxRes.json();
    assert.ok(outboxPage.orderedItems && outboxPage.orderedItems.length > 0);

    // Find the Activity for this post
    const activity = outboxPage.orderedItems.find((item) => item.object?.id?.endsWith(fedPost.id));
    assert.ok(activity, 'Outbox must contain activity for created post');
    assert.equal(activity.type, 'Create');

    const note = activity.object;
    assert.equal(note.type, 'Note');
    assert.equal(note.summary, 'Spoiler Alert: Season 4 Finale', 'ActivityPub Note must contain summary');
    assert.equal(note.sensitive, true, 'ActivityPub Note must contain sensitive: true');
  });

  // ---------------------------------------------------------------------------
  // 4. XSS Sanitization trong contentWarning bảo vệ ứng dụng
  // ---------------------------------------------------------------------------
  await t.test('4. XSS Sanitization trong contentWarning bảo vệ ứng dụng', async () => {
    const xssPayload = '<script>alert("XSS Attack")</script>Nội dung nhạy cảm';
    const xssPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post testing XSS defense in contentWarning',
        contentWarning: xssPayload,
        isSensitive: true,
      },
    });

    assert.equal(xssPostRes.statusCode, 201);
    const postData = xssPostRes.json().data;

    // Dangerous script tags must be stripped
    assert.ok(!postData.contentWarning.includes('<script>'), 'Script tag must be stripped');
    assert.ok(!postData.contentWarning.includes('</script>'), 'Closing script tag must be stripped');
    assert.equal(postData.contentWarning, 'alert("XSS Attack")Nội dung nhạy cảm');
  });

  // ---------------------------------------------------------------------------
  // 5. Edge Cases: Whitespace trimming và default values
  // ---------------------------------------------------------------------------
  await t.test('5. Edge Cases: Whitespace trimming và default values', async () => {
    // Pure whitespace contentWarning is trimmed and treated as null
    const spaceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post with spaces only in content warning',
        contentWarning: '     ',
      },
    });

    assert.equal(spaceRes.statusCode, 201);
    const spacePost = spaceRes.json().data;
    assert.equal(spacePost.contentWarning, null);
    assert.equal(spacePost.isSensitive, false);

    // Surrounding whitespace is trimmed
    const trimRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post with padded content warning',
        contentWarning: '   Nội dung cảnh báo có khoảng trắng   ',
      },
    });

    assert.equal(trimRes.statusCode, 201);
    const trimPost = trimRes.json().data;
    assert.equal(trimPost.contentWarning, 'Nội dung cảnh báo có khoảng trắng');
  });

  await app.close();
});
