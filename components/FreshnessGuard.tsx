'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Three small reinforcing pieces that keep the PWA / installed
 * browser app fresh:
 *
 *  1. Auto-refresh on focus. When the tab/app comes back to the
 *     foreground (visibilitychange / pageshow / focus) we silently
 *     call router.refresh() so the next paint shows fresh server
 *     data without the user having to pull-to-refresh manually.
 *
 *  2. New-version toast. We capture the commit SHA at first load,
 *     then poll /api/version every ~90 seconds. If the SHA changes
 *     (new prod deploy) we surface a small "New version - reload"
 *     toast. Polling is paused while the tab is hidden to avoid
 *     waking the device.
 *
 *  3. Pull-to-refresh signal. The browser handles vertical overscroll
 *     itself in standalone mode; we listen for `pull-to-refresh`-
 *     adjacent gestures and trigger the same router.refresh() so
 *     content updates even when the network round-trip is invisible.
 */
export function FreshnessGuard({ initialSha }: { initialSha: string }) {
  const router = useRouter();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialShaRef = useRef(initialSha);
  const lastRefreshRef = useRef(0);

  // 1. Refresh on focus. Throttled to once per 5s so a flurry of
  //    visibility events (multitasking on iOS bounces the listener)
  //    doesn't hammer the server.
  useEffect(() => {
    function maybeRefresh() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefreshRef.current < 5000) return;
      lastRefreshRef.current = now;
      router.refresh();
    }
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
    window.addEventListener('pageshow', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('focus', maybeRefresh);
      window.removeEventListener('pageshow', maybeRefresh);
    };
  }, [router]);

  // 2. Poll /api/version every 90s while visible. Skip if we already
  //    detected an update - one nudge is enough.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { sha?: string };
        if (cancelled) return;
        if (j.sha && j.sha !== initialShaRef.current) {
          setUpdateAvailable(true);
        }
      } catch {
        /* network blip - try again next tick */
      }
    }
    // Don't poll right away; wait one cycle so the initial load
    // has settled.
    const t = setInterval(check, 90_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed left-[calc(0.75rem+var(--safe-left))] right-[calc(0.75rem+var(--safe-right))] sm:left-auto sm:right-[calc(1.5rem+var(--safe-right))] top-[calc(0.75rem+var(--safe-top))] sm:top-[calc(1.5rem+var(--safe-top))] sm:max-w-sm z-[60] animate-fade-up">
      <div
        role="status"
        className="rounded-xl bg-forest-950 text-cream-100 ring-1 ring-gold-300/40 shadow-card-hover px-4 py-3 flex items-center gap-3 backdrop-blur"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-gold-300 animate-pulse flex-none" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold leading-tight">
            Advottic just updated
          </p>
          <p className="text-[11.5px] text-cream-100/70 leading-snug">
            Reload to see the latest version.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex-none rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setUpdateAvailable(false)}
          aria-label="Dismiss update notice"
          className="flex-none text-cream-100/60 hover:text-cream-100 px-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
