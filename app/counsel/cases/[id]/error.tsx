'use client';

import { useEffect } from 'react';

/**
 * Route-scoped error boundary for a firm matter. The matter page pulls a lot
 * of surfaces together (facts, evidence, timeline, analysis, images, legal
 * review, approaches); if any one of them throws during render, this contains
 * the failure to the page body - with a calm message and a retry - instead of
 * letting it bubble to the global error page and blank the whole app. Calm,
 * non-alarming copy per the app's tone.
 */
export default function CaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it in the console + Vercel logs so the underlying throw can be
    // traced, without showing the raw stack to the user.
    console.error('[counsel/cases/[id]] render error', error);
  }, [error]);

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
        {error.digest && (
          <p className="text-[11px] text-ink-400 dark:text-cream-100/40 font-mono">
            Reference: {error.digest}
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
