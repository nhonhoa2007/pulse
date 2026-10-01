/**
 * Shared test helpers (SEC-02): mint real Bearer JWTs instead of the removed
 * x-user-id identity header. Tokens are signed with the same secret the server
 * uses (provided by tests/setup-env.mjs) and cached per test process.
 */
import jwt from 'jsonwebtoken';

const tokenCache = new Map();

export function authToken(userId, username = userId) {
  const cached = tokenCache.get(userId);
  if (cached) return cached;
  const token = jwt.sign(
    { userId, username, jti: `test-${userId}` },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  tokenCache.set(userId, token);
  return token;
}

export function authHeaders(userId, username) {
  return { authorization: `Bearer ${authToken(userId, username)}` };
}

/**
 * Fetch a one-time SSE connection ticket (SEC-01) for the given user.
 * Returns the raw ticket string; throws if the endpoint does not return 200.
 */
export async function fetchRealtimeTicket(app, userId, username) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/realtime/ticket',
    headers: authHeaders(userId, username),
  });
  if (res.statusCode !== 200) {
    throw new Error(`realtime/ticket returned ${res.statusCode}: ${res.body}`);
  }
  const body = JSON.parse(res.body);
  return body.data.ticket;
}
