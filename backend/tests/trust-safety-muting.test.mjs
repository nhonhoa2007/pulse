import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';

test('TASK-18: Trust & Safety - One-Way User and Keyword Muting Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `mute_${tag}_${timestamp}`,
        email: `mute_${tag}_${timestamp}@pulse.local`,
        displayName: `Mute User ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');
  const bob = await createUser('bob');
  const charlie = await createUser('charlie');

  // Alice follows Bob and Charlie initially
  await prisma.follow.create({
    data: { followerId: alice.id, followingId: bob.id },
  });
  await prisma.follow.create({
    data: { followerId: alice.id, followingId: charlie.id },
  });

  // ---------------------------------------------------------------------------
  // 1. Tắt tiếng người dùng thành công và bảo toàn quan hệ Follow (Không hủy follow)
  // ---------------------------------------------------------------------------
  await t.test('1. Tắt tiếng người dùng thành công và bảo toàn quan hệ Follow', async () => {
    const muteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${bob.id}/mute`,
      headers: authHeaders(alice.id),
    });

    assert.equal(muteRes.statusCode, 200);
    const body = muteRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.isMuted, true);
    assert.equal(body.data.mutedId, bob.id);

    // Verify UserMute record exists in database
    const muteRecord = await prisma.userMute.findUnique({
      where: {
        unique_muter_muted: {
          muterId: alice.id,
          mutedId: bob.id,
        },
      },
    });
    assert.ok(muteRecord, 'UserMute record must exist in DB');

    // CRITICAL SOCIAL GRAPH INVARIANT: Follow relationship MUST be preserved!
    const followRecord = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: alice.id,
          followingId: bob.id,
        },
      },
    });
    assert.ok(followRecord, 'Follow record MUST NOT be deleted or altered when muting');

    // GET /api/v1/mutes/users returns bob in the list
    const listMutesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mutes/users',
      headers: authHeaders(alice.id),
    });
    assert.equal(listMutesRes.statusCode, 200);
    const mutesList = listMutesRes.json().data.mutes;
    assert.ok(mutesList.some((m) => m.mutedId === bob.id));
  });

  // ---------------------------------------------------------------------------
  // 2. Từ chối tự tắt tiếng chính mình (HTTP 400)
  // ---------------------------------------------------------------------------
  await t.test('2. Từ chối tự tắt tiếng chính mình (HTTP 400)', async () => {
    const selfMuteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${alice.id}/mute`,
      headers: authHeaders(alice.id),
    });

    assert.equal(selfMuteRes.statusCode, 400);
    const json = selfMuteRes.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'SELF_MUTE_NOT_ALLOWED');
  });

  // ---------------------------------------------------------------------------
  // 3. Bảng tin Home Feed tự động lọc sạch các bài của user bị mute
  // ---------------------------------------------------------------------------
  await t.test('3. Bảng tin Home Feed tự động lọc sạch các bài của user bị mute', async () => {
    // Bob (muted) publishes a post
    const bobPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(bob.id),
      payload: { content: 'Post from muted Bob - should not appear on Alice Home feed' },
    });
    assert.equal(bobPostRes.statusCode, 201);
    const bobPostId = bobPostRes.json().data.id;

    // Charlie (not muted) publishes a post
    const charliePostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Post from normal Charlie - should appear on Alice Home feed' },
    });
    assert.equal(charliePostRes.statusCode, 201);
    const charliePostId = charliePostRes.json().data.id;

    // Alice fetches Home Feed
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const feedPosts = feedRes.json().data.posts;

    // Bob's post must NOT be present in Alice's home feed
    assert.ok(!feedPosts.some((p) => p.id === bobPostId), 'Muted Bob post must be filtered from Home Feed');
    assert.ok(!feedPosts.some((p) => p.authorId === bob.id), 'No posts from muted Bob in Home Feed');

    // Charlie's post MUST be present
    assert.ok(feedPosts.some((p) => p.id === charliePostId), 'Normal Charlie post must appear in Home Feed');
  });

  // ---------------------------------------------------------------------------
  // 4. Danh sách Notifications lọc sạch các tương tác từ user bị mute
  // ---------------------------------------------------------------------------
  await t.test('4. Danh sách Notifications lọc sạch các tương tác từ user bị mute', async () => {
    // Bob likes or quotes Alice's post, or records a notification
    // Let's create an Alice post first
    const alicePost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice post to receive notifications',
      },
    });

    // Create a notification where Bob is the actor
    await prisma.notification.create({
      data: {
        recipientId: alice.id,
        actorId: bob.id,
        verb: 'LIKE',
        targetType: 'POST',
        targetId: alicePost.id,
        actorSummary: `${bob.displayName} liked your post`,
      },
    });

    // Create a notification where Charlie is the actor
    const charlieNotif = await prisma.notification.create({
      data: {
        recipientId: alice.id,
        actorId: charlie.id,
        verb: 'LIKE',
        targetType: 'POST',
        targetId: alicePost.id,
        actorSummary: `${charlie.displayName} liked your post`,
      },
    });

    // Alice fetches Notifications
    const notifsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: authHeaders(alice.id),
    });

    assert.equal(notifsRes.statusCode, 200);
    const notifs = notifsRes.json().data;

    // Bob's notification must be filtered out
    assert.ok(!notifs.some((n) => n.actorId === bob.id), 'Notifications from muted Bob must be filtered out');

    // Charlie's notification must be present
    assert.ok(notifs.some((n) => n.id === charlieNotif.id), 'Notifications from non-muted Charlie must be present');
  });

  // ---------------------------------------------------------------------------
  // 5. Mute từ khóa với CONTAINS lọc đúng bài viết chứa từ khóa
  // ---------------------------------------------------------------------------
  let containsKwId = '';
  await t.test('5. Mute từ khóa với CONTAINS lọc đúng bài viết chứa từ khóa', async () => {
    // Alice mutes keyword 'crypto' with CONTAINS
    const muteKwRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: 'crypto',
        matchType: 'CONTAINS',
        muteContext: 'ALL',
        durationDays: 7,
      },
    });

    assert.equal(muteKwRes.statusCode, 201);
    const kwData = muteKwRes.json().data;
    containsKwId = kwData.id;
    assert.equal(kwData.keyword, 'crypto');
    assert.equal(kwData.matchType, 'CONTAINS');

    // Charlie publishes a post containing substring 'cryptocurrency'
    const cryptoPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Join the latest cryptocurrency wave today!' },
    });
    assert.equal(cryptoPostRes.statusCode, 201);
    const cryptoPostId = cryptoPostRes.json().data.id;

    // Charlie publishes a clean post
    const cleanPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Hiking in the mountains is refreshing!' },
    });
    assert.equal(cleanPostRes.statusCode, 201);
    const cleanPostId = cleanPostRes.json().data.id;

    // Alice checks feed: 'cryptocurrency' post should be filtered by CONTAINS
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const posts = feedRes.json().data.posts;

    assert.ok(!posts.some((p) => p.id === cryptoPostId), 'CONTAINS rule must filter post containing cryptocurrency');
    assert.ok(posts.some((p) => p.id === cleanPostId), 'Clean post must appear in feed');
  });

  // ---------------------------------------------------------------------------
  // 6. Mute từ khóa với EXACT_WORD chỉ lọc đúng ranh giới từ (word boundary)
  // ---------------------------------------------------------------------------
  let exactKwId = '';
  await t.test('6. Mute từ khóa với EXACT_WORD chỉ lọc đúng ranh giới từ (word boundary)', async () => {
    // Alice mutes keyword 'cat' with EXACT_WORD
    const muteExactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: 'cat',
        matchType: 'EXACT_WORD',
        muteContext: 'ALL',
      },
    });

    assert.equal(muteExactRes.statusCode, 201);
    exactKwId = muteExactRes.json().data.id;

    // Charlie posts about 'caterpillar' (contains 'cat' but not exact word)
    const caterpillarRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Look at this fuzzy caterpillar on the leaf' },
    });
    assert.equal(caterpillarRes.statusCode, 201);
    const caterpillarId = caterpillarRes.json().data.id;

    // Charlie posts about 'cute cat' (exact word 'cat')
    const catRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'My cute cat is sleeping on the couch' },
    });
    assert.equal(catRes.statusCode, 201);
    const catId = catRes.json().data.id;

    // Alice checks feed: 'cat' post filtered, 'caterpillar' post preserved
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const posts = feedRes.json().data.posts;

    assert.ok(posts.some((p) => p.id === caterpillarId), 'EXACT_WORD must NOT filter caterpillar');
    assert.ok(!posts.some((p) => p.id === catId), 'EXACT_WORD must filter exact word cat');
  });

  // ---------------------------------------------------------------------------
  // 7. Từ khóa đã hết hạn (expiresAt < now()) tự động không còn hiệu lực lọc
  // ---------------------------------------------------------------------------
  await t.test('7. Từ khóa đã hết hạn (expiresAt < now()) tự động không còn hiệu lực lọc', async () => {
    // Alice creates an already expired keyword mute
    const expiredKeyword = await prisma.keywordMute.create({
      data: {
        userId: alice.id,
        keyword: 'expiredterm',
        matchType: 'CONTAINS',
        muteContext: 'ALL',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      },
    });

    // Charlie posts containing 'expiredterm'
    const expiredTermPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'This post discusses expiredterm in detail' },
    });
    assert.equal(expiredTermPostRes.statusCode, 201);
    const expiredTermPostId = expiredTermPostRes.json().data.id;

    // Alice fetches feed: post MUST appear because the mute has expired
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const posts = feedRes.json().data.posts;

    assert.ok(posts.some((p) => p.id === expiredTermPostId), 'Expired keyword mute must not filter posts');

    // Clean up expired keyword
    await prisma.keywordMute.delete({ where: { id: expiredKeyword.id } });
  });

  // ---------------------------------------------------------------------------
  // 8. Bỏ mute user và gỡ từ khóa khôi phục hiển thị trên feed ngay lập tức
  // ---------------------------------------------------------------------------
  await t.test('8. Bỏ mute user và gỡ từ khóa khôi phục hiển thị trên feed ngay lập tức', async () => {
    // 8a. Unmute Bob
    const unmuteUserRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${bob.id}/mute`,
      headers: authHeaders(alice.id),
    });
    assert.equal(unmuteUserRes.statusCode, 200);
    assert.equal(unmuteUserRes.json().data.isMuted, false);

    // Verify UserMute record is deleted from DB
    const muteCheck = await prisma.userMute.findUnique({
      where: {
        unique_muter_muted: { muterId: alice.id, mutedId: bob.id },
      },
    });
    assert.equal(muteCheck, null);

    // 8b. Remove active keyword mutes (containsKwId and exactKwId)
    if (containsKwId) {
      const delKw1 = await app.inject({
        method: 'DELETE',
        url: `/api/v1/mutes/keywords/${containsKwId}`,
        headers: authHeaders(alice.id),
      });
      assert.equal(delKw1.statusCode, 200);
    }

    if (exactKwId) {
      const delKw2 = await app.inject({
        method: 'DELETE',
        url: `/api/v1/mutes/keywords/${exactKwId}`,
        headers: authHeaders(alice.id),
      });
      assert.equal(delKw2.statusCode, 200);
    }

    // Alice fetches home feed: Bob's posts and previously muted keyword posts now visible immediately
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedRes.statusCode, 200);
    const posts = feedRes.json().data.posts;

    assert.ok(posts.some((p) => p.authorId === bob.id), 'Bob posts restored immediately upon unmuting');
    assert.ok(posts.some((p) => p.content.toLowerCase().includes('crypto')), 'Crypto posts restored immediately upon keyword deletion');
    assert.ok(posts.some((p) => p.content.includes('cute cat')), 'Cat posts restored immediately upon keyword deletion');
  });

  await app.close();
});
