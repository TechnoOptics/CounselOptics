'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { AIReview } from '@/lib/types';
import { runReviewAction } from '@/lib/actions';

/**
 * Sticky "Next steps" pill at the top of every case page.
 *
 * Background: in the new 4-tab IA (Case / Analysis / Hearing /
 * Manage) Advottic Review lives as the third section of the
 * Analysis tab. Users reported "I have no idea how to get to the
 * Review" - they were stuck on the Case tab and didn't realize
 * Analysis even existed. This pill solves that by surfacing the
 * single most-valuable Review output (Next steps) directly on the
 * case page header, regardless of which tab the user is on.
 *
 * Two states:
 *   - Review exists: pill shows "N next steps - tap to view" and
 *     opens a slide-over with each bullet, plus a deep link to
 *     the full Review section.
 *   - No review yet: pill shows "Run Advottic Review to see what
 *     to do next" and opens a panel with a one-click run-review
 *     button. After it finishes, the pill swaps to the bullet
 *     view without a page reload.
 *
 * The pill itself sits BELOW the page header and ABOVE the Tabs
 * strip, so it's the first thing the user sees after the title
 * and never gets hidden by tab switches.
 */
export function NextStepsPill({
  caseId,
  review: initialReview,
}: {
  caseId: string;
  review: AIReview | null;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<AIReview | null>(initialReview);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while the slide-over is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function triggerReview() {
    setError(null);
    startTransition(async () => {
      try {
        await runReviewAction(caseId);
        // The server action revalidates; for snappy UX we also
        // refresh local state by reloading. A heavier-weight
        // version would re-fetch the review JSON, but full reload
        // is simpler and matches the existing ReviewPanel flow.
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Review failed to run.',
        );
      }
    });
  }

  const nextSteps = review?.suggestedNextSteps ?? [];
  const stepCount = nextSteps.length;

  return (
    <>
      {/* Pill - always visible at the top of the case page */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex items-center gap-2.5 max-w-full rounded-full pl-3 pr-4 py-2 transition-all ${
          review
            ? 'bg-gradient-to-r from-amber-50 to-cream-50 dark:from-forest-900/40 dark:to-forest-900/60 ring-1 ring-gold-300/70 dark:ring-gold-metal/40 hover:ring-gold-500 dark:hover:ring-gold-metal/70 shadow-sm'
            : 'bg-ink-50 dark:bg-forest-900/40 ring-1 ring-ink-200 dark:ring-forest-700/40 hover:ring-forest-700 dark:hover:ring-gold-metal/40'
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          aria-hidden
          className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-full ${
            review
              ? 'bg-gold-500/15 text-gold-700 dark:text-gold-300'
              : 'bg-forest-900/8 dark:bg-cream-100/10 text-forest-900 dark:text-cream-100/70'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-[10px] uppercase tracking-[0.2em] font-semibold text-gold-700 dark:text-gold-300">
            Advottic Review
          </span>
          <span className="block text-[13px] font-medium text-ink-950 dark:text-cream-100 truncate">
            {review
              ? stepCount > 0
                ? `${stepCount} next ${stepCount === 1 ? 'step' : 'steps'} - tap to view`
                : 'Review complete - tap for details'
              : 'Run review to see what to do next'}
          </span>
        </span>
        <span
          aria-hidden
          className="text-ink-400 dark:text-cream-100/45 group-hover:text-forest-700 dark:group-hover:text-cream-100 ml-1 transition-colors"
        >
          →
        </span>
      </button>

      {/* Slide-over panel */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Next steps from Advottic Review"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px] animate-[fadeIn_.18s_ease]"
          />
          <aside
            className="relative ml-auto h-full w-full sm:max-w-md bg-white dark:bg-forest-900 shadow-2xl overflow-y-auto flex flex-col"
            style={{
              paddingTop: 'var(--app-safe-top, env(safe-area-inset-top, 0px))',
            }}
          >
            <header className="sticky top-0 bg-white/95 dark:bg-forest-900/95 backdrop-blur border-b border-ink-100 dark:border-forest-700/40 px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
                  Advottic Review
                </p>
                <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-ink-950 dark:text-cream-100 mt-0.5">
                  {review ? 'Next steps' : 'No review yet'}
                </h2>
                {review && stepCount > 0 && (
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    Top recommendations from your case Review.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-forest-800"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </header>

            <div className="flex-1 px-5 py-5 space-y-5">
              {!review ? (
                <>
                  <p className="text-[14px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
                    Advottic Review reads your case description and exhibits,
                    then surfaces issues, evidence gaps, and a list of next
                    steps in plain English. It uses AI but is never used to
                    train external models.
                  </p>
                  {error && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={triggerReview}
                    disabled={pending}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 h-12 rounded-md bg-forest-900 text-cream-100 text-sm font-semibold hover:bg-forest-800 disabled:opacity-60 transition-colors"
                  >
                    {pending ? (
                      <>
                        <Spinner /> Reading the case…
                      </>
                    ) : (
                      <>
                        <SparkleIcon /> Run Advottic Review
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed text-center">
                    Usually finishes in 30-60 seconds. The page will reload
                    with the full Review when it's done.
                  </p>
                </>
              ) : stepCount === 0 ? (
                <p className="text-[14px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
                  The Review didn't surface specific next steps. Open the full
                  Review below to see the Overview, Facts, and Evidence
                  recommendations instead.
                </p>
              ) : (
                <ol className="space-y-3">
                  {nextSteps.map((s, i) => (
                    <li
                      key={i}
                      className="flex gap-3 rounded-lg border border-ink-100 dark:border-forest-700/40 bg-cream-50/40 dark:bg-forest-900/40 p-4"
                    >
                      <span
                        aria-hidden
                        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold-400/20 text-gold-700 dark:text-gold-300 text-[12px] font-semibold tabular-nums"
                      >
                        {i + 1}
                      </span>
                      <p className="text-[14px] text-ink-900 dark:text-cream-100 leading-relaxed whitespace-pre-wrap">
                        {s}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {review && (
                <Link
                  href="#analysis-review"
                  onClick={() => setOpen(false)}
                  className="block text-center text-[13px] font-medium text-gold-700 dark:text-gold-300 hover:text-gold-800 dark:hover:text-gold-200 py-2"
                >
                  Open the full Review →
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
