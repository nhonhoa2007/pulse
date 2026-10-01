/**
 * SEC-05: Rate limiting tests.
 *  - Bucket nghiêm ngặt trên endpoint đăng nhập (10 req/phút/IP) → 429 với envelope chuẩn.
 *  - Bucket publish theo user (20 req/phút/user) không bị bucket auth làm ngẹt.
 *  - Global ceiling 300 req/phút/IP.
 *
 * Lưu ý: preload setup-env.mjs đặt RATE_LIMIT_DISABLED=1 cho toàn bộ suite khác;
 * suite này bật lại rate limiting bằng cách set biến môi trường trước khi buildApp().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.RATE_LIMIT_DISABLED = '0';

const { buildApp } = await import('../src/app.ts');

const app = await buildApp();

async function registerUser(username) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username,
      email: `${username}@ratelimit.test`,
      password: 'Str0ng!Passw0rd',
      displayName: `RL ${username}`,
    },
  });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 201, `register should succeed: ${res.body}`);
  return body.data;
}

test('SEC-05: login bucket 10/min/IP returns 429 with standard envelope', async () => {
  const username = `rl_login_${crypto.randomUUID().slice(0, 8)}`;

  let saw429 = false;
  for (let i = 0; i < 12; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'whatever' },
    });
    if (res.statusCode === 429) {
      saw429 = true;
      const body = JSON.parse(res.body);
      assert.equal(body.success, false, '429 body must follow standard envelope');
      assert.equal(body.error.code, 'RATE_LIMITED');
      break;
    }
  }
  assert.equal(saw429, true, 'the 11th login attempt within a minute must be rate limited');
});

test('SEC-05: exhausted auth bucket does not block the per-user publish bucket', async () => {
  const username = `rl_publish_${crypto.randomUUID().slice(0, 8)}`;
  const user = await registerUser(username);

  // Drain the login bucket (10 max) — publish must remain unaffected.
  for (let i = 0; i < 11; i++) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'nobody', password: 'nothing' },
    });
  }

  const publishRes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { content: 'Rate limiting must not block legitimate publishers' },
  });
  assert.ok(
    [200, 201].includes(publishRes.statusCode),
    `publish should succeed despite drained auth bucket, got ${publishRes.statusCode}: ${publishRes.body}`
  );
});

test('SEC-05: publish bucket 20/min/user returns 429 on the 21st post', async () => {
  const username = `rl_cap_${crypto.randomUUID().slice(0, 8)}`;
  const user = await registerUser(username);

  let saw429 = false;
  for (let i = 0; i < 22; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { content: `spam load ${i}` },
    });
    if (res.statusCode === 429) {
      saw429 = true;
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'RATE_LIMITED');
      break;
    }
  }
  assert.equal(saw429, true, 'the 21st publish within a minute must be rate limited');
});

test('SEC-05: global ceiling 300/min/IP returns 429', async () => {
  let saw429 = false;
  for (let i = 0; i < 310; i++) {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    if (res.statusCode === 429) {
      saw429 = true;
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'RATE_LIMITED');
      break;
    }
  }
  assert.equal(saw429, true, 'global per-IP ceiling must eventually return 429');
});

test('SEC-05: app.close', async () => {
  await app.close();
});
