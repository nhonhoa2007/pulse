/**
 * PKG-02: Theme engine — logic thuần (test được dưới Node).
 * 4 chế độ: light | dark | black | system.
 * Class áp dụng trên <html>: '' | 'dark' | 'black'.
 */

export type ThemeMode = 'light' | 'dark' | 'black' | 'system';
export type ResolvedTheme = 'light' | 'dark' | 'black';

export const THEME_STORAGE_KEY = 'pulse_theme';
export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'black', 'system'];

export function loadThemeMode(storage?: Pick<Storage, 'getItem'>): ThemeMode {
  const stored = storage ? storage.getItem(THEME_STORAGE_KEY) : null;
  if (stored === 'light' || stored === 'dark' || stored === 'black' || stored === 'system') {
    return stored;
  }
  return 'light';
}

export function saveThemeMode(mode: ThemeMode, storage?: Pick<Storage, 'setItem'>): void {
  if (storage) {
    storage.setItem(THEME_STORAGE_KEY, mode);
  }
}

export function prefersDarkScheme(matchMedia?: (query: string) => MediaQueryList | { matches: boolean }): boolean {
  if (!matchMedia) return false;
  return Boolean(matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Chuyển mode (kèm trạng thái OS) thành theme cụ thể. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return mode;
}

/** Class cần có trên <html> cho theme đã resolve. */
export function themeClass(theme: ResolvedTheme): 'dark' | 'black' | '' {
  if (theme === 'dark') return 'dark';
  if (theme === 'black') return 'black';
  return '';
}

/** Áp dụng theme lên document (an toàn khi không có DOM — test Node). */
export function applyTheme(theme: ResolvedTheme, doc?: Pick<Document, 'documentElement'>): void {
  if (!doc) return;
  const root = doc.documentElement;
  root.classList.remove('dark', 'black');
  const cls = themeClass(theme);
  if (cls) {
    root.classList.add(cls);
  }
}
