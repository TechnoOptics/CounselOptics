'use client';

import { useEffect, useRef, useState } from 'react';
import { OPEN_SECTION_EVENT } from './SectionJump';

/**
 * A collapsible section of the request record.
 *
 * The research is consistent that a work record should be one scannable
 * scroll of collapsible sections rather than tabs: content behind an
 * unselected tab is frequently never discovered, and every click is a cost.
 * Jira Service Management landed in the same place and persists each
 * section's collapsed state per user — so do we, keyed by section id, which
 * means a team member who never needs "Other parties" collapses it once and
 * it stays that way.
 */
export function RecordSection({
  id,
  title,
  count,
  defaultOpen = true,
  accent,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  /** Optional right-aligned status chip. */
  accent?: React.ReactNode;
  children: React.ReactNode;
}) {
  const storageKey = `adv-section:${id}`;
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // A header button can ask for this section: open it and bring it into view,
  // even if the reader had collapsed it earlier.
  useEffect(() => {
    function onJump(e: Event) {
      const wanted = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (wanted !== id) return;
      setOpen(true);
      requestAnimationFrame(() =>
        ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
    }
    window.addEventListener(OPEN_SECTION_EVENT, onJump);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onJump);
  }, [id]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === 'open') setOpen(true);
      else if (saved === 'closed') setOpen(false);
    } catch {
      /* private mode — fall back to the default */
    }
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? 'open' : 'closed');
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }

  return (
    <section
      ref={ref}
      className="scroll-mt-16 border-b border-ink-100 last:border-b-0 dark:border-forest-800/60"
    >
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-cream-50/70 dark:hover:bg-forest-800/30"
        >
          <svg
            aria-hidden
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            className={`shrink-0 text-ink-400 transition-transform duration-200 dark:text-cream-100/45 ${
              open ? 'rotate-90' : ''
            }`}
          >
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-600 dark:text-cream-100/75">
            {title}
          </span>
          {typeof count === 'number' && count > 0 && (
            <span className="rounded-full bg-ink-100 px-1.5 py-px text-[10.5px] font-semibold text-ink-600 dark:bg-forest-800/70 dark:text-cream-100/70">
              {count}
            </span>
          )}
          <span className="ml-auto">{accent}</span>
        </button>
      </h2>
      {/* Render collapsed content only after hydration so the saved state
          doesn't flash open on first paint. */}
      {open && <div className={`px-5 pb-5 ${hydrated ? '' : 'opacity-0'}`}>{children}</div>}
    </section>
  );
}
