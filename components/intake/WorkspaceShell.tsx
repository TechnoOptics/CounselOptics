'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A two-pane workspace that fills the viewport and scrolls per pane instead
 * of scrolling the document — the pattern behind Linear, Front, Intercom and
 * the Salesforce console.
 *
 * Why measured height rather than a hard-coded `calc()`: this sits inside the
 * ordinary Counsel shell, under a sticky header whose height varies with the
 * trial banner, so the distance from the top of the viewport is not a
 * constant. We measure it once, subtract the footer, and pin the region to
 * exactly the remaining space so the page itself never grows a scrollbar.
 *
 * The scroll mechanics that matter (and are easy to get wrong):
 *   - every flex ancestor between here and a scroller carries `min-h-0`,
 *     because a flex item's default `min-height:auto` refuses to shrink below
 *     its content and the child's `overflow-y-auto` then never engages;
 *   - `minmax(0,1fr)` on the grid track, for the same reason in grid;
 *   - `overscroll-contain` so hitting the end of one pane doesn't chain-scroll
 *     the other;
 *   - `tabindex=0` on each scroller so keyboard users can reach panes whose
 *     content has no focusable children (axe scrollable-region-focusable).
 */
export function WorkspaceShell({
  children,
  side,
  sideLabel = 'Conversation',
  mainLabel = 'Request details',
}: {
  children: React.ReactNode;
  side: React.ReactNode;
  sideLabel?: string;
  mainLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<string | undefined>(undefined);
  const [stacked, setStacked] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // Below the two-pane breakpoint the panes stack and the document
      // scrolls normally — pinning height there would trap content.
      const narrow = window.innerWidth < 1024;
      setStacked(narrow);
      if (narrow) {
        setHeight(undefined);
        document.documentElement.style.removeProperty('--adv-workspace-h');
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const footer = document.querySelector('footer')?.getBoundingClientRect().height ?? 0;
      const pad = parseFloat(
        getComputedStyle(el.parentElement ?? el).paddingBottom || '0',
      );
      const h = `calc(100dvh - ${Math.round(top + footer + pad + 8)}px)`;
      setHeight(h);
      // The left nav rail sizes itself independently and was taller than the
      // workspace, which kept the document scrolling behind the pinned panes.
      document.documentElement.style.setProperty('--adv-workspace-h', h);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty('--adv-workspace-h');
    };
  }, []);

  // Re-measure once fonts/images settle, so the first paint isn't off by a row.
  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      style={height ? { height } : undefined}
      data-workspace-shell
      className={`grid min-h-0 gap-5 ${
        stacked
          ? 'grid-cols-1'
          : 'grid-cols-[minmax(0,1fr)_minmax(400px,440px)] xl:grid-cols-[minmax(0,1fr)_minmax(440px,500px)]'
      }`}
    >
      <main
        aria-label={mainLabel}
        tabIndex={0}
        className={`relative min-w-0 min-h-0 rounded-2xl border border-ink-200 bg-white shadow-sm dark:border-forest-700/60 dark:bg-forest-900/55 ${
          stacked ? '' : 'overflow-y-auto overscroll-contain [scrollbar-gutter:stable]'
        } [scroll-padding-top:4rem]`}
      >
        {children}
      </main>

      <aside
        aria-label={sideLabel}
        className={`flex min-h-0 min-w-0 flex-col gap-3 ${stacked ? '' : 'overflow-hidden'}`}
      >
        {side}
      </aside>
    </div>
  );
}
