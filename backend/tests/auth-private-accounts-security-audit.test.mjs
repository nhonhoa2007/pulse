import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { buildApp } from '../dist/app.js';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { tokenRevocationManager } from '../dist/modules/auth/TokenRevocationManager.js';
import { authService } from '../dist/modules/auth/AuthService.js';

test('SECURITY AUDIT & PENETRATION VERIFICATION SUITE: Auth Hardening & Private Accounts (TASK-21)', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const JWT_SECRET = process.env.JWT_SECRET || 'pulse-secret-key-2026-production-token';

  function extractCookie(headers, cookieName) {
    const rawCookie = headers['set-cookie'];
    if (!rawCookie) return null;
    const cookies = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
    for (const c of cookies) {
      const match = c.match(new RegExp(`^${cookieName}=([^;]+)`));
      if (match) return match[1];
    }
    return null;
  }

  function getRawCookieHeader(headers, cookieName) {
    const rawCookie = headers['set-cookie'];
    if (!rawCookie) return null;
    const cookies = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
    return cookies.find((c) => c.startsWith(`${cookieName}=`)) || null;
  }

  // =========================================================================
  // AUDIT VECTOR 1: COOKIE SECURITY FLAGS & ANTI-XSS ATTRIBUTE BOUNDS
  // =========================================================================
  let user1 = null;
  let user1AccessToken = null;
  let user1RefreshToken = null;

  await t.test('AUDIT 1.1: Register sets HttpOnly, SameSite=Strict, Path=/api/v1/auth, Max-Age cookie & zero body leakage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_aud_u1_${timestamp}`,
        email: `sec_aud_u1_${timestamp}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Audit User One',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.accessToken);

    // ANTI-XSS INVARIANT: Refresh token must NEVER be leaked in JSON body
    assert.equal(body.data.refreshToken, undefined, 'Body must NOT leak refreshToken');

    // Cookie attribute audit
    const cookieHeader = getRawCookieHeader(res.headers, 'pulse_refresh_token');
    assert.ok(cookieHeader, 'pulse_refresh_token cookie must be present');
    assert.match(cookieHeader, /HttpOnly/i, 'Cookie must have HttpOnly flag');
    assert.match(cookieHeader, /SameSite=Strict/i, 'Cookie must have SameSite=Strict');
    assert.match(cookieHeader, /Path=\/api\/v1\/auth/i, 'Cookie must be constrained to Path=/api/v1/auth');
    assert.match(cookieHeader, /Max-Age=604800/i, 'Cookie must have 7-day max-age (604800s)');

    user1 = body.data.user;
    user1AccessToken = body.data.accessToken;
    user1RefreshToken = extractCookie(res.headers, 'pulse_refresh_token');
    assert.ok(user1RefreshToken);
  });

  await t.test('AUDIT 1.2: Login sets HttpOnly, SameSite=Strict, Path=/api/v1/auth & zero body leakage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: user1.username,
        password: 'Password123!',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.refreshToken, undefined, 'Login body must NOT leak refreshToken');

    const cookieHeader = getRawCookieHeader(res.headers, 'pulse_refresh_token');
    assert.ok(cookieHeader);
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Strict/i);
    assert.match(cookieHeader, /Path=\/api\/v1\/auth/i);

    user1AccessToken = body.data.accessToken;
    user1RefreshToken = extractCookie(res.headers, 'pulse_refresh_token');
  });

  await t.test('AUDIT 1.3: Secure flag enforcement when COOKIE_SECURE=true or production environment', async () => {
    const origEnv = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = 'true';

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: user1.username,
          password: 'Password123!',
        },
      });

      assert.equal(res.statusCode, 200);
      const cookieHeader = getRawCookieHeader(res.headers, 'pulse_refresh_token');
      assert.match(cookieHeader, /Secure/i, 'Cookie must include Secure flag when COOKIE_SECURE=true');
    } finally {
      process.env.COOKIE_SECURE = origEnv;
    }
  });

  await t.test('AUDIT 1.4: Logout clears cookie with matching Path, HttpOnly, and SameSite=Strict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${user1AccessToken}`,
        cookie: `pulse_refresh_token=${user1RefreshToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const cookieHeader = getRawCookieHeader(res.headers, 'pulse_refresh_token');
    assert.ok(cookieHeader, 'Clear cookie header must be sent');
    assert.match(cookieHeader, /pulse_refresh_token=;/);
    assert.match(cookieHeader, /Path=\/api\/v1\/auth/i);
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Strict/i);
  });

  // =========================================================================
  // AUDIT VECTOR 2: REFRESH TOKEN ROTATION, REPLAY REJECTION & RACE DEFENSE
  // =========================================================================
  let victim = null;
  let victimAccessToken = null;
  let victimRefreshToken = null;

  await t.test('AUDIT 2.1: Refresh Token Rotation mints new pair and invalidates old token', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_victim_${timestamp}`,
        email: `sec_victim_${timestamp}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Victim User',
      },
    });
    victim = regRes.json().data.user;
    victimAccessToken = regRes.json().data.accessToken;
    victimRefreshToken = extractCookie(regRes.headers, 'pulse_refresh_token');

    // Perform rotation
    const rotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `pulse_refresh_token=${victimRefreshToken}`,
      },
    });

    assert.equal(rotRes.statusCode, 200);
    const rotBody = rotRes.json();
    assert.ok(rotBody.data.accessToken);
    assert.notEqual(rotBody.data.accessToken, victimAccessToken);

    const newCookie = extractCookie(rotRes.headers, 'pulse_refresh_token');
    assert.ok(newCookie);
    assert.notEqual(newCookie, victimRefreshToken, 'Rotated cookie must be a new cryptographically random token');

    // Verify old refresh token in DB is marked isRevoked: true
    const oldTokenHash = (await prisma.refreshToken.findMany({
      where: { userId: victim.id, isRevoked: true },
    }));
    assert.ok(oldTokenHash.length >= 1, 'Old refresh token must be revoked in DB');
  });

  await t.test('AUDIT 2.2: Serial Replay Attack - Re-presenting old revoked refresh token fails with 401 INVALID_REFRESH_TOKEN', async () => {
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `pulse_refresh_token=${victimRefreshToken}`, // Reusing old rotated token!
      },
    });

    assert.equal(replayRes.statusCode, 401);
    assert.equal(replayRes.json().error.code, 'INVALID_REFRESH_TOKEN');
  });

  await t.test('AUDIT 2.3: RFC 6819 Family Revocation - Replay triggers blanket revocation of all user tokens', async () => {
    // All refresh tokens for victim must now be isRevoked: true
    const activeTokens = await prisma.refreshToken.findMany({
      where: { userId: victim.id, isRevoked: false },
    });
    assert.equal(activeTokens.length, 0, 'Replay attack must invalidate entire token family');
  });

  await t.test('AUDIT 2.4: Concurrency Race Condition Replay Defense (Atomic CAS)', async () => {
    // Register new fresh user
    const raceUserRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_race_${timestamp}`,
        email: `sec_race_${timestamp}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Race User',
      },
    });
    const freshCookie = extractCookie(raceUserRes.headers, 'pulse_refresh_token');

    // Fire 5 simultaneous refresh requests with the EXACT SAME refresh token concurrently
    const concurrentRequests = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `pulse_refresh_token=${freshCookie}` } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `pulse_refresh_token=${freshCookie}` } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `pulse_refresh_token=${freshCookie}` } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `pulse_refresh_token=${freshCookie}` } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: `pulse_refresh_token=${freshCookie}` } }),
    ]);

    const statusCodes = concurrentRequests.map((r) => r.statusCode);
    const successCount = statusCodes.filter((c) => c === 200).length;
    const rejectedCount = statusCodes.filter((c) => c === 401).length;

    // Concurrency Invariant: At most 1 request may succeed; all racing replays MUST be rejected
    assert.ok(successCount <= 1, `At most 1 concurrent refresh can succeed (got ${successCount})`);
    assert.ok(rejectedCount >= 4, `At least 4 concurrent requests must be rejected (got ${rejectedCount})`);
  });

  // =========================================================================
  // AUDIT VECTOR 3: ZERO-TRUST TOKEN DENYLIST & IDENTITY SPOOFING DEFENSE
  // =========================================================================
  let loggedInUser = null;
  let activeAccessToken = null;
  let activeRefreshToken = null;

  await t.test('AUDIT 3.1: Token Denylist - Logout immediately revokes access token across all endpoints', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_denylist_${timestamp}`,
        email: `sec_denylist_${timestamp}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Denylist User',
      },
    });
    loggedInUser = regRes.json().data.user;
    activeAccessToken = regRes.json().data.accessToken;
    activeRefreshToken = extractCookie(regRes.headers, 'pulse_refresh_token');

    // Verify token works on /me
    const preRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${activeAccessToken}` },
    });
    assert.equal(preRes.statusCode, 200);

    // Call logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${activeAccessToken}`,
        cookie: `pulse_refresh_token=${activeRefreshToken}`,
      },
    });
    assert.equal(logoutRes.statusCode, 200);

    // Token must be registered in TokenRevocationManager
    assert.equal(tokenRevocationManager.isRevoked(activeAccessToken), true);

    // Verify token is blocked with 401 TOKEN_REVOKED across multiple endpoints
    const endpoints = [
      { method: 'GET', url: '/api/v1/auth/me' },
      { method: 'POST', url: '/api/v1/posts', payload: { content: 'Should fail' } },
      { method: 'GET', url: '/api/v1/feed' },
      { method: 'GET', url: '/api/v1/users/follow-requests' },
    ];

    for (const ep of endpoints) {
      const checkRes = await app.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${activeAccessToken}` },
        ...(ep.payload ? { payload: ep.payload } : {}),
      });
      assert.equal(checkRes.statusCode, 401, `Endpoint ${ep.url} must reject revoked token with 401`);
      assert.equal(checkRes.json().error.code, 'TOKEN_REVOKED');
    }
  });

  await t.test('AUDIT 3.2: Case-Insensitive Bearer Scheme & Format Compliance', async () => {
    // Generate fresh token
    const token = authService.generateAccessToken(loggedInUser.id, loggedInUser.username);

    // Test lowercase bearer
    const lowerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `bearer ${token}` },
    });
    assert.equal(lowerRes.statusCode, 200, 'RFC 6750 requires case-insensitive bearer header');

    // Test uppercase BEARER
    const upperRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `BEARER ${token}` },
    });
    assert.equal(upperRes.statusCode, 200, 'BEARER header must be accepted');
  });

  await t.test('AUDIT 3.3: Production Zero-Trust Guard - Invalid Bearer token never falls through to x-user-id', async () => {
    // Supplying an invalid Bearer token with an x-user-id spoof attempt must fail
    const spoofRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer invalid.bogus.token',
        'x-user-id': loggedInUser.id,
      },
    });

    assert.equal(spoofRes.statusCode, 401, 'Invalid Bearer token must NOT fall through to x-user-id header');
  });

  // =========================================================================
  // AUDIT VECTOR 4: PRIVATE ACCOUNT PRIVACY INVARIANTS & LEAKAGE DEFENSE
  // =========================================================================
  let privAlice = null;
  let privAliceToken = null;
  let pubBob = null;
  let pubBobToken = null;
  let strangerEve = null;
  let strangerEveToken = null;
  let followerCharlie = null;
  let followerCharlieToken = null;

  await t.test('AUDIT 4.1: Setup Private Alice, Public Bob, Stranger Eve & Follower Charlie', async () => {
    const ts = String(timestamp).slice(-6);

    // Alice (Private)
    const aRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_al_${ts}`,
        email: `sec_al_${ts}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Alice Private',
      },
    });
    privAlice = aRes.json().data.user;
    privAliceToken = aRes.json().data.accessToken;

    // Bob (Public)
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_bob_${ts}`,
        email: `sec_bob_${ts}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Bob Public',
      },
    });
    pubBob = bRes.json().data.user;
    pubBobToken = bRes.json().data.accessToken;

    // Eve (Stranger)
    const eRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_eve_${ts}`,
        email: `sec_eve_${ts}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Eve Stranger',
      },
    });
    strangerEve = eRes.json().data.user;
    strangerEveToken = eRes.json().data.accessToken;

    // Charlie (Follower)
    const cRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_cha_${ts}`,
        email: `sec_cha_${ts}@pulse.audit`,
        password: 'Password123!',
        displayName: 'Charlie Follower',
      },
    });
    followerCharlie = cRes.json().data.user;
    followerCharlieToken = cRes.json().data.accessToken;

    // Make Alice account private
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/profile',
      headers: { authorization: `Bearer ${privAliceToken}` },
      payload: { isPrivate: true },
    });

    // Charlie requests to follow Alice and Alice approves
    const reqRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${privAlice.id}/follow`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });
    const reqId = reqRes.json().data.followRequest.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/users/follow-requests/${reqId}/accept`,
      headers: { authorization: `Bearer ${privAliceToken}` },
    });
  });

  let aliceSecretPost = null;

  await t.test('AUDIT 4.2: Content Shield - GET /users/:username/posts returns posts: [] and isLocked: true for Stranger Eve', async () => {
    // Alice posts a secret post
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${privAliceToken}` },
      payload: { content: 'Alice confidential journal entry #audit_private_secret' },
    });
    assert.equal(postRes.statusCode, 201);
    aliceSecretPost = postRes.json().data;

    // Eve (stranger) attempts to read Alice posts
    const eveRead = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${privAlice.username}/posts`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });

    assert.equal(eveRead.statusCode, 200);
    const body = eveRead.json();
    assert.equal(body.data.isLocked, true);
    assert.deepEqual(body.data.posts, [], 'Eve must receive strictly empty array');

    // Charlie (approved follower) can read Alice posts
    const charlieRead = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${privAlice.username}/posts`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });
    assert.equal(charlieRead.statusCode, 200);
    assert.ok(charlieRead.json().data.posts.length >= 1);
  });

  await t.test('AUDIT 4.3: Social Graph Shield - Followers/Following lists blocked with 403 ACCOUNT_LOCKED for Stranger Eve', async () => {
    // Eve tries to list Alice followers
    const followersRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${privAlice.username}/followers`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });
    assert.equal(followersRes.statusCode, 403);
    assert.equal(followersRes.json().error.code, 'ACCOUNT_LOCKED');

    // Eve tries to list Alice following
    const followingRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${privAlice.username}/following`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });
    assert.equal(followingRes.statusCode, 403);
    assert.equal(followingRes.json().error.code, 'ACCOUNT_LOCKED');

    // Charlie (approved follower) can view followers
    const charlieFollowers = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${privAlice.username}/followers`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });
    assert.equal(charlieFollowers.statusCode, 200);
    assert.equal(charlieFollowers.json().data.isLocked, false);
  });

  await t.test('AUDIT 4.4: ActivityPub Outbox Lockdown - Zero federation data leakage for private accounts', async () => {
    // Unauthenticated GET on outbox returns totalItems: 0
    const outboxRes = await app.inject({
      method: 'GET',
      url: `/users/${privAlice.username}/outbox`,
    });
    assert.equal(outboxRes.statusCode, 200);
    const outbox = outboxRes.json();
    assert.equal(outbox.totalItems, 0);

    // Outbox page returns empty orderedItems
    const pageRes = await app.inject({
      method: 'GET',
      url: `/users/${privAlice.username}/outbox?page=true`,
    });
    assert.equal(pageRes.statusCode, 200);
    assert.deepEqual(pageRes.json().orderedItems, []);
  });

  await t.test('AUDIT 4.5: Conversation Thread Privacy - Private user replies to public posts never leak to unapproved viewers', async () => {
    // 1. Bob (public) posts a thread root post
    const bobPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${pubBobToken}` },
      payload: { content: 'Bob Public Discussion Post' },
    });
    const bobRootPost = bobPostRes.json().data;

    // 2. Alice (private) replies to Bob's public post
    const aliceReplyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${privAliceToken}` },
      payload: { content: 'Alice Secret Reply to Bob', replyToId: bobRootPost.id },
    });
    assert.equal(aliceReplyRes.statusCode, 201);
    const aliceReply = aliceReplyRes.json().data;

    // 3. Eve (stranger, does not follow Alice) views Bob's public thread
    const eveThreadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${bobRootPost.id}/thread`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });
    assert.equal(eveThreadRes.statusCode, 200);
    const eveThread = eveThreadRes.json().data;

    // INVARIANT: Eve must NOT see Alice's private reply in thread or replies list!
    const eveSeesAliceReply = eveThread.replies.some((r) => r.id === aliceReply.id);
    assert.equal(eveSeesAliceReply, false, 'Private user reply must NEVER leak in thread to non-followers');

    // 4. Charlie (approved follower of Alice) views Bob's public thread
    const charlieThreadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${bobRootPost.id}/thread`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });
    assert.equal(charlieThreadRes.statusCode, 200);
    const charlieThread = charlieThreadRes.json().data;

    // Charlie DOES see Alice's reply because Charlie follows Alice
    const charlieSeesAliceReply = charlieThread.replies.some((r) => r.id === aliceReply.id);
    assert.equal(charlieSeesAliceReply, true, 'Approved follower Charlie must see Alice reply in thread');
  });

  await t.test('AUDIT 4.6: Explore Trending Engine strictly ignores hashtags from private posts', async () => {
    // Check trending list
    const trendingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/trending',
    });

    assert.equal(trendingRes.statusCode, 200);
    const trendingTags = trendingRes.json().data.trending;

    // INVARIANT: Alice's hashtag '#audit_private_secret' must NOT appear in global public trending
    const isSecretLeaked = trendingTags.some((t) => t.tag.toLowerCase().includes('audit_private_secret'));
    assert.equal(isSecretLeaked, false, 'Private account hashtags must NEVER leak to public Trending');
  });

  await t.test('AUDIT 4.7: Algorithmic For-You Feed strictly excludes private posts for non-followers', async () => {
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you',
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });

    assert.equal(feedRes.statusCode, 200);
    const feedPosts = feedRes.json().data.posts;
    const hasAlicePost = feedPosts.some((p) => p.authorId === privAlice.id);
    assert.equal(hasAlicePost, false, 'Alice private post must never leak into Stranger Eve For-You feed');
  });

  // =========================================================================
  // AUDIT VECTOR 5: INTERACTION BARRIERS (REPLY, QUOTE, REPOST, LIKE, VOTE)
  // =========================================================================
  await t.test('AUDIT 5.1: Replying to a Private Post by non-follower is rejected with 403 FORBIDDEN', async () => {
    const replyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${strangerEveToken}` },
      payload: {
        content: 'Eve trying to spam Alice private post',
        replyToId: aliceSecretPost.id,
      },
    });

    assert.equal(replyRes.statusCode, 403, 'Non-follower must NOT be permitted to reply to a private post');
  });

  await t.test('AUDIT 5.2: Quoting a Private Post is strictly forbidden with 403 to prevent data exfiltration', async () => {
    // Charlie (even though a follower) cannot quote Alice private post to the public
    const quoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${followerCharlieToken}` },
      payload: {
        content: 'Charlie trying to quote Alice private post publicly',
        quoteOfId: aliceSecretPost.id,
      },
    });

    assert.equal(quoteRes.statusCode, 403, 'Quoting private post must be rejected with 403');
  });

  await t.test('AUDIT 5.3: Reposting a Private Post is strictly forbidden with 403', async () => {
    const repostRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${aliceSecretPost.id}/repost`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });

    assert.equal(repostRes.statusCode, 403, 'Reposting private post must be rejected with 403');
  });

  await t.test('AUDIT 5.4: Liking a Private Post by non-follower is rejected with 403 FORBIDDEN', async () => {
    const likeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${aliceSecretPost.id}/like`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
    });

    assert.equal(likeRes.statusCode, 403, 'Non-follower cannot like a private post');

    // Follower Charlie CAN like Alice private post
    const charlieLike = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${aliceSecretPost.id}/like`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
    });
    assert.equal(charlieLike.statusCode, 200);
    assert.equal(charlieLike.json().data.liked, true);
  });

  await t.test('AUDIT 5.5: Voting on a Poll attached to a Private Post by non-follower is rejected with 403', async () => {
    // Alice creates a private poll
    const pollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: { authorization: `Bearer ${privAliceToken}` },
      payload: {
        question: 'Alice Private Poll Question?',
        choices: ['Secret Option A', 'Secret Option B'],
      },
    });
    assert.equal(pollRes.statusCode, 201);
    const poll = pollRes.json().data;

    // Eve (non-follower) attempts to vote on Alice's private poll
    const eveVote = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${poll.id}/vote`,
      headers: { authorization: `Bearer ${strangerEveToken}` },
      payload: { choiceIndex: 0 },
    });
    assert.equal(eveVote.statusCode, 403, 'Non-follower cannot vote on a poll in a private post');

    // Follower Charlie CAN vote on Alice's private poll
    const charlieVote = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${poll.id}/vote`,
      headers: { authorization: `Bearer ${followerCharlieToken}` },
      payload: { choiceIndex: 0 },
    });
    assert.equal(charlieVote.statusCode, 200);
    assert.equal(charlieVote.json().data.totalVotes, 1);
  });
});
