'use client';

import { useEffect, useState } from 'react';

export type TabDef = {
  id: string;
  label: string;
  badge?: string | number;
  content: React.ReactNode;
};

/**
 * Tabs with two responsive shapes:
 *  - On phones (<sm): a native <select> dropdown so every tab is
 *    discoverable from the closed state. Earlier we used a horizontal
 *    overflow strip; users couldn't tell there were more tabs offscreen
 *    and would miss Hearing / Activity / Collaborators entirely.
 *  - On tablet+ (sm+): the original underline tablist.
 *
 * Both surfaces share the same active state and storageKey persistence.
 */
export function Tabs({
  tabs,
  storageKey,
}: {
  tabs: TabDef[];
  /** If set, last-active tab is remembered in sessionStorage. */
  storageKey?: string;
}) {
  const [active, setActive] = useState<string>(() => tabs[0]?.id ?? '');

  // Restore from sessionStorage / hash on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && tabs.some((t) => t.id === hash)) {
      setActive(hash);
      return;
    }
    if (storageKey) {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.id === saved)) {
        setActive(saved);
      }
    }
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change.
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(storageKey, active);
    }
  }, [active, storageKey]);

  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      {/* MOBILE: dropdown selector. Visible only below sm.
          A native <select> is the most discoverable mobile surface -
          the user always sees the current tab name, taps to see all
          choices, and there's no hidden state. */}
      <div className="sm:hidden">
        <label htmlFor="tabs-mobile-select" className="sr-only">
          Choose section
        </label>
        <div className="relative">
          <select
            id="tabs-mobile-select"
            value={active}
            onChange={(e) => setActive(e.target.value)}
            aria-label="Case sections"
            className="appearance-none w-full rounded-xl border border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900 px-4 py-3 pr-10 text-sm font-medium text-forest-900 dark:text-cream-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-400/60"
          >
            {tabs.map((t) => {
              const badge =
                t.badge !== undefined && t.badge !== null && t.badge !== ''
                  ? ` (${t.badge})`
                  : '';
              return (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {badge}
                </option>
              );
            })}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-500 dark:text-cream-100/55"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        {activeTab && (
          <p className="mt-2 text-[11px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
            {activeTab.label}
          </p>
        )}
      </div>

      {/* DESKTOP / TABLET: underline tablist. Visible at sm+. */}
      <div
        role="tablist"
        aria-label="Case sections"
        className="hidden sm:flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-ink-200 -mx-1 px-1"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`tab inline-flex items-center gap-2 ${isActive ? 'tab-active' : ''}`}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && t.badge !== null && t.badge !== '' && (
                <span
                  className={`inline-flex items-center justify-center text-[10px] font-mono rounded-full px-1.5 py-0.5 leading-none min-w-[18px] ${
                    isActive
                      ? 'bg-forest-900 text-cream-100'
                      : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {t.badge}
                </span>
              )}
              {isActive && <span className="tab-underline" />}
            </button>
          );
        })}
      </div>

      <div className="pt-6">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tabpanel"
            id={`tabpanel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            hidden={t.id !== active}
            className={t.id === active ? 'animate-fade-in' : ''}
          >
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
