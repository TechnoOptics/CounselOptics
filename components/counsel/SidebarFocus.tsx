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

  // The rail runs FLUSH: full height, its own scroll, one 1px right edge, and
  // no margin between it and the content column. That is what replaced the
  // rounded panel it used to float in.
  //
  // Its top offset is the header's height, measured, because the header is
  // sticky and full width: an offset of 0 would slide the first nav rows under
  // it, and a hardcoded rem value drifts the moment the header gains a row or
  // the device reports a notch inset. The same number sets the height, so the
  // rail ends exactly at the bottom of the viewport and scrolls internally
  // when it is taller than that.
  //
  // This REPLACED a measurement of the rail's own height that existed to keep
  // a non-scrolling sticky panel reachable. A rail with `overflow-y: auto` has
  // no such problem, so that arithmetic is gone rather than moved.
  const [headerHeight, setHeaderHeight] = useState(64);

  useEffect(() => {
    const el = document.querySelector('.counsel-shell > header');
    if (!(el instanceof HTMLElement)) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="hidden md:block flex-none sticky self-start"
      style={{
        top: headerHeight,
        height: `calc(100dvh - ${headerHeight}px)`,
      }}
    >
      <div className="relative flex h-full items-stretch">
        {/* Sidebar panel */}
        <div
          className={
            'h-full overflow-hidden border-r border-edge bg-surface transition-[width] duration-300 ease-out motion-reduce:transition-none ' +
            (collapsed ? 'w-0 border-r-0' : 'w-56')
          }
        >
          <div className="flex h-full w-56 flex-col">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-expanded
                aria-controls="counsel-sidebar-panel"
                aria-label={t('Collapse menu')}
                title={t('Collapse menu')}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {/* Content only renders when expanded, so collapsed nav links are
                never left hidden-but-focusable for keyboard / screen readers. */}
            <div
              id="counsel-sidebar-panel"
              className="min-h-0 flex-1 overflow-y-auto pb-4"
            >
              {!collapsed && children}
            </div>
          </div>
        </div>

        {/* Page-keeper tab - visible only when collapsed. Click to slide the
            rail back in.

            It deliberately does NOT expand on hover or focus. The tab renders
            flush against the panel's right edge, which is exactly where the
            collapse button (and therefore the cursor) just was, and then
            slides left as the panel animates shut. A hover handler fires on
            the very first frame, so collapsing appeared to do nothing: it
            closed and sprang straight back open under the stationary mouse. */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-expanded={false}
            aria-controls="counsel-sidebar-panel"
            aria-label={t('Show menu')}
            title={t('Show menu')}
            className="group mt-2 inline-flex h-fit flex-col items-center gap-2 self-start rounded-r-lg border border-l-0 border-edge bg-surface px-1.5 py-3 transition-colors hover:bg-surface-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="text-muted group-hover:text-foreground">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted group-hover:text-foreground"
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
