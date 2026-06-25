'use client';

import { useEffect } from 'react';

/**
 * Page-level error boundary. Catches a throw inside the route content
 * (the {children} slot) without taking down the surrounding layout
 * chrome, so the header/footer stay and only the page area shows a
 * recover prompt. The root-level net for layout crashes is
 * app/global-error.tsx. Errors are POSTed to /api/crash so they surface
 * in crash_reports (the iOS WKWebView is otherwise a black box).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        message: `PageError: ${error?.message ?? 'unknown'}`,
        stack: error?.stack ?? null,
        url:
          typeof location !== 'undefined'
            ? location.pathname + (location.search || '')
            : null,
      });
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon(
          '/api/crash',
          new Blob([body], { type: 'application/json' }),
        );
      } else if (typeof fetch !== 'undefined') {
        fetch('/api/crash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* never let the reporter throw */
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-ink-500 dark:text-cream-100/60">
        This page ran into a problem. Try again, and if it keeps happening,
        reload the app.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-forest-900 px-5 py-2.5 text-sm font-semibold text-cream-100 hover:bg-forest-800 dark:bg-gold-500 dark:text-forest-950 dark:hover:bg-gold-400"
        >
          Try again
        </button>
        <button
          onClick={() => {
            if (typeof location !== 'undefined') location.reload();
          }}
          className="rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-semibold text-forest-900 hover:bg-ink-50 dark:border-forest-700/40 dark:text-cream-100 dark:hover:bg-forest-900/40"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
