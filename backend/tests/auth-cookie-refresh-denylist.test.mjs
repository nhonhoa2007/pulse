import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.ts';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { tokenRevocationManager } from '../src/modules/auth/TokenRevocationManager.ts';

describe('TASK-21: Auth Hardening, HttpOnly Cookie Sessions, Token Rotation & Denylist Suite', () => {
  const timestamp = Date.now();
  const JWT_SECRET = process.env.JWT_SECRET || 'pulse-secret-key-2026-production-token';

  // Helper to extract cookie value and properties from Set-Cookie headers
  function extractCookie(headers, cookieName) {
    const rawCookie = headers['set-cookie'];
    if (!rawCookie) return { value: null, raw: null };
    const cookies = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
    for (const c of cookies) {
      const match = c.match(new RegExp(`^${cookieName}=([^;]+)`));
      if (match) {
        return {
          value: match[1],
          raw: c,
          isHttpOnly: /HttpOnly/i.test(c),
          isSameSiteStrict: /SameSite=Strict/i.test(c),
          hasCorrectPath: /Path=\/api\/v1\/auth/i.test(c),
          maxAge: (() => {
            const m = c.match(/Max-Age=([0-9]+)/i);
            return m ? parseInt(m[1], 10) : null;
          })(),
        };
      }
    }
    return { value: null, raw: null };
  }

  // Cleanup helper for created test entities
  const createdUserIds = new Set();
  after(async () => {
    if (createdUserIds.size > 0) {
      const ids = Array.from(createdUserIds);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.revokedToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  // =========================================================================
  // PILLAR 1: HTTPONLY COOKIE DUAL-TOKEN PROVISIONING (REGISTER & LOGIN)
  // =========================================================================
  describe('Pillar 1: HttpOnly Cookie Dual-Token Provisioning', () => {
    let regUser = null;
    let regAccessToken = null;
    let regRefreshToken = null;

    it('1.1 POST /api/v1/auth/register: mints 15m Access Token & sets HttpOnly, SameSite=Strict cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `cookie_usr_${timestamp}`,
          email: `cookie_usr_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Cookie User 1',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.accessToken, 'Must return accessToken');
      assert.ok(body.data.token, 'Must return legacy token alias');
      assert.equal(body.data.user.username, `cookie_usr_${timestamp}`);
      assert.equal(body.data.user.isPrivate, false, 'Default isPrivate must be false');
      assert.equal(body.data.user.passwordHash, undefined, 'passwordHash must never be exposed');

      createdUserIds.add(body.data.user.id);
      regUser = body.data.user;
      regAccessToken = body.data.accessToken;

      // Verify Access Token lifespan: exactly 15 minutes (900 seconds)
      const decoded = jwt.decode(regAccessToken);
      assert.ok(decoded.exp && decoded.iat);
      assert.equal(decoded.exp - decoded.iat, 900, 'Access Token lifespan must be exactly 900 seconds');

      // Verify Set-Cookie header properties
      const cookieInfo = extractCookie(res.headers, 'pulse_refresh_token');
      assert.ok(cookieInfo.value, 'Must extract pulse_refresh_token cookie value');
      assert.equal(cookieInfo.isHttpOnly, true, 'Cookie must be HttpOnly');
      assert.equal(cookieInfo.isSameSiteStrict, true, 'Cookie must be SameSite=Strict');
      assert.equal(cookieInfo.hasCorrectPath, true, 'Cookie Path must be /api/v1/auth');
      assert.equal(cookieInfo.maxAge, 7 * 24 * 60 * 60, 'Cookie Max-Age must be 7 days (604800s)');
      regRefreshToken = cookieInfo.value;

      // Zero-Trust Check: Refresh Token is NEVER present in JSON response body
      assert.equal(body.data.refreshToken, undefined, 'Refresh token must NOT leak into JSON response');

      // Verify RefreshToken record in PostgreSQL
      const tokenHash = crypto.createHash('sha256').update(regRefreshToken).digest('hex');
      const tokenInDb = await prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      assert.ok(tokenInDb, 'Hashed refresh token must exist in PostgreSQL');
      assert.equal(tokenInDb.userId, regUser.id);
      assert.equal(tokenInDb.isRevoked, false);
      assert.ok(tokenInDb.expiresAt > new Date());
    });

    it('1.2 POST /api/v1/auth/login: authenticates with username and issues fresh tokens & cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: regUser.username,
          password: 'Password123!',
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.accessToken);

      const cookieInfo = extractCookie(res.headers, 'pulse_refresh_token');
      assert.ok(cookieInfo.value);
      assert.equal(cookieInfo.isHttpOnly, true);
      assert.equal(cookieInfo.isSameSiteStrict, true);
      assert.notEqual(cookieInfo.value, regRefreshToken, 'Login must generate a fresh refresh token');
    });

    it('1.3 POST /api/v1/auth/login: authenticates with email and issues fresh tokens & cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: `cookie_usr_${timestamp}@pulse.social`,
          password: 'Password123!',
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.user.id, regUser.id);

      const cookieInfo = extractCookie(res.headers, 'pulse_refresh_token');
      assert.ok(cookieInfo.value);
    });

    it('1.4 POST /api/v1/auth/login: rejects incorrect password with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: regUser.username,
          password: 'WrongPassword!',
        },
      });

      assert.equal(res.statusCode, 401);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'UNAUTHORIZED');
      assert.equal(res.headers['set-cookie'], undefined, 'Must not set cookie on failed login');
    });

    it('1.5 POST /api/v1/auth/login: rejects non-existent identifier with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: `ghost_user_${timestamp}`,
          password: 'Password123!',
        },
      });

      assert.equal(res.statusCode, 401);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'UNAUTHORIZED');
    });
  });

  // =========================================================================
  // PILLAR 2: REFRESH TOKEN ROTATION & CONTINUITY
  // =========================================================================
  describe('Pillar 2: Refresh Token Rotation & Session Continuity', () => {
    let rotationUser = null;
    let initialAccessToken = null;
    let currentRefreshToken = null;

    before(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `rotate_${timestamp}`,
          email: `rotate_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Rotation User',
        },
      });
      const body = res.json();
      createdUserIds.add(body.data.user.id);
      rotationUser = body.data.user;
      initialAccessToken = body.data.accessToken;
      currentRefreshToken = extractCookie(res.headers, 'pulse_refresh_token').value;
    });

    it('2.1 POST /api/v1/auth/refresh: rotates token via HttpOnly cookie and invalidates old token', async () => {
      const oldToken = currentRefreshToken;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `pulse_refresh_token=${oldToken}`,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.accessToken);
      assert.notEqual(body.data.accessToken, initialAccessToken, 'New access token must differ from old one');

      const cookieInfo = extractCookie(res.headers, 'pulse_refresh_token');
      assert.ok(cookieInfo.value);
      assert.notEqual(cookieInfo.value, oldToken, 'Rotated refresh token must differ from original');
      currentRefreshToken = cookieInfo.value;

      // Verify in DB that old token is revoked
      const oldTokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
      const oldInDb = await prisma.refreshToken.findUnique({
        where: { tokenHash: oldTokenHash },
      });
      assert.ok(oldInDb);
      assert.equal(oldInDb.isRevoked, true, 'Old token must be marked isRevoked: true');

      // Verify in DB that new token is active
      const newTokenHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');
      const newInDb = await prisma.refreshToken.findUnique({
        where: { tokenHash: newTokenHash },
      });
      assert.ok(newInDb);
      assert.equal(newInDb.isRevoked, false, 'New token must be active');
    });

    it('2.2 POST /api/v1/auth/refresh: supports body fallback { refreshToken } when cookie is absent', async () => {
      const oldToken = currentRefreshToken;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refreshToken: oldToken,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.accessToken);

      const cookieInfo = extractCookie(res.headers, 'pulse_refresh_token');
      assert.ok(cookieInfo.value);
      assert.notEqual(cookieInfo.value, oldToken);
      currentRefreshToken = cookieInfo.value;
    });

    it('2.3 Chain Rotation: executes consecutive rotations maintaining valid session lifecycle', async () => {
      for (let i = 1; i <= 3; i++) {
        const prevToken = currentRefreshToken;
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: {
            cookie: `pulse_refresh_token=${prevToken}`,
          },
        });

        assert.equal(res.statusCode, 200, `Rotation hop ${i} must succeed`);
        const body = res.json();
        assert.ok(body.data.accessToken);

        // Verify newly minted access token is valid on protected endpoint
        const meRes = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: {
            authorization: `Bearer ${body.data.accessToken}`,
          },
        });
        assert.equal(meRes.statusCode, 200, `Hop ${i} access token must access /api/v1/auth/me`);
        assert.equal(meRes.json().data.user.id, rotationUser.id);

        currentRefreshToken = extractCookie(res.headers, 'pulse_refresh_token').value;
      }
    });
  });

  // =========================================================================
  // PILLAR 3: REPLAY ATTACK DEFENSE & FAMILY REVOCATION (RFC 6819)
  // =========================================================================
  describe('Pillar 3: Replay Attack Defense & Family Revocation', () => {
    let replayUser = null;
    let originalRefreshToken = null;
    let legitimatelyRotatedToken = null;

    before(async () => {
      // 1. Register user
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `replay_${timestamp}`,
          email: `replay_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Replay Target',
        },
      });
      const regBody = regRes.json();
      createdUserIds.add(regBody.data.user.id);
      replayUser = regBody.data.user;
      originalRefreshToken = extractCookie(regRes.headers, 'pulse_refresh_token').value;

      // 2. Perform legitimate rotation
      const rotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=${originalRefreshToken}` },
      });
      assert.equal(rotRes.statusCode, 200);
      legitimatelyRotatedToken = extractCookie(rotRes.headers, 'pulse_refresh_token').value;
    });

    it('3.1 Replay Attack: presenting already-revoked refresh token is rejected with 401 INVALID_REFRESH_TOKEN', async () => {
      // Attacker replays originalRefreshToken which was already revoked in step 2
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=${originalRefreshToken}` },
      });

      assert.equal(replayRes.statusCode, 401);
      const body = replayRes.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'INVALID_REFRESH_TOKEN');
    });

    it('3.2 Family Revocation: replay triggers blanket invalidation of all user refresh tokens', async () => {
      // Per RFC 6819 & AuthService logic: when a revoked token is replayed, ALL tokens for that user are revoked
      const allTokensInDb = await prisma.refreshToken.findMany({
        where: { userId: replayUser.id },
      });

      assert.ok(allTokensInDb.length >= 2);
      for (const token of allTokensInDb) {
        assert.equal(token.isRevoked, true, `All tokens in family must be marked isRevoked: true`);
      }

      // Subsequent attempt to use even legitimatelyRotatedToken must now FAIL
      const subRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=${legitimatelyRotatedToken}` },
      });

      assert.equal(subRes.statusCode, 401);
      assert.equal(subRes.json().error.code, 'INVALID_REFRESH_TOKEN');
    });
  });

  // =========================================================================
  // PILLAR 4: TOKEN EXPIRATION, TAMPERING & NEGATIVE TESTING
  // =========================================================================
  describe('Pillar 4: Token Expiration, Tampering & Negative Boundary Testing', () => {
    let testUser = null;
    let validToken = null;

    before(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `boundary_${timestamp}`,
          email: `boundary_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Boundary User',
        },
      });
      const body = res.json();
      createdUserIds.add(body.data.user.id);
      testUser = body.data.user;
      validToken = body.data.accessToken;
    });

    it('4.1 Rejects expired refresh token with 401 INVALID_REFRESH_TOKEN', async () => {
      // Create an explicitly expired token in DB
      const expiredRaw = crypto.randomBytes(40).toString('hex');
      const expiredHash = crypto.createHash('sha256').update(expiredRaw).digest('hex');
      await prisma.refreshToken.create({
        data: {
          userId: testUser.id,
          tokenHash: expiredHash,
          expiresAt: new Date(Date.now() - 1000 * 60), // Expired 1 minute ago
          isRevoked: false,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=${expiredRaw}` },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'INVALID_REFRESH_TOKEN');
    });

    it('4.2 Rejects completely malformed or forged refresh token string with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=forged-malicious-token-xyz` },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'INVALID_REFRESH_TOKEN');
    });

    it('4.3 Rejects refresh call with missing cookie and empty body with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'INVALID_REFRESH_TOKEN');
    });

    it('4.4 Rejects expired Access Token on protected routes with 401', async () => {
      const expiredJwt = jwt.sign(
        { userId: testUser.id, username: testUser.username },
        JWT_SECRET,
        { expiresIn: '-1s' } // Expired 1s ago
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${expiredJwt}` },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'UNAUTHORIZED');
    });

    it('4.5 Rejects forged Access Token signed with rogue secret with 401', async () => {
      const rogueJwt = jwt.sign(
        { userId: testUser.id, username: testUser.username },
        'rogue-unauthorized-secret-key-12345',
        { expiresIn: '15m' }
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${rogueJwt}` },
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'UNAUTHORIZED');
    });

    it('4.6 Rejects malformed or truncated Bearer headers with 401', async () => {
      const badHeaders = [
        'Bearer',
        'Bearer ',
        'Bearer not-a-jwt',
        'Basic dXNlcjpwYXNz',
        'InvalidScheme 12345',
      ];

      for (const h of badHeaders) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: h },
        });
        assert.equal(res.statusCode, 401, `Header "${h}" must return 401`);
      }
    });

    it('4.7 Rejects missing Authorization header on protected routes with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'UNAUTHORIZED');
    });
  });

  // =========================================================================
  // PILLAR 5: LOGOUT & INSTANT SESSION REVOCATION VIA DENYLIST
  // =========================================================================
  describe('Pillar 5: Logout & Instant Session Revocation via Denylist Cache', () => {
    let logoutUser = null;
    let activeAccessToken = null;
    let activeRefreshToken = null;

    before(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `logout_${timestamp}`,
          email: `logout_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Logout User',
        },
      });
      const body = res.json();
      createdUserIds.add(body.data.user.id);
      logoutUser = body.data.user;
      activeAccessToken = body.data.accessToken;
      activeRefreshToken = extractCookie(res.headers, 'pulse_refresh_token').value;
    });

    it('5.1 Pre-check: verified active token can access /api/v1/auth/me', async () => {
      const preRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${activeAccessToken}` },
      });
      assert.equal(preRes.statusCode, 200);
      assert.equal(preRes.json().data.user.id, logoutUser.id);
    });

    it('5.2 POST /api/v1/auth/logout: clears HttpOnly cookie, revokes RefreshToken and persists RevokedToken denylist', async () => {
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization: `Bearer ${activeAccessToken}`,
          cookie: `pulse_refresh_token=${activeRefreshToken}`,
        },
      });

      assert.equal(logoutRes.statusCode, 200);
      const logoutBody = logoutRes.json();
      assert.equal(logoutBody.success, true);

      // Verify Set-Cookie header clears the cookie
      const rawCookie = logoutRes.headers['set-cookie'];
      assert.ok(rawCookie);
      const cookieStr = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
      assert.match(cookieStr, /pulse_refresh_token=;/);

      // Verify RefreshToken marked isRevoked: true in PostgreSQL
      const tokenHash = crypto.createHash('sha256').update(activeRefreshToken).digest('hex');
      const rtInDb = await prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      assert.ok(rtInDb);
      assert.equal(rtInDb.isRevoked, true, 'Refresh token must be marked isRevoked in DB');

      // Verify token signature is registered in TokenRevocationManager
      assert.equal(tokenRevocationManager.isRevoked(activeAccessToken), true, 'In-Memory cache must confirm token revocation');

      // Verify RevokedToken record in PostgreSQL
      const signature = tokenRevocationManager.extractSignature(activeAccessToken);
      const revInDb = await prisma.revokedToken.findUnique({
        where: { tokenSignature: signature },
      });
      assert.ok(revInDb, 'Revocation signature must be persisted in PostgreSQL');
      assert.equal(revInDb.userId, logoutUser.id);
      assert.equal(revInDb.reason, 'USER_LOGOUT');
    });

    it('5.3 Instant Denylist Enforcement: Revoked Access Token is immediately rejected with 401 TOKEN_REVOKED', async () => {
      const postMeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${activeAccessToken}` },
      });

      assert.equal(postMeRes.statusCode, 401);
      const postBody = postMeRes.json();
      assert.equal(postBody.success, false);
      assert.equal(postBody.error.code, 'TOKEN_REVOKED', 'Must reject immediately with TOKEN_REVOKED code');
    });

    it('5.4 Revoked Access Token cannot execute resource-mutating operations', async () => {
      const postCreateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${activeAccessToken}` },
        payload: { content: 'This post should never be created!' },
      });

      assert.equal(postCreateRes.statusCode, 401);
      assert.equal(postCreateRes.json().error.code, 'TOKEN_REVOKED');
    });

    it('5.5 Revoked Refresh Token cannot be used to obtain new tokens', async () => {
      const refRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `pulse_refresh_token=${activeRefreshToken}` },
      });

      assert.equal(refRes.statusCode, 401);
      assert.equal(refRes.json().error.code, 'INVALID_REFRESH_TOKEN');
    });

    it('5.6 Revoked token is rejected on logout endpoint, while unauthenticated logout clears cookies cleanly', async () => {
      // Calling logout with already-revoked token is rejected with 401 TOKEN_REVOKED
      const revokedLogout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization: `Bearer ${activeAccessToken}`,
        },
      });

      assert.equal(revokedLogout.statusCode, 401);
      assert.equal(revokedLogout.json().error.code, 'TOKEN_REVOKED');

      // Calling logout without token/cookie completes gracefully (200 OK) and clears cookie
      const unauthLogout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
      });

      assert.equal(unauthLogout.statusCode, 200);
      assert.equal(unauthLogout.json().success, true);
      const rawCookie = unauthLogout.headers['set-cookie'];
      assert.ok(rawCookie);
      const cookieStr = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
      assert.match(cookieStr, /pulse_refresh_token=;/);
    });
  });

  // =========================================================================
  // PILLAR 6: CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  describe('Pillar 6: Concurrency & Stress Testing', () => {
    let concUser = null;
    let concAccessToken = null;
    let concRefreshToken = null;

    before(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `conc_${timestamp}`,
          email: `conc_${timestamp}@pulse.social`,
          password: 'Password123!',
          displayName: 'Concurrency User',
        },
      });
      const body = res.json();
      createdUserIds.add(body.data.user.id);
      concUser = body.data.user;
      concAccessToken = body.data.accessToken;
      concRefreshToken = extractCookie(res.headers, 'pulse_refresh_token').value;
    });

    it('6.1 Handles concurrent refresh requests safely without database corruption', async () => {
      // Fire 5 concurrent refresh requests using the exact same refresh token
      const promises = Array.from({ length: 5 }).map(() =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: { cookie: `pulse_refresh_token=${concRefreshToken}` },
        })
      );

      const results = await Promise.all(promises);

      // In a strict rotation model, at least one request succeeds (200), and subsequent or concurrent
      // presentations of the same token either succeed within atomic transaction or are rejected with 401
      const successes = results.filter((r) => r.statusCode === 200);
      const rejections = results.filter((r) => r.statusCode === 401);

      assert.ok(successes.length >= 1, 'At least one concurrent refresh request must succeed');
      assert.equal(successes.length + rejections.length, 5, 'All requests must resolve cleanly to either 200 or 401');

      // None of the responses should return 500 Internal Server Error
      const serverErrors = results.filter((r) => r.statusCode >= 500);
      assert.equal(serverErrors.length, 0, 'No concurrent request should cause 500 server error');
    });

    it('6.2 Handles 10 concurrent requests with valid Access Token smoothly (100% 200 OK)', async () => {
      // Generate fresh token
      const freshToken = app.jwt ? app.jwt.sign({ userId: concUser.id, username: concUser.username }, { expiresIn: '15m' }) : jwt.sign({ userId: concUser.id, username: concUser.username }, JWT_SECRET, { expiresIn: '15m' });

      const calls = Array.from({ length: 10 }).map(() =>
        app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${freshToken}` },
        })
      );

      const responses = await Promise.all(calls);
      for (const r of responses) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.json().data.user.id, concUser.id);
      }
    });
  });
});
