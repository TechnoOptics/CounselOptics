'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Counsel sidebar "focus mode".
 *
 * The left navigation rail lives in the server-rendered counsel layout. This
 * client provider adds a collapse state so a page (the case timeline) can
 * slide the rail out to the left, leaving a thin "page keeper" tab. Hovering
 * or clicking the tab slides the rail back in.
 *
 * The state is persisted per browser session so a manual choice sticks while
 * the user moves around; RequestSidebarFocus lets a route opt into collapse on
 * entry and restores the prior state on exit, so other counsel pages are never
 * left in an unexpected focus mode.
 */

type Ctx = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
};

const SidebarCollapseContext = createContext<Ctx | null>(null);

const STORE_KEY = 'counsel-sidebar-collapsed';

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  // Hydrate from sessionStorage after mount (avoids an SSR/client mismatch).
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(STORE_KEY) === '1') setCollapsedState(true);
    } catch {
      /* storage blocked - default expanded */
    }
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try {
      window.sessionStorage.setItem(STORE_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): Ctx {
  const ctx = useContext(SidebarCollapseContext);
  // Fail soft: if a page renders outside the provider, act as a no-op so the
  // sidebar simply stays expanded rather than throwing.
  return ctx ?? { collapsed: false, setCollapsed: () => {} };
}

/**
 * Mount inside a route to request focus mode (collapsed rail) on entry. On
 * unmount it restores whatever the collapse state was before this route ran,
 * so leaving the timeline does not silently collapse the rest of counsel.
 */
export function RequestSidebarFocus() {
  const { setCollapsed } = useSidebarCollapse();
  const prev = useRef<boolean | null>(null);
  const ctx = useContext(SidebarCollapseContext);

  useEffect(() => {
    // Capture the state at entry, then collapse.
    prev.current = ctx?.collapsed ?? false;
    setCollapsed(true);
    return () => {
      if (prev.current === false) setCollapsed(false);
    };
    // Intentionally run once on mount / clean up once on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * The collapsible wrapper around the server-rendered sidebar. Receives the
 * <CounselSidebar/> as children so that stays server-rendered; only the
 * collapse chrome is client-side.
 */
export function CounselSidebarShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { collapsed, setCollapsed } = useSidebarCollapse();

  return (
    <div className="hidden md:block flex-none sticky top-24 self-start">
      <div className="relative flex items-start">
        {/* Sidebar panel */}
        <div
          className={
            'overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none ' +
            (collapsed ? 'w-0' : 'w-56')
          }
        >
          <div className="w-56">
            <div className="flex justify-end pb-1">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-expanded
                aria-controls="counsel-sidebar-panel"
                aria-label={t('Collapse menu')}
                title={t('Collapse menu')}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-500 dark:text-cream-100/55 hover:bg-cream-50 dark:hover:bg-forest-800/40 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {/* Content only renders when expanded, so collapsed nav links are
                never left hidden-but-focusable for keyboard / screen readers. */}
            <div id="counsel-sidebar-panel" className="max-h-[calc(100dvh-8rem)] overflow-y-auto pr-0.5 pb-4">{!collapsed && children}</div>
          </div>
        </div>

        {/* Page-keeper tab - visible only when collapsed. Hover or click to
            slide the rail back in. */}
        {collapsed && (
          <button
            type="button"
            onMouseEnter={() => setCollapsed(false)}
            onFocus={() => setCollapsed(false)}
            onClick={() => setCollapsed(false)}
            aria-expanded={false}
            aria-controls="counsel-sidebar-panel"
            aria-label={t('Show menu')}
            title={t('Show menu')}
            className="group -ml-1 mt-1 inline-flex flex-col items-center gap-2 rounded-r-lg bg-white dark:bg-forest-900/70 ring-1 ring-ink-200 dark:ring-forest-700/50 py-3 px-1.5 shadow-card hover:bg-cream-50 dark:hover:bg-forest-800/60 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-500 dark:text-cream-100/70 group-hover:text-forest-900 dark:group-hover:text-cream-100">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-400 dark:text-cream-100/55 group-hover:text-forest-900 dark:group-hover:text-cream-100"
              style={{ writingMode: 'vertical-rl' }}
            >
              <T>Menu</T>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
