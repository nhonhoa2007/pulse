import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { prisma } from '../dist/db/PrismaClientSingleton.js';
import { buildApp } from '../dist/app.js';

test('Authentication & User Profile Management Suite (TASK-13)', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testUser = {
    username: `auth_user_${timestamp}`,
    email: `auth_user_${timestamp}@pulse.local`,
    password: `Password123!_${timestamp}`,
    displayName: `Nguyen Van A ${timestamp}`,
  };

  const JWT_SECRET = process.env.JWT_SECRET || 'pulse-secret-key-2026-production-token';
  let registeredUserId = '';
  let authToken = '';

  // =========================================================================
  // 1. REGISTRATION INPUT VALIDATION & REGISTRATION
  // =========================================================================
  await t.test('POST /auth/register: rejects invalid username formats with 400', async () => {
    // Too short (<3)
    const shortRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...testUser, username: 'ab' },
    });
    assert.equal(shortRes.statusCode, 400);
    assert.equal(shortRes.json().success, false);

    // Contains invalid characters
    const specialRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...testUser, username: 'user@bad!name' },
    });
    assert.equal(specialRes.statusCode, 400);
    assert.equal(specialRes.json().success, false);
  });

  await t.test('POST /auth/register: rejects invalid email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...testUser, email: 'not-an-email' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  await t.test('POST /auth/register: rejects short password (<6 chars) with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...testUser, password: '123' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  await t.test('POST /auth/register: rejects empty displayName with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...testUser, displayName: '   ' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  await t.test('POST /auth/register: successfully registers new user and generates JWT token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: testUser,
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.token);
    assert.ok(body.data.user);

    registeredUserId = body.data.user.id;
    authToken = body.data.token;

    assert.equal(body.data.user.username, testUser.username);
    assert.equal(body.data.user.displayName, testUser.displayName);

    // Verify JWT payload
    const decoded = jwt.verify(body.data.token, JWT_SECRET);
    assert.equal(decoded.userId, registeredUserId);
    assert.equal(decoded.username, testUser.username);
  });

  await t.test('POST /auth/register: rejects duplicate username or email with 400', async () => {
    // Duplicate username
    const dupUsernameRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        ...testUser,
        email: `another_${timestamp}@pulse.local`,
      },
    });
    assert.equal(dupUsernameRes.statusCode, 400);
    assert.equal(dupUsernameRes.json().success, false);

    // Duplicate email
    const dupEmailRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        ...testUser,
        username: `another_${timestamp}`,
      },
    });
    assert.equal(dupEmailRes.statusCode, 400);
    assert.equal(dupEmailRes.json().success, false);
  });

  // =========================================================================
  // 2. SECURITY & PASSWORD HASH INVARIANTS
  // =========================================================================
  await t.test('Security Invariant: passwordHash is NEVER exposed in UserDto responses', async () => {
    // Check registration response
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `sec_user_${timestamp}`,
        email: `sec_user_${timestamp}@pulse.local`,
        password: 'Password123!',
        displayName: 'Security User',
      },
    });
    const regBody = regRes.json();
    assert.equal(regBody.data.user.passwordHash, undefined);
    assert.equal('passwordHash' in regBody.data.user, false);

    // Check DB storage is hashed with bcrypt (starts with $2a$ or $2b$)
    const dbUser = await prisma.user.findUnique({
      where: { id: registeredUserId },
    });
    assert.ok(dbUser?.passwordHash);
    assert.ok(dbUser.passwordHash.startsWith('$2'));
    assert.notEqual(dbUser.passwordHash, testUser.password);
  });

  // =========================================================================
  // 3. AUTHENTICATION & LOGIN
  // =========================================================================
  await t.test('POST /auth/login: successfully logs in with username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: testUser.username,
        password: testUser.password,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.token);
    assert.equal(body.data.user.id, registeredUserId);
    assert.equal(body.data.user.passwordHash, undefined);

    const decoded = jwt.verify(body.data.token, JWT_SECRET);
    assert.equal(decoded.userId, registeredUserId);
  });

  await t.test('POST /auth/login: successfully logs in with email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: testUser.email,
        password: testUser.password,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.token);
    assert.equal(body.data.user.id, registeredUserId);
    assert.equal(body.data.user.passwordHash, undefined);
  });

  await t.test('POST /auth/login: fails on wrong password with 401 and UNAUTHORIZED code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: testUser.username,
        password: 'WrongPassword999!',
      },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.equal(body.error.message, 'Tên đăng nhập hoặc mật khẩu không đúng');
  });

  await t.test('POST /auth/login: fails on non-existent user with 401 and UNAUTHORIZED code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: `nonexistent_${timestamp}`,
        password: 'AnyPassword123!',
      },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.equal(body.error.message, 'Tên đăng nhập hoặc mật khẩu không đúng');
  });

  // =========================================================================
  // 4. AUTHENTICATED ENDPOINT (GET /auth/me)
  // =========================================================================
  await t.test('GET /auth/me: returns user data when authenticated via Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.user);
    assert.equal(body.data.user.id, registeredUserId);
    assert.equal(body.data.user.username, testUser.username);
    assert.equal(body.data.user.passwordHash, undefined);
    assert.equal('passwordHash' in body.data.user, false);
  });

  await t.test('GET /auth/me: rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });

  await t.test('GET /auth/me: rejects invalid Bearer token with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer invalid-token-signature-here',
      },
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });

  // =========================================================================
  // 5. USER PROFILE UPDATE (PATCH /users/profile)
  // =========================================================================
  await t.test('PATCH /users/profile: rejects unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/profile',
      payload: { displayName: 'Hacker' },
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });

  await t.test('PATCH /users/profile: rejects empty displayName with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/profile',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: { displayName: '   ' },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  await t.test('PATCH /users/profile: updates displayName, bio, and avatarUrl with Bearer auth', async () => {
    const newProfile = {
      displayName: 'Hoa Nhon Senior Dev',
      bio: 'Building scalable microblogging distributed architecture with Fastify & Prisma.',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    };

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/profile',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: newProfile,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, registeredUserId);
    assert.equal(body.data.displayName, newProfile.displayName);
    assert.equal(body.data.bio, newProfile.bio);
    assert.equal(body.data.avatarUrl, newProfile.avatarUrl);
    assert.equal(body.data.passwordHash, undefined);
    assert.equal('passwordHash' in body.data, false);

    // Verify persistence in Database directly
    const dbUser = await prisma.user.findUnique({ where: { id: registeredUserId } });
    assert.equal(dbUser?.displayName, newProfile.displayName);
    assert.equal(dbUser?.bio, newProfile.bio);
    assert.equal(dbUser?.avatarUrl, newProfile.avatarUrl);

    // Verify persistence via GET /api/v1/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.equal(meRes.json().data.user.displayName, newProfile.displayName);
    assert.equal(meRes.json().data.user.bio, newProfile.bio);
    assert.equal(meRes.json().data.user.avatarUrl, newProfile.avatarUrl);

    // Verify persistence via public GET /api/v1/users/:username
    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${testUser.username}`,
    });
    assert.equal(profileRes.json().data.displayName, newProfile.displayName);
    assert.equal(profileRes.json().data.bio, newProfile.bio);
    assert.equal(profileRes.json().data.avatarUrl, newProfile.avatarUrl);
  });

  await t.test('PATCH /users/profile: supports partial update without wiping other fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/profile',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        bio: 'Updated bio only.',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.displayName, 'Hoa Nhon Senior Dev'); // unchanged
    assert.equal(body.data.bio, 'Updated bio only.'); // updated
    assert.equal(body.data.avatarUrl, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb'); // unchanged
  });

  // =========================================================================
  // 6. BEARER TOKEN INTEROPERABILITY & BACKWARD COMPATIBILITY
  // =========================================================================
  await t.test('Bearer Token Interoperability: can create post using Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        content: `Testing post creation with Bearer auth ${timestamp}`,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.authorId, registeredUserId);
  });

  await t.test('Backward Compatibility: x-user-id header still works seamlessly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        'x-user-id': registeredUserId,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, registeredUserId);
  });

  await app.close();
});

