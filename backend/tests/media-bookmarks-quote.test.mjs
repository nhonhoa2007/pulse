import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';

test('Integration Suite: Media Upload Pipeline, Bookmarks System, and Quote Post Engine', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Create two distinct users for interaction tests
  const user1 = await prisma.user.create({
    data: {
      username: `mqb_user1_${timestamp}`,
      email: `mqb_user1_${timestamp}@test.local`,
      displayName: 'Alice User',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      username: `mqb_user2_${timestamp}`,
      email: `mqb_user2_${timestamp}@test.local`,
      displayName: 'Bob User',
    },
  });

  // =========================================================================
  // 1. MEDIA UPLOAD PIPELINE (TASK-08)
  // =========================================================================
  await t.test('Media Upload: successfully uploads valid image and serves via static route', async () => {
    const boundary = `----WebKitFormBoundary${timestamp}`;
    const fakeImageBuffer = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');
    
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="sample.gif"\r\n` +
      `Content-Type: image/gif\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([header, fakeImageBuffer, footer]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        ...authHeaders(user1.id),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.url.includes('/uploads/'));
    assert.ok(body.data.relativeUrl.startsWith('/uploads/'));
    assert.ok(body.data.relativeUrl.endsWith('.gif'));

    // Verify file exists on local filesystem
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filename = path.basename(body.data.relativeUrl);
    const savedPath = path.join(uploadsDir, filename);
    assert.ok(fs.existsSync(savedPath), `File should exist at ${savedPath}`);

    // Verify static server serves the file at GET /uploads/<uuid>.<ext>
    const staticRes = await app.inject({
      method: 'GET',
      url: body.data.relativeUrl,
    });
    assert.equal(staticRes.statusCode, 200);
    assert.equal(staticRes.headers['content-type'], 'image/gif');
  });

  await t.test('Media Upload: rejects invalid MIME type with 400 BAD_REQUEST', async () => {
    const boundary = `----WebKitFormBoundaryInvalid${timestamp}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="document.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([header, Buffer.from('%PDF-1.4 dummy content'), footer]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        ...authHeaders(user1.id),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_MIME_TYPE');
  });

  await t.test('Media Upload: enforces 5MB file size limit', async () => {
    const boundary = `----WebKitFormBoundaryLarge${timestamp}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="huge.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    // 6MB payload (exceeds 5MB limit)
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 0);
    const payload = Buffer.concat([header, largeBuffer, footer]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        ...authHeaders(user1.id),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'FILE_TOO_LARGE');
  });

  // =========================================================================
  // 2. BOOKMARKS SYSTEM (TASK-10)
  // =========================================================================
  let bookmarkedPostId;

  await t.test('Bookmarks: creates a post to test bookmark toggles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(user1.id),
      payload: { content: 'Post to be bookmarked by others #pulse' },
    });
    assert.equal(res.statusCode, 201);
    bookmarkedPostId = res.json().data.id;
  });

  await t.test('Bookmarks: requires authentication via x-user-id header', async () => {
    const resToggle = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${bookmarkedPostId}/bookmark`,
    });
    assert.equal(resToggle.statusCode, 401);

    const resList = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks',
    });
    assert.equal(resList.statusCode, 401);
  });

  await t.test('Bookmarks: toggles bookmark ON and verifies in DB and GET /api/v1/bookmarks', async () => {
    // 1. Toggle ON
    const toggleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${bookmarkedPostId}/bookmark`,
      headers: authHeaders(user2.id),
    });
    assert.equal(toggleRes.statusCode, 200);
    assert.deepEqual(toggleRes.json(), {
      success: true,
      data: { bookmarked: true },
    });

    // Verify DB entry
    const record = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: user2.id, postId: bookmarkedPostId } },
    });
    assert.ok(record, 'Bookmark record must exist in database');

    // 2. Retrieve bookmarks list for user2
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks',
      headers: authHeaders(user2.id),
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = listRes.json();
    assert.equal(listBody.success, true);
    assert.ok(Array.isArray(listBody.data));
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].id, bookmarkedPostId);
    assert.equal(listBody.data[0].isBookmarked, true);
    assert.equal(listBody.data[0].author.username, user1.username);

    // 3. Verify getPost detail returns isBookmarked: true for user2 and false for user1
    const postDetailUser2 = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${bookmarkedPostId}`,
      headers: authHeaders(user2.id),
    });
    assert.equal(postDetailUser2.json().data.isBookmarked, true);

    const postDetailUser1 = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${bookmarkedPostId}`,
      headers: authHeaders(user1.id),
    });
    assert.equal(postDetailUser1.json().data.isBookmarked, false);
  });

  await t.test('Bookmarks: toggles bookmark OFF and verifies list is empty', async () => {
    // Toggle OFF
    const toggleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${bookmarkedPostId}/bookmark`,
      headers: authHeaders(user2.id),
    });
    assert.equal(toggleRes.statusCode, 200);
    assert.deepEqual(toggleRes.json(), {
      success: true,
      data: { bookmarked: false },
    });

    // Verify DB entry deleted
    const record = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: user2.id, postId: bookmarkedPostId } },
    });
    assert.equal(record, null, 'Bookmark record must be deleted');

    // Verify list is now empty
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks',
      headers: authHeaders(user2.id),
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.json().data.length, 0);
  });

  // =========================================================================
  // 3. QUOTE POST FLOW (TASK-09)
  // =========================================================================
  let originalPostId;

  await t.test('Quote Post: creates original post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(user1.id),
      payload: { content: 'Original insight about distributed systems #tech' },
    });
    assert.equal(res.statusCode, 201);
    originalPostId = res.json().data.id;
    assert.equal(res.json().data.quotesCount, 0);
  });

  await t.test('Quote Post: creates quote post, increments quotesCount atomically, and generates notification', async () => {
    const quoteContent = 'Adding critical perspective to this insight!';
    const quoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(user2.id),
      payload: {
        content: quoteContent,
        quoteOfId: originalPostId,
      },
    });

    assert.equal(quoteRes.statusCode, 201);
    const quotePost = quoteRes.json().data;
    assert.equal(quotePost.quoteOfId, originalPostId);
    assert.ok(quotePost.quoteOf, 'quoteOf object must be embedded in PostDto');
    assert.equal(quotePost.quoteOf.id, originalPostId);
    assert.equal(quotePost.quoteOf.author.username, user1.username);
    assert.equal(quotePost.quoteOf.quotesCount, 1);

    // 1. Verify quotesCount on original post incremented in DB
    const dbOriginal = await prisma.post.findUnique({
      where: { id: originalPostId },
    });
    assert.equal(dbOriginal.quotesCount, 1, 'Target post quotesCount must be incremented to 1');

    // 2. Verify GET /api/v1/posts/:id reflects quotesCount: 1
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${originalPostId}`,
      headers: authHeaders(user1.id),
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.json().data.quotesCount, 1);

    // 3. Verify GET /api/v1/posts/:id for the quoting post includes quoteOf
    const getQuoteRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${quotePost.id}`,
      headers: authHeaders(user2.id),
    });
    assert.equal(getQuoteRes.statusCode, 200);
    assert.ok(getQuoteRes.json().data.quoteOf);
    assert.equal(getQuoteRes.json().data.quoteOf.id, originalPostId);

    // 4. Verify Notification with verb "QUOTE", targetType "POST", targetId = quoteOfId
    const notifs = await prisma.notification.findMany({
      where: {
        recipientId: user1.id,
        actorId: user2.id,
        verb: 'QUOTE',
        targetType: 'POST',
        targetId: originalPostId,
      },
    });
    assert.equal(notifs.length, 1, 'Quote notification must be created');
    assert.equal(notifs[0].targetId, originalPostId, 'targetId must equal quoteOfId');
    assert.equal(notifs[0].verb, 'QUOTE');
  });

  await t.test('Quote Post: self-quote increments quotesCount but suppresses notification', async () => {
    const selfQuoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(user1.id),
      payload: {
        content: 'I am quoting my own post for further context',
        quoteOfId: originalPostId,
      },
    });
    assert.equal(selfQuoteRes.statusCode, 201);

    // Verify quotesCount incremented to 2
    const dbOriginal = await prisma.post.findUnique({
      where: { id: originalPostId },
    });
    assert.equal(dbOriginal.quotesCount, 2, 'Target post quotesCount must be incremented to 2');

    // Verify no self-notification was created
    const selfNotifs = await prisma.notification.findMany({
      where: {
        recipientId: user1.id,
        actorId: user1.id,
      },
    });
    assert.equal(selfNotifs.length, 0, 'No self-notification should be created');
  });

  await app.close();
});
