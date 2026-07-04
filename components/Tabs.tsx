'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';

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
  swipe = false,
}: {
  tabs: TabDef[];
  /** If set, last-active tab is remembered in sessionStorage. */
  storageKey?: string;
  /** When true, the panels become a swipeable card deck on touch
   *  devices (flick left/right to change section) with a dot
   *  indicator. The dropdown/tablist nav stays for explicit choice. */
  swipe?: boolean;
}) {
  const [active, setActive] = useState<string>(() => tabs[0]?.id ?? '');
  const touchStart = useRef<{ x: number; y: number } | null>(null);

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

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === active));
  const activeTab = tabs[activeIndex] ?? tabs[0];

  function step(delta: number) {
    const i = Math.min(tabs.length - 1, Math.max(0, activeIndex + delta));
    if (tabs[i]) setActive(tabs[i].id);
  }

  // Touch flick to move between sections. Bail when the gesture starts
  // inside a nested horizontal scroller (e.g. the Advottic Review
  // carousel, marked data-hswipe) so the two swipe areas don't fight.
  function onTouchStart(e: React.TouchEvent) {
    if ((e.target as Element).closest?.('[data-hswipe]')) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Horizontal intent only - vertical scrolls must not change tab.
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      step(dx < 0 ? 1 : -1);
    }
  }

  return (
    <div>
      {/* MOBILE: dropdown selector. Visible only below sm.
          A native <select> is the most discoverable mobile surface -
          the user always sees the current tab name, taps to see all
          choices, and there's no hidden state. */}
      <div className="sm:hidden">
        <label htmlFor="tabs-mobile-select" className="sr-only">
          <T>Choose section</T>
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
                  <T>{t.label}</T>
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
            <T>{activeTab.label}</T>
          </p>
        )}
        {swipe && tabs.length > 1 && (
          <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/70">
            <T>Swipe left or right to move between sections.</T>
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
              <span><T>{t.label}</T></span>
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

      <div
        className="pt-6"
        onTouchStart={swipe ? onTouchStart : undefined}
        onTouchEnd={swipe ? onTouchEnd : undefined}
      >
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

      {swipe && tabs.length > 1 && (
        <div className="mt-6 flex justify-center gap-2" aria-hidden>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              aria-label={`Go to ${t.label}`}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex
                  ? 'w-6 bg-forest-900 dark:bg-gold-metal'
                  : 'w-1.5 bg-ink-300 dark:bg-forest-700 hover:bg-ink-400'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
