import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('TASK-18: Trust, Safety & Post Lifecycle Management Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  const createUser = async (tag) => {
    return prisma.user.create({
      data: {
        username: `ts_${tag}_${timestamp}`,
        email: `ts_${tag}_${timestamp}@pulse.local`,
        displayName: `Trust Safety ${tag}`,
      },
    });
  };

  const alice = await createUser('alice');
  const bob = await createUser('bob');
  const charlie = await createUser('charlie');

  // Alice follows Bob
  await prisma.follow.create({
    data: { followerId: alice.id, followingId: bob.id },
  });

  // =========================================================================
  // PILLAR 1: 15-MINUTE EDIT WINDOW & IMMUTABLE AUDIT TRAIL (PostVersion)
  // =========================================================================
  await t.test('1. Edit Post Lifecycle & Audit Trail', async (t2) => {
    // Alice creates a post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Original content by Alice with #initialTag and @bob',
        mediaUrls: ['https://pulse.social/uploads/img1.png'],
        contentWarning: 'Spoilers for episode 1',
        isSensitive: true,
      },
    });

    assert.equal(createRes.statusCode, 201);
    const originalPost = createRes.json().data;
    assert.equal(originalPost.isEdited, false);
    assert.equal(originalPost.editCount, 0);
    assert.equal(originalPost.contentWarning, 'Spoilers for episode 1');
    assert.equal(originalPost.isSensitive, true);

    // 1a. Sửa bài lần 1 trong vòng 15 phút: Snapshot bản gốc thành version 1
    const edit1Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${originalPost.id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'First edit content with #updatedTag and @charlie',
        contentWarning: 'Spoilers for episode 2',
        isSensitive: false,
      },
    });

    assert.equal(edit1Res.statusCode, 200);
    const edit1Post = edit1Res.json().data;
    assert.equal(edit1Post.isEdited, true);
    assert.equal(edit1Post.editCount, 1);
    assert.ok(edit1Post.lastEditedAt);
    assert.equal(edit1Post.content, 'First edit content with #updatedTag and @charlie');
    assert.deepEqual(edit1Post.hashtags, ['updatedtag']);
    assert.deepEqual(edit1Post.mentions, ['charlie']);

    // Check version 1 snapshot in database
    const v1Snapshot = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: {
          postId: originalPost.id,
          versionNumber: 1,
        },
      },
    });
    assert.ok(v1Snapshot);
    assert.equal(v1Snapshot.content, 'Original content by Alice with #initialTag and @bob');
    assert.equal(v1Snapshot.contentWarning, 'Spoilers for episode 1');
    assert.equal(v1Snapshot.isSensitive, true);
    assert.equal(v1Snapshot.versionNumber, 1);

    // 1b. Sửa bài lần 2: Snapshot bản trước đó thành version 2
    const edit2Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${originalPost.id}`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Second edit final version with #finalTag',
        contentWarning: null,
      },
    });

    assert.equal(edit2Res.statusCode, 200);
    const edit2Post = edit2Res.json().data;
    assert.equal(edit2Post.editCount, 2);
    assert.equal(edit2Post.content, 'Second edit final version with #finalTag');

    const v2Snapshot = await prisma.postVersion.findUnique({
      where: {
        postId_versionNumber: {
          postId: originalPost.id,
          versionNumber: 2,
        },
      },
    });
    assert.ok(v2Snapshot);
    assert.equal(v2Snapshot.content, 'First edit content with #updatedTag and @charlie');
    assert.equal(v2Snapshot.versionNumber, 2);

    // 1c. GET /api/v1/posts/:id/versions returns current and ordered versions
    const versionsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${originalPost.id}/versions`,
      headers: authHeaders(alice.id),
    });

    assert.equal(versionsRes.statusCode, 200);
    const versionsBody = versionsRes.json().data;
    assert.equal(versionsBody.postId, originalPost.id);
    assert.equal(versionsBody.current.versionNumber, 3);
    assert.equal(versionsBody.current.content, 'Second edit final version with #finalTag');
    assert.equal(versionsBody.versions.length, 2);
    assert.equal(versionsBody.versions[0].versionNumber, 1);
    assert.equal(versionsBody.versions[0].content, 'Original content by Alice with #initialTag and @bob');
    assert.equal(versionsBody.versions[1].versionNumber, 2);
    assert.equal(versionsBody.versions[1].content, 'First edit content with #updatedTag and @charlie');

    // 1d. Từ chối sửa bài của người khác: HTTP 403 FORBIDDEN
    const forbiddenRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${originalPost.id}`,
      headers: authHeaders(bob.id),
      payload: { content: 'Bob trying to modify Alice post' },
    });
    assert.equal(forbiddenRes.statusCode, 403);
    assert.equal(forbiddenRes.json().error.code, 'FORBIDDEN');

    // 1e. Từ chối sửa bài sau khi quá 15 phút: HTTP 403 EDIT_WINDOW_EXPIRED
    // Simulate expired post by changing createdAt in DB to 16 minutes ago
    const expiredTime = new Date(Date.now() - 16 * 60 * 1000);
    await prisma.post.update({
      where: { id: originalPost.id },
      data: { createdAt: expiredTime },
    });

    const expiredRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${originalPost.id}`,
      headers: authHeaders(alice.id),
      payload: { content: 'Alice trying to edit after 15 minutes window' },
    });
    assert.equal(expiredRes.statusCode, 403);
    assert.equal(expiredRes.json().error.code, 'EDIT_WINDOW_EXPIRED');

    // Restore createdAt
    await prisma.post.update({
      where: { id: originalPost.id },
      data: { createdAt: new Date() },
    });

    // 1f. Từ chối sửa bài viết đã bị xóa: HTTP 404 POST_NOT_FOUND
    const deletedPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post to be soft-deleted',
        isDeleted: true,
      },
    });

    const editDeletedRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${deletedPost.id}`,
      headers: authHeaders(alice.id),
      payload: { content: 'Edit deleted post' },
    });
    assert.equal(editDeletedRes.statusCode, 404);
    assert.equal(editDeletedRes.json().error.code, 'POST_NOT_FOUND');
  });

  // =========================================================================
  // PILLAR 2: PINNED POST TO PROFILE
  // =========================================================================
  await t.test('2. Pinned Post to Profile Lifecycle & Query Ordering', async (t2) => {
    // Alice creates two root posts and one reply
    const post1 = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post 1 by Alice',
        createdAt: new Date(Date.now() - 3000),
      },
    });

    const post2 = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Post 2 by Alice (newer)',
        createdAt: new Date(Date.now() - 1000),
      },
    });

    const replyPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Reply by Alice to Post 1',
        replyToId: post1.id,
        rootPostId: post1.id,
      },
    });

    // 2a. Ghim post1 thành công
    const pinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1.id}/pin`,
      headers: authHeaders(alice.id),
    });

    assert.equal(pinRes.statusCode, 200);
    const pinData = pinRes.json().data;
    assert.equal(pinData.pinnedPostId, post1.id);
    assert.equal(pinData.isPinned, true);

    const userWithPin = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userWithPin.pinnedPostId, post1.id);

    // 2b. Ghim post2 tự động thay thế post1
    const pin2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post2.id}/pin`,
      headers: authHeaders(alice.id),
    });
    assert.equal(pin2Res.statusCode, 200);
    assert.equal(pin2Res.json().data.pinnedPostId, post2.id);

    // 2c. Từ chối ghim reply: HTTP 400 CANNOT_PIN_REPLY
    const pinReplyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${replyPost.id}/pin`,
      headers: authHeaders(alice.id),
    });
    assert.equal(pinReplyRes.statusCode, 400);
    assert.equal(pinReplyRes.json().error.code, 'CANNOT_PIN_REPLY');

    // 2d. Từ chối ghim bài của người khác: HTTP 403 FORBIDDEN
    const pinStrangerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1.id}/pin`,
      headers: authHeaders(bob.id),
    });
    assert.equal(pinStrangerRes.statusCode, 403);
    assert.equal(pinStrangerRes.json().error.code, 'FORBIDDEN');

    // Set pin back to post1 (older post) to test ordering
    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post1.id}/pin`,
      headers: authHeaders(alice.id),
    });

    // 2e. GET /api/v1/users/:username/posts đưa pinned post lên vị trí index 0
    const profileFeedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${alice.username}/posts`,
    });

    assert.equal(profileFeedRes.statusCode, 200);
    const feedPosts = profileFeedRes.json().data.posts;
    assert.ok(feedPosts.length >= 2);
    // Index 0 must be post1 with isPinned: true
    assert.equal(feedPosts[0].id, post1.id);
    assert.equal(feedPosts[0].isPinned, true);

    // Following posts must have isPinned: false and no duplication of post1
    const post1Duplicates = feedPosts.filter((p) => p.id === post1.id);
    assert.equal(post1Duplicates.length, 1);
    assert.equal(feedPosts[1].isPinned, false);

    // 2f. Hủy ghim bài viết: DELETE /api/v1/posts/:id/pin
    const unpinRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${post1.id}/pin`,
      headers: authHeaders(alice.id),
    });
    assert.equal(unpinRes.statusCode, 200);
    assert.equal(unpinRes.json().data.isPinned, false);
    assert.equal(unpinRes.json().data.pinnedPostId, null);

    const userUnpinned = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(userUnpinned.pinnedPostId, null);
  });

  // =========================================================================
  // PILLAR 3: ONE-WAY MUTE (USERS & KEYWORDS)
  // =========================================================================
  await t.test('3. One-Way User and Keyword Muting & Stealth Filtering', async (t2) => {
    // 3a. Alice mutes Bob: preserves Follow!
    const muteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${bob.id}/mute`,
      headers: authHeaders(alice.id),
    });
    assert.equal(muteRes.statusCode, 200);
    assert.equal(muteRes.json().data.isMuted, true);

    // Verify Follow relationship is completely intact
    const followRecord = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: alice.id,
          followingId: bob.id,
        },
      },
    });
    assert.ok(followRecord, 'Follow record must NOT be deleted on mute');

    // 3b. Chặn tự mute chính mình: HTTP 400 SELF_MUTE_NOT_ALLOWED
    const selfMuteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${alice.id}/mute`,
      headers: authHeaders(alice.id),
    });
    assert.equal(selfMuteRes.statusCode, 400);
    assert.equal(selfMuteRes.json().error.code, 'SELF_MUTE_NOT_ALLOWED');

    // 3c. GET /api/v1/mutes/users returns muted users list
    const listMutesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mutes/users',
      headers: authHeaders(alice.id),
    });
    assert.equal(listMutesRes.statusCode, 200);
    const mutesList = listMutesRes.json().data.mutes;
    assert.ok(mutesList.some((m) => m.mutedId === bob.id));

    // 3d. Home timeline filters out posts from muted users
    // Bob publishes a post
    const bobPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(bob.id),
      payload: { content: 'Post by muted Bob' },
    });
    assert.equal(bobPostRes.statusCode, 201);
    const bobPostId = bobPostRes.json().data.id;

    // Alice fetches home feed: Bob's post must NOT appear
    const aliceHomeFeed = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(aliceHomeFeed.statusCode, 200);
    const homePosts = aliceHomeFeed.json().data.posts;
    assert.ok(!homePosts.some((p) => p.authorId === bob.id));

    // 3e. Search filters out muted users and their posts
    const searchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(bob.username)}`,
      headers: authHeaders(alice.id),
    });
    assert.equal(searchRes.statusCode, 200);
    assert.ok(!searchRes.json().data.users.some((u) => u.id === bob.id));
    assert.ok(!searchRes.json().data.posts.some((p) => p.authorId === bob.id));

    // 3f. Unmute Bob restores normal state
    const unmuteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${bob.id}/mute`,
      headers: authHeaders(alice.id),
    });
    assert.equal(unmuteRes.statusCode, 200);
    assert.equal(unmuteRes.json().data.isMuted, false);

    // 3g. Mute Keyword: CONTAINS, EXACT_WORD, Expiration
    // Charlie is followed by Alice
    await prisma.follow.create({
      data: { followerId: alice.id, followingId: charlie.id },
    });

    // Alice mutes keyword 'crypto' with CONTAINS
    const muteKwRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: 'Crypto',
        matchType: 'CONTAINS',
        muteContext: 'ALL',
        durationDays: 7,
      },
    });
    assert.equal(muteKwRes.statusCode, 201);
    const kwData = muteKwRes.json().data;
    assert.equal(kwData.keyword, 'crypto');
    assert.equal(kwData.matchType, 'CONTAINS');
    assert.ok(kwData.expiresAt);

    // Charlie posts about crypto and non-crypto
    await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Invest in cryptocurrency now!' },
    });

    const charlieSafePost = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Beautiful sunny day in Da Nang' },
    });
    assert.equal(charlieSafePost.statusCode, 201);

    // Alice home feed should exclude 'cryptocurrency' post but include 'Beautiful sunny day'
    const feedAfterKwMute = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedAfterKwMute.statusCode, 200);
    const postsAfterKw = feedAfterKwMute.json().data.posts;
    assert.ok(!postsAfterKw.some((p) => p.content.toLowerCase().includes('crypto')));
    assert.ok(postsAfterKw.some((p) => p.content.includes('Beautiful sunny day')));

    // Alice fetches active muted keywords list
    const listKwRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
    });
    assert.equal(listKwRes.statusCode, 200);
    const kwList = listKwRes.json().data.keywords;
    assert.ok(kwList.some((k) => k.id === kwData.id && k.keyword === 'crypto'));

    // Delete keyword mute
    const deleteKwRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mutes/keywords/${kwData.id}`,
      headers: authHeaders(alice.id),
    });
    assert.equal(deleteKwRes.statusCode, 200);

    // 3h. EXACT_WORD matching test
    const exactMuteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mutes/keywords',
      headers: authHeaders(alice.id),
      payload: {
        keyword: 'apple',
        matchType: 'EXACT_WORD',
        muteContext: 'ALL',
      },
    });
    assert.equal(exactMuteRes.statusCode, 201);
    const exactKwId = exactMuteRes.json().data.id;

    // Post containing 'apple' as exact word vs containing 'pineapple'
    const pineapplePost = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'I love fresh pineapple juice' },
    });
    assert.equal(pineapplePost.statusCode, 201);

    const applePost = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(charlie.id),
      payload: { content: 'Eating a crisp apple today' },
    });
    assert.equal(applePost.statusCode, 201);

    const feedAfterExact = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/home',
      headers: authHeaders(alice.id),
    });
    assert.equal(feedAfterExact.statusCode, 200);
    const exactPosts = feedAfterExact.json().data.posts;
    assert.ok(exactPosts.some((p) => p.content.includes('pineapple')));
    assert.ok(!exactPosts.some((p) => p.content.includes('crisp apple')));

    // Clean up exact keyword mute
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/mutes/keywords/${exactKwId}`,
      headers: authHeaders(alice.id),
    });
  });

  // =========================================================================
  // PILLAR 4: CONTENT WARNINGS & SECURITY SANITIZATION
  // =========================================================================
  await t.test('4. Content Warnings, Sensitive Flag & XSS Sanitization', async (t2) => {
    // 4a. XSS Sanitization in contentWarning
    const xssPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: 'Post with XSS payload in contentWarning',
        contentWarning: '<script>alert("XSS")</script>Sensitive Topic',
        isSensitive: true,
      },
    });

    assert.equal(xssPostRes.statusCode, 201);
    const postData = xssPostRes.json().data;
    assert.ok(!postData.contentWarning.includes('<script>'));
    assert.equal(postData.contentWarning, 'alert("XSS")Sensitive Topic');
    assert.equal(postData.isSensitive, true);

    // 4b. ActivityPub Outbox includes summary and sensitive fields
    const outboxRes = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}/outbox?page=true`,
    });

    assert.equal(outboxRes.statusCode, 200);
    const outboxPage = outboxRes.json();
    assert.ok(outboxPage.orderedItems.length > 0);
    const federatedNote = outboxPage.orderedItems[0].object;
    assert.equal(federatedNote.sensitive, true);
    assert.equal(federatedNote.summary, 'alert("XSS")Sensitive Topic');
  });

  await app.close();
});
