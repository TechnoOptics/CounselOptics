'use client';

import { useState } from 'react';

/**
 * Collapsible footer column.
 *
 * On phones the link list is collapsed by default (tap the heading to
 * expand) so a long section like "Product" doesn't stretch the footer
 * down the whole page. On md+ it renders as a static, always-open
 * column: the toggle is disabled and the content is forced visible via
 * `md:block`, so the desktop layout is unchanged.
 *
 * We use a button + `hidden md:block` rather than <details> on purpose:
 * <details> cannot be reliably "closed on mobile, open on desktop" with
 * CSS across browsers (Chrome's newer ::details-content model ignores a
 * display override on the children), which left the old version stuck
 * open on every viewport.
 */
export function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="col-span-2 md:col-span-1 border-b border-ink-100 dark:border-forest-700/40 pb-3 md:border-b-0 md:pb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-1 text-left md:cursor-default md:pointer-events-none"
      >
        <span className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
          {title}
        </span>
        <span
          aria-hidden
          className={`md:hidden text-ink-400 dark:text-cream-100/55 text-[14px] font-mono leading-none transition-transform ${
            open ? 'rotate-45' : ''
          }`}
        >
          +
        </span>
      </button>
      <div
        className={`${open ? 'block' : 'hidden'} md:block space-y-1 mt-2 md:mt-1.5`}
      >
        {children}
      </div>
    </div>
  );
}
