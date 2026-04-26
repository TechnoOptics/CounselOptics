'use client';

import { useEffect, useState, useTransition } from 'react';
import { setThemeAction } from '@/lib/actions';
import type { ThemePref } from '@/lib/types';

const OPTIONS: { value: ThemePref; label: string; help: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    help: 'Cream and forest, always.',
    icon: <SunIcon />,
  },
  {
    value: 'dark',
    label: 'Dark',
    help: 'Deep forest with gold accents.',
    icon: <MoonIcon />,
  },
  {
    value: 'system',
    label: 'Auto',
    help: 'Follow your device setting.',
    icon: <DeviceIcon />,
  },
];

/**
 * Three-way theme picker. Writes localStorage and applies the dark class
 * synchronously so the change is instant; fires a server action to
 * persist profiles.theme so the choice carries across devices.
 */
export function ThemePicker({ initial }: { initial: ThemePref }) {
  const [theme, setTheme] = useState<ThemePref>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Apply on mount in case the server prop differs from local state.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  function pick(next: ThemePref) {
    if (pending || next === theme) return;
    setTheme(next);
    setError(null);
    apply(next);
    try {
      localStorage.setItem('advottic-theme', next);
    } catch {
      /* private mode / quota */
    }
    start(async () => {
      const result = await setThemeAction(next);
      if (!result.ok) {
        setError(result.error ?? 'Could not save theme.');
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="label">Appearance</p>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const active = theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(o.value)}
              disabled={pending}
              className={`group relative rounded-xl border p-3 text-left transition-all ${
                active
                  ? 'border-forest-900 dark:border-gold-500 bg-cream-50 dark:bg-forest-800/70 shadow-sm'
                  : 'border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900/40 hover:border-forest-700 dark:hover:border-gold-500/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
                    active
                      ? 'bg-forest-900 text-gold-300 dark:bg-gold-metal dark:text-forest-950'
                      : 'bg-ink-100 dark:bg-forest-800 text-ink-700 dark:text-cream-100/70'
                  }`}
                >
                  {o.icon}
                </span>
                <span className="font-semibold text-sm text-ink-950 dark:text-cream-100">
                  {o.label}
                </span>
              </div>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1.5 leading-snug">
                {o.help}
              </p>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}

function apply(pref: ThemePref) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  html.classList.toggle('dark', dark);
  html.dataset.theme = pref;
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function DeviceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
