import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';
import { postImpressionsBufferService } from '../dist/modules/posts/PostImpressionsBufferService.js';

test('TASK-20 Pillar 2: Post Views & Impressions Buffer Service and Endpoints Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testUser = await prisma.user.create({
    data: {
      username: `view_tester_${timestamp}`,
      email: `view_tester_${timestamp}@test.local`,
      displayName: 'View Tester',
    },
  });

  // Create 3 test posts
  const post1 = await prisma.post.create({
    data: {
      authorId: testUser.id,
      content: 'Post Views Buffer Test Post 1',
      viewsCount: 0,
    },
  });

  const post2 = await prisma.post.create({
    data: {
      authorId: testUser.id,
      content: 'Post Views Buffer Test Post 2',
      viewsCount: 5,
    },
  });

  const post3 = await prisma.post.create({
    data: {
      authorId: testUser.id,
      content: 'Post Views Buffer Test Post 3',
      viewsCount: 10,
    },
  });

  // Soft-deleted post
  const deletedPost = await prisma.post.create({
    data: {
      authorId: testUser.id,
      content: 'Soft Deleted Post for Views Test',
      viewsCount: 0,
      isDeleted: true,
    },
  });

  t.after(async () => {
    // Teardown created records
    postImpressionsBufferService.clearDeduplicationCache();
    await postImpressionsBufferService.flush();
    await prisma.post.deleteMany({
      where: {
        id: { in: [post1.id, post2.id, post3.id, deletedPost.id] },
      },
    });
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. Ingestion: POST /api/v1/posts/views batch buffer
  // -------------------------------------------------------------------------
  await t.test('1. POST /api/v1/posts/views buffers impressions for valid post IDs', async () => {
    postImpressionsBufferService.clearDeduplicationCache();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/views',
      headers: authHeaders(testUser.id),
      payload: { postIds: [post1.id, post2.id] },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.recorded, 2, 'Should record 2 impressions on first view');
    assert.ok(body.data.buffered >= 2, 'Buffered count must reflect pending views');
    assert.equal(postImpressionsBufferService.getPendingForPost(post1.id), 1);
    assert.equal(postImpressionsBufferService.getPendingForPost(post2.id), 1);
  });

  await t.test('1b. POST /api/v1/posts/views validation rejects invalid payload with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/views',
      headers: authHeaders(testUser.id),
      payload: { postIds: 'invalid-string-not-array' },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  // -------------------------------------------------------------------------
  // 2. 30-minute deduplication window
  // -------------------------------------------------------------------------
  await t.test('2. 30-minute deduplication window skips duplicate views from same user', async () => {
    // Same testUser views post1 and post2 again immediately
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/views',
      headers: authHeaders(testUser.id),
      payload: { postIds: [post1.id, post2.id] },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.recorded, 0, 'Must record 0 impressions due to 30-min dedup window');

    // But a different client IP / anonymous user CAN record impressions
    const resFromOther = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/views',
      headers: { 'x-forwarded-for': '198.51.100.42' },
      payload: { postIds: [post1.id] },
    });

    assert.equal(resFromOther.statusCode, 200);
    const otherBody = resFromOther.json();
    assert.equal(otherBody.success, true);
    assert.equal(otherBody.data.recorded, 1, 'Distinct client IP must record 1 impression');
    assert.equal(postImpressionsBufferService.getPendingForPost(post1.id), 2);
  });

  // -------------------------------------------------------------------------
  // 3. Write-behind atomic periodic flush
  // -------------------------------------------------------------------------
  await t.test('3. Write-behind flush drains buffer and atomically increments Post.viewsCount in DB', async () => {
    const pendingBefore = postImpressionsBufferService.getTotalBufferedCount();
    assert.ok(pendingBefore > 0, 'Buffer should have pending counts before flush');

    const flushedCount = await postImpressionsBufferService.flush();
    assert.ok(flushedCount >= 2, `Flushed count must be at least 2, got ${flushedCount}`);

    // Verify buffer is empty
    assert.equal(postImpressionsBufferService.getTotalBufferedCount(), 0);
    assert.equal(postImpressionsBufferService.getPendingForPost(post1.id), 0);
    assert.equal(postImpressionsBufferService.getPendingForPost(post2.id), 0);

    // Verify database counts
    const updatedPost1 = await prisma.post.findUnique({
      where: { id: post1.id },
      select: { viewsCount: true },
    });
    const updatedPost2 = await prisma.post.findUnique({
      where: { id: post2.id },
      select: { viewsCount: true },
    });

    assert.equal(updatedPost1.viewsCount, 2, 'post1 initial was 0 + 2 recorded views = 2');
    assert.equal(updatedPost2.viewsCount, 6, 'post2 initial was 5 + 1 recorded view = 6');

    // Second immediate flush is idempotent
    const secondFlush = await postImpressionsBufferService.flush();
    assert.equal(secondFlush, 0, 'Immediate second flush on empty buffer must return 0');
  });

  // -------------------------------------------------------------------------
  // 4. Single View Endpoint: POST /api/v1/posts/:id/view
  // -------------------------------------------------------------------------
  await t.test('4. POST /api/v1/posts/:id/view records single view and handles edge cases', async () => {
    postImpressionsBufferService.clearDeduplicationCache();

    // Valid single view
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post3.id}/view`,
      headers: authHeaders(testUser.id),
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    // Initial 10 + 1 pending = 11
    assert.equal(body.data.viewsCount, 11);

    // 404 on non-existent post
    const notFoundRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/00000000-0000-0000-0000-000000000000/view',
    });
    assert.equal(notFoundRes.statusCode, 404);

    // 404 on soft-deleted post
    const deletedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${deletedPost.id}/view`,
    });
    assert.equal(deletedRes.statusCode, 404);
  });

  // -------------------------------------------------------------------------
  // 5. Concurrency stress test: 50 concurrent requests maintain exact atomic count
  // -------------------------------------------------------------------------
  await t.test('5. Concurrency: 50 concurrent view requests maintain exact atomic viewsCount', async () => {
    // Create a fresh post for concurrency test
    const concPost = await prisma.post.create({
      data: {
        authorId: testUser.id,
        content: 'Concurrency View Test Post',
        viewsCount: 0,
      },
    });

    postImpressionsBufferService.clearDeduplicationCache();
    await postImpressionsBufferService.flush();

    // 50 distinct clients
    const concurrentRequests = Array.from({ length: 50 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/posts/views',
        headers: {
          ...authHeaders(`conc_viewer_${timestamp}_${i}`),
          'x-forwarded-for': `10.200.${Math.floor(i / 250)}.${i % 250}`,
        },
        payload: { postIds: [concPost.id] },
      })
    );

    const responses = await Promise.all(concurrentRequests);

    let totalRecordedFromClients = 0;
    for (const r of responses) {
      assert.equal(r.statusCode, 200);
      const json = r.json();
      assert.equal(json.success, true);
      totalRecordedFromClients += json.data.recorded;
    }

    assert.equal(totalRecordedFromClients, 50, 'All 50 distinct requests must record an impression');

    // Flush to DB
    const flushed = await postImpressionsBufferService.flush();
    assert.equal(flushed, 50, 'Flush must drain exactly 50 views');

    const finalPost = await prisma.post.findUnique({
      where: { id: concPost.id },
      select: { viewsCount: true },
    });

    assert.equal(finalPost.viewsCount, 50, 'Post.viewsCount in database must equal exactly 50 with 0 lost updates');

    // Clean up concurrency post
    await prisma.post.delete({ where: { id: concPost.id } });
  });

  // -------------------------------------------------------------------------
  // 6. viewsCount returned in PostDto (getPost & getUserPosts)
  // -------------------------------------------------------------------------
  await t.test('6. GET /api/v1/posts/:id returns viewsCount in PostDto', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post1.id}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(typeof body.data.viewsCount, 'number');
    assert.equal(body.data.viewsCount, 2);
  });
});
