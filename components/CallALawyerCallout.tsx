'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  detectDecisionCues,
  DECISION_LABELS,
  type DecisionCueCategory,
} from '@/lib/decision-cues';

/**
 * Contextual "this is the moment to call a lawyer" callout. Three
 * ways to drive it:
 *
 *   1. `text` prop - content to scan for decision cues. If any
 *      cue fires, the callout renders with cue-specific copy.
 *   2. `reason` prop - caller has already decided this is the
 *      moment (e.g. hearing < 14 days out with no review). Skips
 *      the keyword scan and renders with the supplied reason.
 *   3. Both - `reason` takes precedence on the headline, cues
 *      drive any extra category-specific guidance.
 *
 * Designed to *empower*, not nag: dismissable per session, links
 * to find-counsel and public-defender directly so the user can
 * act in the same tap, never blocks their flow.
 */
export function CallALawyerCallout({
  text,
  reason,
  ctaHref = '/find-counsel',
  ctaLabel = 'Find counsel near you',
  className,
}: {
  text?: string;
  reason?: { title: string; body: string };
  ctaHref?: string;
  ctaLabel?: string;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const hits = text ? detectDecisionCues(text) : [];
  if (!reason && hits.length === 0) return null;

  const cats = new Set<DecisionCueCategory>(hits.map((h) => h.category));
  // First detected cue drives the headline if no explicit reason.
  const primary = reason ?? (hits[0] ? DECISION_LABELS[hits[0].category] : null);
  if (!primary) return null;

  // Criminal cue gets public-defender CTA priority.
  const showPublicDefender = cats.has('criminal_jail');

  return (
    <aside
      role="note"
      aria-live="polite"
      className={`rounded-xl ring-1 ring-amber-300/50 dark:ring-amber-500/35 bg-amber-50 dark:bg-amber-950/30 shadow-sm animate-fade-in ${
        className ?? ''
      }`}
    >
      <div className="p-4 sm:p-5 flex items-start gap-3">
        <span
          className="flex-none mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm"
          aria-hidden
        >
          <ScalesIcon />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-amber-950 dark:text-amber-100 text-[15px]">
              {primary.title}
            </p>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[11px] uppercase tracking-wider text-amber-800/80 hover:text-amber-950 dark:text-amber-200/70 dark:hover:text-amber-100"
              aria-label="Dismiss legal-counsel reminder"
            >
              Hide
            </button>
          </div>
          <p className="text-sm text-amber-900/85 dark:text-amber-100/85 mt-1.5 leading-relaxed">
            {primary.body}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {showPublicDefender ? (
              <Link
                href="/public-defender"
                className="inline-flex items-center gap-2 rounded-lg bg-forest-900 hover:bg-forest-800 text-cream-100 px-3.5 py-2 text-sm font-semibold shadow-sm dark:bg-gold-metal dark:text-forest-950 dark:hover:brightness-110"
              >
                <ScalesIcon size={14} /> Public defender directory
              </Link>
            ) : (
              <Link
                href={ctaHref}
                className="inline-flex items-center gap-2 rounded-lg bg-forest-900 hover:bg-forest-800 text-cream-100 px-3.5 py-2 text-sm font-semibold shadow-sm dark:bg-gold-metal dark:text-forest-950 dark:hover:brightness-110"
              >
                <ScalesIcon size={14} /> {ctaLabel}
              </Link>
            )}
            <Link
              href="/find-counsel"
              className="inline-flex items-center gap-2 rounded-lg bg-white text-forest-900 ring-1 ring-amber-300 hover:bg-amber-100 px-3.5 py-2 text-sm font-semibold dark:bg-forest-900 dark:text-cream-100 dark:ring-amber-500/40 dark:hover:bg-forest-800"
            >
              Find counsel
            </Link>
            <Link
              href="/about"
              className="text-[12px] underline underline-offset-2 text-amber-900/80 dark:text-amber-100/80 hover:text-amber-950 dark:hover:text-amber-100"
            >
              When Advottic is enough vs. when it isn&rsquo;t
            </Link>
          </div>

          {/* Show extra labels for any other cues that fired so the
              user knows everything we noticed - one passing reference
              that triggered the headline, plus any others. */}
          {hits.length > 1 && (
            <p className="mt-2.5 text-[11.5px] text-amber-900/65 dark:text-amber-100/65 leading-relaxed">
              We also noticed:{' '}
              {hits
                .slice(1)
                .map((h) => DECISION_LABELS[h.category].title.toLowerCase())
                .join(', ')}
              .
            </p>
          )}

          <p className="mt-2.5 text-[11px] text-amber-900/55 dark:text-amber-100/55">
            Heads-up only - if this does not apply, hide this notice and keep going.
          </p>
        </div>
      </div>
    </aside>
  );
}

function ScalesIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v18M5 21h14M5 7h14M5 7l-3 7a4 4 0 008 0L7 7M17 7l-3 7a4 4 0 008 0l-3-7" />
    </svg>
  );
}
