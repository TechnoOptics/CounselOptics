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
import {
  edgeRevealDecision,
  idleHideBlocker,
  shouldWatchForIdle,
  OPEN_OVERLAY_SELECTOR,
  EDGE_DWELL_MS,
  IDLE_HIDE_MS,
} from '@/lib/sidebar-edge-reveal';

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
 * The screen edge, as a way back to a collapsed rail.
 *
 * Hover is an ACCELERATOR here and never the only way in. The page-keeper tab
 * beside this is a real <button>: reachable by Tab, activated by Enter or
 * Space, and hit-testable by a thumb. This adds a mouse shortcut on top of it
 * and takes nothing away, which is why it arms only when the pointer can
 * actually aim at a 6px strip.
 *
 * Four guards, each of which is a way this would otherwise misfire.
 *
 * FINE POINTERS ONLY. `(hover: hover) and (pointer: fine)` is the pair that
 * means a mouse or a trackpad. A touch device reports `hover: none`, and on one
 * a screen-edge trigger is both unaimable and, worse, in competition with the
 * browser's own back-swipe. There the tab is the whole interface.
 *
 * NOT WHILE A BUTTON IS DOWN. A pointer crossing the left edge with
 * `buttons !== 0` is dragging something (a document onto the page, a divider,
 * the scrollbar) and the nav sliding out underneath that drag is a surprise in
 * the middle of a gesture the user is committed to.
 *
 * NOT WHILE TEXT IS SELECTED. Sweeping a selection leftwards through the
 * matter summary ends with the cursor past the edge of the text. The selection
 * is live at that moment even between drags, so `buttons` alone does not cover
 * it and the collapsed range has to be checked as well.
 *
 * ARMED, THEN DWELT. The tab above documents why it deliberately does not
 * expand on hover: it renders where the cursor just was, so the rail sprang
 * straight back open under a stationary mouse. The same trap is here, because
 * the rail can be collapsed by the keyboard or by a route while the pointer
 * happens to be resting at the left of the window. So the zone starts DISARMED
 * and is armed by the pointer being seen outside it, and even then the pointer
 * has to rest inside for EDGE_DWELL_MS. A pointer merely travelling across the
 * edge on its way somewhere else never opens anything.
 *
 * There is no motion of its own to suppress under prefers-reduced-motion: this
 * component only flips the collapse flag, and the panel it flips already
 * carries `motion-reduce:transition-none`, so the rail arrives instantly rather
 * than sliding. Motion drops out, it is not reduced.
 */
function SidebarEdgeReveal({ onReveal }: { onReveal: () => void }) {
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!fine.matches) return;

    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const selecting = () => {
      const sel = window.getSelection();
      return sel != null && sel.rangeCount > 0 && !sel.isCollapsed;
    };

    const onMove = (e: PointerEvent) => {
      // Every rule lives in lib/sidebar-edge-reveal.ts, where it can be tested
      // without a browser. This half is only the parts that need one.
      const d = edgeRevealDecision(
        { x: e.clientX, buttons: e.buttons, hasSelection: selecting() },
        armed,
      );
      armed = d.armed;
      if (d.action === 'cancel') {
        cancel();
        return;
      }
      if (d.action === 'hold') return;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        onReveal();
      }, EDGE_DWELL_MS);
    };

    // NOT `pointerleave` ON THE DOCUMENT, and this was measured rather than
    // reasoned about. That listener was here to drop a pending timer when the
    // pointer left the window, and instead it made the whole feature
    // unreliable: the document element does not reach the left of the viewport
    // under this shell, so it fires `pointerleave` CONTINUOUSLY at clientX 5,
    // which is inside the 6px zone. Every dwell was cancelled on the frame it
    // started. The reveal worked once, by a race, and then never again, with
    // twenty-five tests green over it.
    //
    // Window blur is the honest signal for "they have gone". A timer still
    // pending when the pointer exits the left edge is not worth defending
    // against: the worst it does is open the nav a tenth of a second later,
    // which is the thing the gesture was asking for and is one click to undo.
    const onBlur = () => cancel();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onBlur);
    window.addEventListener('blur', onBlur);
    return () => {
      cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onBlur);
      window.removeEventListener('blur', onBlur);
    };
  }, [onReveal]);

  return null;
}

