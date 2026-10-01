/**
 * PKG-08: Router & deep-linking — parse/serialize URL ⇄ view.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewToPath,
  parsePath,
  isLegacyQueryUrl,
} from '../src/utils/router.ts';

describe('PKG-08: viewToPath', () => {
  test('maps simple views to clean paths', () => {
    assert.equal(viewToPath('home'), '/');
    assert.equal(viewToPath('explore'), '/explore');
    assert.equal(viewToPath('notifications'), '/notifications');
    assert.equal(viewToPath('messages'), '/messages');
  });

  test('maps profile with username and optional tab', () => {
    assert.equal(viewToPath('profile', { username: 'hoa_dev' }), '/@hoa_dev');
    assert.equal(viewToPath('profile', { username: 'hoa_dev', tab: 'bookmarks' }), '/@hoa_dev?tab=bookmarks');
    assert.equal(viewToPath('profile'), '/');
  });

  test('maps thread and conversation params', () => {
    assert.equal(viewToPath('thread', { postId: 'abc-123' }), '/post/abc-123');
    assert.equal(viewToPath('thread'), '/');
    assert.equal(viewToPath('messages', { conversationId: 'conv-9' }), '/messages/conv-9');
  });

  test('encodes special characters in usernames and ids', () => {
    assert.equal(viewToPath('profile', { username: 'a b' }), '/@a%20b');
  });
});

describe('PKG-08: parsePath', () => {
  test('parses all clean routes', () => {
    assert.deepEqual(parsePath('/'), { view: 'home', params: {}, path: '/' });
    assert.equal(parsePath('/explore')?.view, 'explore');
    assert.equal(parsePath('/notifications')?.view, 'notifications');
    assert.equal(parsePath('/messages')?.view, 'messages');
  });

  test('parses deep-link params', () => {
    const thread = parsePath('/post/xyz');
    assert.equal(thread?.view, 'thread');
    assert.equal(thread?.params.postId, 'xyz');

    const profile = parsePath('/@alice');
    assert.equal(profile?.view, 'profile');
    assert.equal(profile?.params.username, 'alice');

    const profileTab = parsePath('/@alice', '?tab=replies');
    assert.equal(profileTab?.params.tab, 'replies');

    const conv = parsePath('/messages/c1');
    assert.equal(conv?.params.conversationId, 'c1');
  });

  test('decodes encoded segments', () => {
    assert.equal(parsePath('/@a%20b')?.params.username, 'a b');
  });

  test('redirects legacy ?view= URLs to clean paths', () => {
    const legacy = parsePath('/', '?view=profile&username=bob&tab=posts');
    assert.equal(legacy?.view, 'profile');
    assert.equal(legacy?.params.username, 'bob');
    assert.equal(legacy?.params.tab, 'posts');
    assert.equal(legacy?.path, '/@bob?tab=posts');

    const legacyThread = parsePath('/', '?view=thread&postId=p1');
    assert.equal(legacyThread?.view, 'thread');
    assert.equal(legacyThread?.path, '/post/p1');

    const legacyMsg = parsePath('/', '?view=messages&conversationId=c2');
    assert.equal(legacyMsg?.path, '/messages/c2');
  });

  test('returns null for unknown paths (keeps current view)', () => {
    assert.equal(parsePath('/admin/secret'), null);
    assert.equal(parsePath('/post/abc/extra'), null);
  });

  test('isLegacyQueryUrl detects old-format URLs only', () => {
    assert.equal(isLegacyQueryUrl('?view=thread&postId=1'), true);
    assert.equal(isLegacyQueryUrl('?tab=posts'), false);
    assert.equal(isLegacyQueryUrl(''), false);
  });

  test('roundtrip viewToPath → parsePath is identity', () => {
    const cases = [
      { view: 'home', params: {} },
      { view: 'explore', params: {} },
      { view: 'notifications', params: {} },
      { view: 'messages', params: {} },
      { view: 'messages', params: { conversationId: 'k1' } },
      { view: 'profile', params: { username: 'sontungmtp' } },
      { view: 'thread', params: { postId: 'p9' } },
    ];
    for (const c of cases) {
      const parsed = parsePath(viewToPath(c.view, c.params), '');
      assert.equal(parsed?.view, c.view, `view roundtrip for ${c.view}`);
      assert.deepEqual(parsed?.params, c.params, `params roundtrip for ${c.view}`);
    }
  });
});
