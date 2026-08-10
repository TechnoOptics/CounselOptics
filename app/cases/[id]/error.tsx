'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { displayableDigest } from '@/lib/firm-access';

/**
 * Route-scoped error boundary for a personal case.
 *
 * app/cases/[id]/page.tsx loads the case, its exhibits, its review and its
 * collaborators in one Promise.all, and each of those helpers ends in
 * `if (error) throw error` (lib/storage.ts:365, :691, :853, :1513). Any single
 * one of them takes the whole page down, and until now the nearest boundary
 * was the root app/error.tsx, which says "Something went wrong" and drops the
 * digest on the floor. So the person had nothing to quote and support had
 * nothing to join their report to, even though instrumentation.ts already logs
 * that digest next to the real message and stack.
 *
 * The counsel matter page has had this since cadd9a56. This is the consumer
 * twin, deliberately kept in step with it: same reference line, same calm
 * register. Consumer users arrive in real legal distress, so the copy leads
 * with their evidence being safe.
 */
export default function CaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console + Vercel logs, so the throw can be traced without showing the
    // raw stack to the person reading the page.
    console.error('[cases/[id]] render error', error);
  }, [error]);

  // Only a digest Next generated is a support reference. Anything this
  // codebase put on the error is an internal identifier, not something to
  // print at someone.
  const reference = displayableDigest(error.digest);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="card p-8 space-y-4">
        <p className="eyebrow justify-center">Advottic</p>
        <h1 className="text-2xl text-forest-900 dark:text-cream-100">
          This case didn&rsquo;t finish loading
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Something on this page ran into a problem. Your case and everything
          you have uploaded are safe. Try again, and if it keeps happening,
          reload the page.
        </p>
        {reference && (
          <p className="text-[11px] text-ink-400 dark:text-cream-100/40 font-mono">
            Reference: {reference}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
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
          <Link href="/cases" className="btn-ghost text-sm">
            Back to cases
          </Link>
        </div>
      </div>
    </div>
  );
}