/**
 * The rail hiding itself once it has been left alone.
 *
 * The rules are in lib/sidebar-edge-reveal.ts beside the edge zone's, because
 * they are two halves of one feature and because a decision with a timer in it
 * cannot be tested: an automated tab reports `visibilityState: 'hidden'` and
 * Chrome freezes a hidden tab's timers. This half is only what needs a browser.
 *
 * THE STATE IS READ FROM THE DOM AT THE DEADLINE, not tracked in refs as it
 * happens. `contains(document.activeElement)` and `:hover` are the truth;
 * a pair of flags maintained across enter, leave, focus and blur is a second
 * model of the same thing that drifts the first time an event is missed, and
 * "focus is inside" is the one fact here that may never be wrong. The handlers
 * therefore do one job: push the deadline back.
 *
 * The one fact the DOM cannot answer is whether a button is held, since there
 * is no event to read at the moment the timer fires, so that is tracked.
 */
function useIdleHide(collapsed: boolean, onHide: () => void) {
  const panel = useRef<HTMLDivElement | null>(null);
  const arm = useRef<() => void>(() => {});

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!shouldWatchForIdle({ finePointer: fine.matches, collapsed })) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let dragging = false;

    const selecting = () => {
      const sel = window.getSelection();
      return sel != null && sel.rangeCount > 0 && !sel.isCollapsed;
    };

    // A real query rather than a hardcoded false. The rail carries no menu
    // today; the day one lands, an open popover already blocks the hide
    // instead of closing under whoever opened it. What the selector may and
    // may not match is in lib/sidebar-edge-reveal.ts, where the reason is: an
    // unqualified aria-expanded matched the panel's OWN collapse button and
    // the rail never hid at all.
    const menuOpen = () =>
      panel.current?.querySelector(OPEN_OVERLAY_SELECTOR) != null;

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const el = panel.current;
        const blocked = idleHideBlocker({
          focusWithin: el != null && el.contains(document.activeElement),
          pointerOver: el != null && el.matches(':hover'),
          buttons: dragging ? 1 : 0,
          menuOpen: menuOpen(),
          hasSelection: selecting(),
        });
        // A refused deadline waits for another one. Giving up here would mean
        // one drag over the rail disables the hide for the rest of the session.
        if (blocked !== null) return schedule();
        onHide();
      }, IDLE_HIDE_MS);
    };

    const down = () => {
      dragging = true;
      schedule();
    };
    const up = () => {
      dragging = false;
      schedule();
    };

    arm.current = schedule;
    schedule();
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      arm.current = () => {};
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [collapsed, onHide]);

  const keepOpen = useCallback(() => arm.current(), []);
  return { panel, keepOpen };
}

/**
 * The collapsible wrapper around the server-rendered sidebar. Receives the
 * <CounselSidebar/> as children so that stays server-rendered; only the
 * collapse chrome is client-side.
 */
export function CounselSidebarShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { collapsed, setCollapsed } = useSidebarCollapse();
  const reveal = useCallback(() => setCollapsed(false), [setCollapsed]);
  const hide = useCallback(() => setCollapsed(true), [setCollapsed]);
  const { panel, keepOpen } = useIdleHide(collapsed, hide);

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
      {/* Only while collapsed. An edge zone over an already open rail is a
          listener that can only misfire. */}
      {collapsed && <SidebarEdgeReveal onReveal={reveal} />}

      <div className="relative flex h-full items-stretch">
        {/* Sidebar panel.

            The handlers push the idle deadline back; they never decide
            anything. Every rule about whether the panel MAY go lives in
            lib/sidebar-edge-reveal.ts and is read from the DOM when the
            deadline arrives, so a missed event costs a later hide rather than
            a panel that leaves under somebody's hands. */}
        <div
          ref={panel}
          onPointerEnter={keepOpen}
          onPointerLeave={keepOpen}
          onPointerMove={keepOpen}
          onFocus={keepOpen}
          onBlur={keepOpen}
          onClick={keepOpen}
          onKeyDown={keepOpen}
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
