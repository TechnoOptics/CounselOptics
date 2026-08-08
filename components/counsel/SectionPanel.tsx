'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * A single collapsible matter section, styled as a firm black + gold tile.
 * The tile header is the always-visible summary; clicking it reveals the
 * section's content, which is passed as CHILDREN (not a prop) so it always
 * renders across the server/client boundary. Independent open state per panel.
 *
 * When an open section is long enough that its header scrolls off the top of
 * the viewport, a gold "Collapse" pill floats at the bottom of the screen so
 * the reader can close it in place instead of scrolling back up. The pill is
 * portaled to the body so the panel's `overflow-hidden` never clips it.
 */
export function SectionPanel({
  title,
  blurb,
  meta,
  icon,
  defaultOpen = false,
  reportCaseId,
  children,
}: {
  title: string;
  blurb: string;
  meta?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  /** When set, the FIRST time this panel is opened is reported to the case
   *  activity stream (so the firm sees a guest opened the section). */
  reportCaseId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reported = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [showPill, setShowPill] = useState(false);

  useEffect(() => setMounted(true), []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && reportCaseId && !reported.current) {
        reported.current = true;
        // Best-effort: never block the UI on the log write.
        void fetch('/api/counsel/activity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: reportCaseId, action: 'open_section', detail: { section: title } }),
          keepalive: true,
        }).catch(() => {});
      }
      return next;
    });
  }

  function collapseFromPill() {
    setShowPill(false);
    setOpen(false);
    // Bring the now-collapsed header back into view so the reader keeps their
    // place instead of being dropped mid-page by the removed content.
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  // Float the collapse pill only while this section is open AND its header has
  // scrolled above the viewport with content still on screen. A short section
  // whose header is still visible never shows the pill (no clutter).
  useEffect(() => {
    if (!open) {
      setShowPill(false);
      return;
    }
    let raf = 0;
    const update = () => {
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Header scrolled above the top AND the panel still fills the lower half
      // of the viewport. This means only a genuinely long section shows the
      // pill, and because a panel below another can't also satisfy top < 0,
      // at most one pill is ever visible.
      setShowPill(r.top < 0 && r.bottom > window.innerHeight * 0.5);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      className={`overflow-hidden rounded-xl border transition-colors ${
        open ? 'border-gold-metal/50 bg-forest-900/50' : 'border-cream-50/10 bg-forest-900/30'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-forest-900/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-metal/[0.12] text-gold-metal ring-1 ring-gold-metal/25">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-cream-50">
            <T>{title}</T>
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-cream-100/55">
            <T>{blurb}</T>
          </span>
        </span>
        {meta && (
          <span className="hidden shrink-0 font-mono text-[11px] tracking-wide text-gold-metal sm:block" data-no-translate>
            {meta}
          </span>
        )}
        {/* Gold-gradient chevron badge - a solid champagne pill so the
            expand/collapse affordance is unmistakable on the black surface. */}
        <span
          aria-hidden
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-metal text-forest-950 shadow-sm ring-1 ring-gold-300/40 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && <div className="border-t border-cream-50/10 p-4 sm:p-5">{children}</div>}

      {/* Floating collapse pill (portaled so overflow-hidden can't clip it). */}
      {mounted &&
        showPill &&
        createPortal(
          <button
            type="button"
            onClick={collapseFromPill}
            className="fixed left-1/2 z-[55] inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gold-metal px-4 py-2.5 text-[13px] font-semibold text-forest-950 shadow-xl ring-1 ring-gold-300/50 animate-fade-in hover:brightness-105"
            style={{ bottom: 'calc(1.25rem + var(--safe-bottom))' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <T>Collapse</T> <span data-no-translate>{title}</span>
            </span>
          </button>,
          document.body,
        )}
    </div>
  );
}
