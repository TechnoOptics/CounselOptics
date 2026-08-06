'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import {
  ACCESS_ENDED_PATH,
  displayableDigest,
  isAccessEndedError,
} from '@/lib/firm-access';

/**
 * Route-scoped error boundary for a firm matter. The matter page pulls a lot
 * of surfaces together (facts, evidence, timeline, analysis, images, legal
 * review, approaches); if any one of them throws during render, this contains
 * the failure to the page body - with a calm message and a retry - instead of
 * letting it bubble to the global error page and blank the whole app. Calm,
 * non-alarming copy per the app's tone.
 *
 * This boundary is NEARER than app/counsel/error.tsx, so it wins for the whole
 * matter workspace, which is where every gated evidence, signing, chat and
 * timeline action actually lives. That makes it, and not the segment boundary,
 * the one a refused write reaches, so it has to know the same identity. A
 * boundary the refusal never reaches is a boundary that does nothing. Keep the
 * two in step: if the refusal copy in app/counsel/error.tsx changes, change it
 * here as well.
 */
export default function CaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const accessEnded = isAccessEndedError(error);

  useEffect(() => {
    // An access-ended refusal is the product working, not a crash, so it is
    // not logged as one.
    if (accessEnded) return;
    // Surface it in the console + Vercel logs so the underlying throw can be
    // traced, without showing the raw stack to the user.
    console.error('[counsel/cases/[id]] render error', error);
  }, [error, accessEnded]);

  if (accessEnded) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="card p-8 space-y-4">
          <p className="eyebrow justify-center">Advottic</p>
          <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
            Your organization&rsquo;s access has ended
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            That changed while you were working, so this was not saved. Your
            data is not being deleted, and it is all still here.
          </p>
          <div className="flex items-center justify-center pt-1">
            <Link href={ACCESS_ENDED_PATH} className="btn-primary text-sm">
              See what you can still do
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Only a digest Next generated is a support reference. Anything this
  // codebase put on the error is an internal identifier, and printing it raw
  // is how a locked-out person was shown "Reference: FIRM_ACCESS_ENDED".
  const reference = displayableDigest(error.digest);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="card p-8 space-y-4">
        <p className="eyebrow justify-center">Advottic</p>
        <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          This matter didn&rsquo;t finish loading
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Something on this page ran into a problem. Your matter and its evidence
          are safe. Try again, and if it keeps happening, reload the page.
        </p>
        {reference && (
          <p className="text-[11px] text-ink-400 dark:text-cream-100/40 font-mono">
            Reference: {reference}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-1">
          <button type="button" onClick={() => reset()} className="btn-primary text-sm">
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-ghost text-sm"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
