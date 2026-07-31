'use client';

import { Children, useState } from 'react';

/**
 * Progressive disclosure for lists. Shows the first `initial` items and
 * tucks the rest behind a calm "Show N more" toggle so a long list does
 * not run down the whole screen. Expands in place; "Show fewer" collapses
 * it again.
 *
 * Usage: wrap the `.map(...)` output of a <ul>/<ol>. The toggle renders as
 * a trailing <li> so it stays valid inside a list and inherits its spacing.
 *
 *   <ul className="space-y-2">
 *     <ShowMore initial={3} noun="updates">
 *       {events.map((e) => <li key={e.id}>…</li>)}
 *     </ShowMore>
 *   </ul>
 *
 * Copy is intentionally plain and reassuring (this app helps people through
 * stressful legal situations), with no alarming or jokey wording.
 */
export function ShowMore({
  children,
  initial = 3,
  noun,
}: {
  children: React.ReactNode;
  /** How many items to show before collapsing. */
  initial?: number;
  /** Optional plural noun for the toggle, e.g. "exhibits" → "Show 4 more exhibits". */
  noun?: string;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);

  // Nothing to collapse, so render as-is.
  if (items.length <= initial) return <>{children}</>;

  const hiddenCount = items.length - initial;
  const visible = expanded ? items : items.slice(0, initial);

  return (
    <>
      {visible}
      <li className="list-none !mt-2 flex justify-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-forest-700 hover:text-forest-900 hover:bg-forest-50 dark:text-gold-300 dark:hover:text-gold-200 dark:hover:bg-forest-800/50 transition-colors"
        >
          {expanded ? 'Show fewer' : `Show ${hiddenCount} more${noun ? ` ${noun}` : ''}`}
          <span aria-hidden className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
            ⌄
          </span>
        </button>
      </li>
    </>
  );
}
