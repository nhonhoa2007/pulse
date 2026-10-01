/**
 * INF-05: TypeBox contract-first cho domain Auth.
 *  - Schemas là nguồn duy nhất định nghĩa ràng buộc; AuthService gọi validate*.
 *  - Hợp đồng lỗi giữ nguyên 100% (codes + messages) để không phá client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import {
  RegisterInputSchema,
  LoginInputSchema,
} from '../src/contracts/AuthSchemas.ts';
import { Value } from '@sinclair/typebox/value';

const timestamp = Date.now();

test('INF-05: RegisterInputSchema rejects malformed inputs', () => {
  const bad = [
    { username: 'ab', email: 'a@b.co', password: '123456', displayName: 'X' }, // username quá ngắn
    { username: 'has space', email: 'a@b.co', password: '123456', displayName: 'X' }, // username ký tự lạ
    { username: 'okname', email: 'not-an-email', password: '123456', displayName: 'X' }, // email sai
    { username: 'okname', email: 'a@b.co', password: '12345', displayName: 'X' }, // password < 6
    { username: 'okname', email: 'a@b.co', password: '123456', displayName: '' }, // displayName rỗng
    {}, // thiếu hết
  ];
  for (const input of bad) {
    assert.equal(Value.Check(RegisterInputSchema, input), false, `must reject: ${JSON.stringify(input)}`);
  }
});

test('INF-05: RegisterInputSchema accepts valid input; LoginInputSchema presence-only', () => {
  assert.equal(
    Value.Check(RegisterInputSchema, {
      username: `tb_${timestamp}`,
      email: `tb_${timestamp}@test.local`,
      password: 'Str0ng!Passw0rd',
      displayName: 'TypeBox User',
    }),
    true
  );
  assert.equal(Value.Check(LoginInputSchema, { identifier: 'anyone', password: 'x' }), true);
  assert.equal(Value.Check(LoginInputSchema, { identifier: '', password: 'x' }), false);
});

test('INF-05: register via API returns the same validation error contract', async () => {
  const app = await buildApp();

  // username quá ngắn → 400 INVALID_USERNAME
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'ab', email: `x${timestamp}@t.local`, password: '123456', displayName: 'X' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_USERNAME');

  // password ngắn → 400 INVALID_PASSWORD
  const res2 = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `tbok${timestamp}`, email: `x${timestamp}@t.local`, password: '12345', displayName: 'X' },
  });
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.json().error.code, 'INVALID_PASSWORD');

  await app.close();
});

test('INF-05: login with missing fields still returns 401 UNAUTHORIZED (not 400)', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: '' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'UNAUTHORIZED');
  await app.close();
});

test('INF-05: full register → login roundtrip still works end-to-end', async () => {
  const app = await buildApp();
  const username = `tbe2e_${timestamp}`;

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, email: `${username}@test.local`, password: 'Str0ng!Passw0rd', displayName: 'TB E2E' },
  });
  assert.equal(reg.statusCode, 201);
  const regBody = reg.json();
  assert.equal(regBody.success, true);
  assert.ok(regBody.data.accessToken);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: username, password: 'Str0ng!Passw0rd' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().data.user.username, username);

  await prisma.user.delete({ where: { username } }).catch(() => {});
  await app.close();
});
