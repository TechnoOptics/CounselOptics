'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a timestamp without producing a React hydration mismatch.
 *
 * Background (audit V5 CR-22, sub-cluster #425 / #422):
 *
 *   `new Date(iso).toLocaleString()` and `.toLocaleTimeString()` are
 *   environment-dependent. The Node.js SSR worker has its own locale
 *   + ICU timezone (typically UTC on Vercel), the user's browser uses
 *   the OS settings. Rendering the formatted string in both passes
 *   produces different bytes, which trips React #425 ("Text content
 *   does not match server-rendered HTML") - which itself rolls up
 *   into #422 ("error while hydrating this Suspense boundary").
 *
 *   The audit traced #422/#425 firings on /admin/security (the live
 *   "Last run HH:MM:SS" pulse) and /admin/feedback (the "Submitted
 *   on Month D, YYYY, h:mm" timestamp) - every render of those
 *   pages was producing a mismatch.
 *
 * Fix: render the deterministic ISO string on the first paint (so
 *   SSR and the first client render agree), then switch to the
 *   locale-aware formatting after mount. The flicker is a single
 *   tick on slow networks and invisible on warm ones.
 *
 *   `suppressHydrationWarning` on the wrapper makes React tolerate
 *   the subsequent swap without logging a warning even if the
 *   strings differ across rerenders.
 *
 *   When `mode === 'time'` we render just HH:MM:SS (the pulse-
 *   dashboard "Last run" label); 'datetime' renders a full
 *   month/day/year + h:mm. Callers pick.
 */
export function LocaleTime({
  iso,
  mode = 'datetime',
  fallback,
  className,
}: {
  iso: string | null | undefined;
  mode?: 'datetime' | 'time' | 'date';
  /**
   * Optional override for the SSR-side text. Defaults to the ISO
   * string truncated to seconds. Useful when the caller wants a
   * non-ISO placeholder ("-", "in progress", etc.).
   */
  fallback?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!iso) {
    return <span className={className}>{fallback ?? ''}</span>;
  }

  // First paint: deterministic ISO string. Server and client agree.
  if (!mounted) {
    return (
      <span className={className} suppressHydrationWarning>
        {fallback ?? iso.slice(0, mode === 'time' ? 19 : 16).replace('T', ' ')}
      </span>
    );
  }

  // After mount: render in the user's locale + timezone.
  const date = new Date(iso);
  const formatted =
    mode === 'time'
      ? date.toLocaleTimeString()
      : mode === 'date'
        ? date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
  return (
    <span className={className} suppressHydrationWarning>
      {formatted}
    </span>
  );
}
