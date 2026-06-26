'use client';

import { useState } from 'react';

/**
 * Collapsible footer column.
 *
 * The link list is collapsed by default on every viewport — the footer
 * shows just the clickable section headings (with a + that rotates to ×),
 * and selecting one expands its links in place. This keeps the footer
 * compact on desktop and mobile alike instead of dumping a long section
 * like "Product" down the page. The links stay in the DOM (hidden via
 * CSS) so they remain crawlable.
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
        className="flex w-full items-center justify-between py-1 text-left"
      >
        <span className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
          {title}
        </span>
        <span
          aria-hidden
          className={`text-ink-400 dark:text-cream-100/55 text-[14px] font-mono leading-none transition-transform ${
            open ? 'rotate-45' : ''
          }`}
        >
          +
        </span>
      </button>
      <div className={`${open ? 'block' : 'hidden'} space-y-1 mt-2`}>
        {children}
      </div>
    </div>
  );
}
