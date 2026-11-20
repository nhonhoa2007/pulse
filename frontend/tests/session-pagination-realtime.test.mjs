import test from 'node:test';
import assert from 'node:assert/strict';
import { PulseApiCore, ApiError } from '../src/api/core.ts';
import { api } from '../src/api/PulseApiClient.ts';

test('access tokens remain in memory and legacy storage is removed', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map([['pulse_auth_token', 'legacy-token']]);
  const writes = [];
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };

  try {
    const client = new PulseApiCore();
    client.setToken('memory-token');
    assert.equal(client.getToken(), 'memory-token');
    assert.equal(values.has('pulse_auth_token'), false);
    assert.equal(writes.some(([key]) => key === 'pulse_auth_token'), false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('transport exposes stable network error metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  try {
    const client = new PulseApiCore();
    await assert.rejects(
      client.request('/health'),
      (error) => error instanceof ApiError && error.status === null && error.code === 'NETWORK_ERROR'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('feed methods preserve posts and nextCursor', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({
      success: true,
      data: { posts: [{ id: 'post-1', content: 'Page one' }], nextCursor: 'cursor-2' },
    }),
  });
  try {
    const page = await api.getHomeFeed();
    assert.equal(page.posts.length, 1);
    assert.equal(page.nextCursor, 'cursor-2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('realtime subscribers share one stream and reconnect with a fresh ticket', async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const sources = [];
  let ticketCount = 0;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sources.push(this);
      queueMicrotask(() => this.onopen?.(new Event('open')));
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    close() {
      this.closed = true;
    }
  }

  globalThis.EventSource = FakeEventSource;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/realtime/ticket')) {
      ticketCount += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: { ticket: `ticket-${ticketCount}`, expiresIn: 30 } }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  api.setToken('access-token');
  const unsubscribeA = api.subscribeRealtimeEvents('user-1', () => {});
  const unsubscribeB = api.subscribeRealtimeEvents('user-1', () => {});

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sources.length, 1);
    assert.match(sources[0].url, /ticket-1/);

    sources[0].onerror(new Event('error'));
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(sources.length, 2);
    assert.match(sources[1].url, /ticket-2/);
    assert.equal(sources[0].closed, true);
  } finally {
    unsubscribeA();
    unsubscribeB();
    api.disconnectRealtime();
    api.setToken(null);
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});
