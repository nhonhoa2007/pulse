/**
 * PKG-02: Dropdown chuyển theme nhanh — Light / Dark / OLED Black / System.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Sun, Moon, MonitorCog, Circle, Check, ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ThemeMode, THEME_MODES } from '../utils/theme';

const MODE_META: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: { label: 'Sáng', icon: <Sun className="w-4 h-4" /> },
  dark: { label: 'Tối', icon: <Moon className="w-4 h-4" /> },
  black: { label: 'Đen OLED', icon: <Circle className="w-4 h-4 fill-current" /> },
  system: { label: 'Theo hệ thống', icon: <MonitorCog className="w-4 h-4" /> },
};

export const ThemeSwitcher: React.FC = () => {
  const { mode, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative" data-testid="theme-switcher">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between w-full px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="theme-switcher-trigger"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-graphite">{MODE_META[mode].icon}</span>
          <span>Giao diện: {MODE_META[mode].label}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-ash transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Chọn giao diện"
          className="absolute left-0 right-0 bottom-full mb-1 bg-card border border-cloud rounded-xl shadow-subtle py-1 z-50 animate-fade-in"
        >
          {THEME_MODES.map((m) => (
            <button
              key={m}
              role="option"
              aria-selected={m === mode}
              onClick={() => {
                setTheme(m);
                setOpen(false);
              }}
              className={`flex items-center justify-between w-full px-3 py-2 text-[13px] text-left transition-colors ${
                m === mode ? 'bg-mist text-ink font-semibold' : 'text-graphite hover:bg-mist/60'
              }`}
              data-testid={`theme-option-${m}`}
            >
              <span className="flex items-center gap-2.5">
                <span className="text-graphite">{MODE_META[m].icon}</span>
                {MODE_META[m].label}
              </span>
              {m === mode && <Check className="w-3.5 h-3.5 text-meta" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
