/**
 * PKG-02: Theme switcher — logic thuần của engine (utils/theme.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_MODES,
  THEME_STORAGE_KEY,
  loadThemeMode,
  saveThemeMode,
  resolveTheme,
  themeClass,
  prefersDarkScheme,
} from '../src/utils/theme.ts';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    data,
  };
}

describe('PKG-02: theme mode persistence', () => {
  test('defaults to light when nothing stored', () => {
    assert.equal(loadThemeMode(fakeStorage()), 'light');
  });

  test('loads each valid stored mode', () => {
    for (const mode of THEME_MODES) {
      assert.equal(loadThemeMode(fakeStorage({ [THEME_STORAGE_KEY]: mode })), mode);
    }
  });

  test('falls back to light for invalid stored value', () => {
    assert.equal(loadThemeMode(fakeStorage({ [THEME_STORAGE_KEY]: 'neon-pink' })), 'light');
  });

  test('saveThemeMode persists under the canonical key', () => {
    const storage = fakeStorage();
    saveThemeMode('black', storage);
    assert.equal(storage.data[THEME_STORAGE_KEY], 'black');
  });
});

describe('PKG-02: theme resolution', () => {
  test('light and dark/black map to themselves regardless of OS', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('light', false), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
    assert.equal(resolveTheme('black', false), 'black');
  });

  test('system follows OS preference', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
  });

  test('themeClass maps resolved theme to html class', () => {
    assert.equal(themeClass('light'), '');
    assert.equal(themeClass('dark'), 'dark');
    assert.equal(themeClass('black'), 'black');
  });

  test('prefersDarkScheme reads matchMedia result', () => {
    assert.equal(prefersDarkScheme(() => ({ matches: true })), true);
    assert.equal(prefersDarkScheme(() => ({ matches: false })), false);
    assert.equal(prefersDarkScheme(undefined), false);
  });
});

describe('PKG-02: mode set completeness', () => {
  test('exposes exactly the 4 supported modes', () => {
    assert.deepEqual([...THEME_MODES].sort(), ['black', 'dark', 'light', 'system']);
    const modes = ['light', 'dark', 'black', 'system'];
    assert.equal(modes.length, 4);
  });
});
