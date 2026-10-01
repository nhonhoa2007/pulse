import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Search & Discovery Engine: full-text search, hashtag indexing, block privacy, and trending', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Setup: Create 3 users (Alice, Bob, Charlie)
  const alice = await prisma.user.create({
    data: {
      username: `alice_search_${timestamp}`,
      email: `alice_${timestamp}@test.local`,
      displayName: `Alice Wonder_${timestamp}`,
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `bob_search_${timestamp}`,
      email: `bob_${timestamp}@test.local`,
      displayName: `Bob Builder_${timestamp}`,
    },
  });

  const charlie = await prisma.user.create({
    data: {
      username: `charlie_search_${timestamp}`,
      email: `charlie_${timestamp}@test.local`,
      displayName: `Charlie Chaplin_${timestamp}`,
    },
  });

  // Alice follows Bob
  await app.inject({
    method: 'POST',
    url: '/api/v1/graph/follow',
    headers: { 'x-user-id': alice.id },
    payload: { targetUserId: bob.id },
  });

  // Create Posts
  const post1Res = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': alice.id },
    payload: {
      content: `Exploring quantum computing advances today #quantum_${timestamp} #deeptech_${timestamp}`,
    },
  });
  assert.equal(post1Res.statusCode, 201);
  const post1 = post1Res.json().data;

  const post2Res = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': bob.id },
    payload: {
      content: `Classical algorithms vs quantum supremacy #quantum_${timestamp} #computing`,
    },
  });
  assert.equal(post2Res.statusCode, 201);
  const post2 = post2Res.json().data;

  const post3Res = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { 'x-user-id': charlie.id },
    payload: {
      content: `Gardening and urban farming secrets #greenery_${timestamp}`,
    },
  });
  assert.equal(post3Res.statusCode, 201);
  const post3 = post3Res.json().data;

  // Alice likes post2 and bookmarks post2
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post2.id}/like`,
    headers: { 'x-user-id': alice.id },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/posts/${post2.id}/bookmark`,
    headers: { 'x-user-id': alice.id },
  });

  await t.test('1. Keyword Post Search: finds posts matching query, attaches engagements and author', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=quantum+supremacy&type=posts`,
      headers: { 'x-user-id': alice.id },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.posts));
    assert.equal(body.data.query, 'quantum supremacy');

    const foundPost2 = body.data.posts.find((p) => p.id === post2.id);
    assert.ok(foundPost2, 'Post 2 should be found in search results');
    assert.equal(foundPost2.isLiked, true, 'Alice should have isLiked=true on post 2');
    assert.equal(foundPost2.isBookmarked, true, 'Alice should have isBookmarked=true on post 2');
    assert.equal(foundPost2.author.username, bob.username);
  });

  await t.test('2. Hashtag Post Search: strips "#" or matches posts with hashtags containing tag', async () => {
    const resWithHash = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=%23quantum_${timestamp}`,
      headers: { 'x-user-id': alice.id },
    });

    assert.equal(resWithHash.statusCode, 200);
    const bodyHash = resWithHash.json();
    assert.equal(bodyHash.success, true);
    assert.ok(bodyHash.data.posts.length >= 2, 'Both post1 and post2 should match hashtag');

    const postIds = bodyHash.data.posts.map((p) => p.id);
    assert.ok(postIds.includes(post1.id));
    assert.ok(postIds.includes(post2.id));
  });

  await t.test('3. User Search: searches by username and display name, attaches isFollowing', async () => {
    // Search by username prefix with @
    const resByUsername = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=@bob_search_${timestamp}&type=users`,
      headers: { 'x-user-id': alice.id },
    });

    assert.equal(resByUsername.statusCode, 200);
    const bodyUser = resByUsername.json();
    assert.equal(bodyUser.success, true);
    assert.ok(bodyUser.data.users.length >= 1);
    const bobResult = bodyUser.data.users.find((u) => u.id === bob.id);
    assert.ok(bobResult, 'Bob should be returned');
    assert.equal(bobResult.isFollowing, true, 'Alice follows Bob, isFollowing must be true');

    // Search by display name
    const resByDisplayName = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=Chaplin_${timestamp}&type=users`,
      headers: { 'x-user-id': alice.id },
    });

    assert.equal(resByDisplayName.statusCode, 200);
    const charlieResult = resByDisplayName.json().data.users.find((u) => u.id === charlie.id);
    assert.ok(charlieResult, 'Charlie should be returned by display name search');
    assert.equal(charlieResult.isFollowing, false, 'Alice does not follow Charlie');
  });

  await t.test('4. Block Privacy Invariant: blocked users and their posts MUST NOT appear in search results', async () => {
    // Charlie blocks Alice
    const blockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/graph/block',
      headers: { 'x-user-id': charlie.id },
      payload: { targetUserId: alice.id },
    });
    assert.equal(blockRes.statusCode, 200);

    // Alice searches for Charlie's post keyword 'gardening'
    const alicePostSearch = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=gardening&type=posts`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(alicePostSearch.statusCode, 200);
    const alicePosts = alicePostSearch.json().data.posts;
    const hasCharliePost = alicePosts.some((p) => p.authorId === charlie.id || p.id === post3.id);
    assert.equal(hasCharliePost, false, 'Charlie post must NOT appear to Alice who was blocked by Charlie');

    // Alice searches for Charlie user
    const aliceUserSearch = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=charlie_search_${timestamp}&type=users`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(aliceUserSearch.statusCode, 200);
    const hasCharlieUser = aliceUserSearch.json().data.users.some((u) => u.id === charlie.id);
    assert.equal(hasCharlieUser, false, 'Charlie profile must NOT appear to Alice who was blocked by Charlie');

    // Conversely, Charlie searches for Alice's posts
    const charliePostSearch = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=quantum&type=posts`,
      headers: { 'x-user-id': charlie.id },
    });
    assert.equal(charliePostSearch.statusCode, 200);
    const charliePosts = charliePostSearch.json().data.posts;
    const hasAlicePost = charliePosts.some((p) => p.authorId === alice.id || p.id === post1.id);
    assert.equal(hasAlicePost, false, 'Alice post must NOT appear to Charlie (blocked user)');
  });

  await t.test('5. Trending Endpoint: returns ranked hashtag list with postsCount and score', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/trending?limit=50',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.trending));
    assert.ok(body.data.trending.length > 0, 'Trending hashtags should not be empty');

    // The hashtag #quantum_${timestamp} has 2 posts, should rank higher than single post tags
    const quantumTag = body.data.trending.find((t) => t.tag === `quantum_${timestamp}`);
    assert.ok(quantumTag, `Tag quantum_${timestamp} should be in trending`);
    assert.equal(quantumTag.postsCount, 2, 'Tag should have postsCount = 2');
    assert.ok(typeof quantumTag.score === 'number', 'Trending score should be a number');

    // Check descending ranking order
    for (let i = 0; i < body.data.trending.length - 1; i++) {
      const current = body.data.trending[i];
      const next = body.data.trending[i + 1];
      const currentMetric = current.score ?? current.postsCount;
      const nextMetric = next.score ?? next.postsCount;
      assert.ok(
        currentMetric >= nextMetric,
        `Trending should be sorted descending: ${current.tag} (${currentMetric}) vs ${next.tag} (${nextMetric})`
      );
    }
  });

  await t.test('6. Input Validation & Pagination Edge Cases', async () => {
    // Missing query parameter 'q'
    const missingQRes = await app.inject({
      method: 'GET',
      url: '/api/v1/search',
    });
    assert.equal(missingQRes.statusCode, 400);
    const missingQBody = missingQRes.json();
    assert.equal(missingQBody.success, false);
    assert.equal(missingQBody.error.code, 'BAD_REQUEST');

    // Empty trimmed query
    const emptyQRes = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=%20%20',
    });
    assert.equal(emptyQRes.statusCode, 400);

    // type='all' returns both matching posts and users
    const allRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=quantum&type=all`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(allRes.statusCode, 200);
    const allBody = allRes.json();
    assert.equal(allBody.success, true);
    assert.ok(allBody.data.posts.length >= 1, 'Should find posts mentioning quantum');
    assert.ok(Array.isArray(allBody.data.users));

    // Pagination limit & offset
    const pageRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=quantum&type=posts&limit=1&offset=0`,
      headers: { 'x-user-id': alice.id },
    });
    assert.equal(pageRes.statusCode, 200);
    const pageBody = pageRes.json();
    assert.equal(pageBody.data.posts.length, 1);
  });

  await app.close();
});

