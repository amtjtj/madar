'use client';

import { t } from '@madar/i18n';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { THEME_STORAGE_KEY as STORAGE_KEY } from './theme-script.js';

export type ThemePreference = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The <html data-theme> attribute is the source of truth (set early by themeScript).
function getSnapshot(): ThemePreference {
  const value = document.documentElement.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}

function getServerSnapshot(): ThemePreference {
  return 'system';
}

function apply(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // storage may be unavailable (private mode); the choice then lasts for this page only
  }
  listeners.forEach((listener) => listener());
}

/** Current theme preference and a setter. Works anywhere; no provider needed. */
export function useTheme(): { theme: ThemePreference; setTheme: (theme: ThemePreference) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { theme, setTheme: apply };
}

const options: Array<{ value: ThemePreference; icon: ReactNode }> = [
  { value: 'light', icon: <Sun aria-hidden /> },
  { value: 'dark', icon: <Moon aria-hidden /> },
  { value: 'system', icon: <Monitor aria-hidden /> },
];

/** Segmented control: light / dark / system. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className={cn('inline-flex rounded-lg bg-sunken p-1', className)}
    >
      {options.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors [&_svg]:size-4',
              active ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.icon}
            {t(`theme.${option.value}`)}
          </button>
        );
      })}
    </div>
  );
}
