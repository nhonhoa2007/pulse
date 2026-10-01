/**
 * PKG-02: ThemeContext — Light / Dark / OLED Black / System switcher.
 * Lưu lựa chọn vào localStorage, áp class trên <html>, chống FOUC nhờ
 * script inline trong index.html (chạy trước React).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ThemeMode,
  ResolvedTheme,
  loadThemeMode,
  saveThemeMode,
  prefersDarkScheme,
  resolveTheme,
  applyTheme,
} from '../utils/theme.ts';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => loadThemeMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    prefersDarkScheme((q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : { matches: false }))
  );

  // Lắng nghe thay đổi prefers-color-scheme của OS (chỉ có ý nghĩa khi mode = system)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(mode, systemPrefersDark), [mode, systemPrefersDark]);

  useEffect(() => {
    applyTheme(resolvedTheme, typeof document !== 'undefined' ? document : undefined);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(next, typeof localStorage !== 'undefined' ? localStorage : undefined);
  }, []);

  const value = useMemo(() => ({ mode, resolvedTheme, setTheme }), [mode, resolvedTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
