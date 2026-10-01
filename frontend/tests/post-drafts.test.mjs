/**
 * PKG-03: Post Drafts autosave (utils/drafts.ts) — logic thuần với storage giả.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFTS_STORAGE_KEY,
  slotKeyForComposer,
  saveDraft,
  loadDraft,
  clearDraft,
  listDrafts,
  isDraftMeaningful,
  createAutosaver,
} from '../src/utils/drafts.ts';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
}

describe('PKG-03: draft slots', () => {
  test('slotKeyForComposer names slots by purpose and target', () => {
    assert.equal(slotKeyForComposer('post'), 'post');
    assert.equal(slotKeyForComposer('reply', 'p1'), 'reply:p1');
    assert.equal(slotKeyForComposer('quote', 'p2'), 'quote:p2');
    assert.equal(slotKeyForComposer('reply'), 'reply:unknown');
  });
});

describe('PKG-03: save/load/clear drafts', () => {
  test('saves and loads a draft roundtrip', () => {
    const storage = fakeStorage();
    saveDraft('post', { content: 'Hello draft' }, storage);
    const loaded = loadDraft('post', storage);
    assert.equal(loaded?.content, 'Hello draft');
    assert.ok(loaded?.savedAt);
  });

  test('overwrites same slot and keeps other slots', () => {
    const storage = fakeStorage();
    saveDraft('post', { content: 'v1' }, storage);
    saveDraft('post', { content: 'v2' }, storage);
    saveDraft('reply:p1', { content: 'reply draft' }, storage);
    assert.equal(loadDraft('post', storage)?.content, 'v2');
    assert.equal(loadDraft('reply:p1', storage)?.content, 'reply draft');
  });

  test('clearDraft removes only the target slot', () => {
    const storage = fakeStorage();
    saveDraft('post', { content: 'a' }, storage);
    saveDraft('reply:p1', { content: 'b' }, storage);
    clearDraft('post', storage);
    assert.equal(loadDraft('post', storage), null);
    assert.ok(loadDraft('reply:p1', storage));
  });

  test('listDrafts sorts by savedAt desc', async () => {
    const storage = fakeStorage();
    saveDraft('post', { content: 'old' }, storage);
    await new Promise((r) => setTimeout(r, 5));
    saveDraft('reply:p1', { content: 'new' }, storage);
    const list = listDrafts(storage);
    assert.equal(list.length, 2);
    assert.equal(list[0].content, 'new');
  });
});

describe('PKG-03: meaningful filter & autosaver', () => {
  test('isDraftMeaningful requires content or media', () => {
    assert.equal(isDraftMeaningful({ content: '  ', mediaUrls: [] }), false);
    assert.equal(isDraftMeaningful({ content: 'hi', mediaUrls: [] }), true);
    assert.equal(isDraftMeaningful({ content: '', mediaUrls: ['u.png'] }), true);
  });

  test('autosaver debounces: last pending draft wins within delay', async () => {
    const storage = fakeStorage();
    const saver = createAutosaver('post', storage, 20);
    saver.save({ content: 'first' });
    saver.save({ content: 'second' });
    assert.equal(loadDraft('post', storage), null, 'must not write before debounce elapses');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(loadDraft('post', storage)?.content, 'second');
  });

  test('autosaver flush writes immediately; cancel drops pending', async () => {
    const storage = fakeStorage();
    const saver = createAutosaver('post', storage, 1000);
    saver.save({ content: 'flush me' });
    saver.flush();
    assert.equal(loadDraft('post', storage)?.content, 'flush me');

    saver.save({ content: 'drop me' });
    saver.cancel();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(loadDraft('post', storage)?.content, 'flush me', 'cancel must not write pending');
  });

  test('writes under the canonical storage key as JSON map', () => {
    const storage = fakeStorage();
    saveDraft('post', { content: 'x' }, storage);
    const raw = JSON.parse(storage.getItem(DRAFTS_STORAGE_KEY));
    assert.ok(raw.post && typeof raw.post.savedAt === 'string');
  });
});
