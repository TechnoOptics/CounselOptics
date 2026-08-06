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
 *     then compare it against /api/version on mount, whenever the tab
 *     comes back to the foreground, and on a ~90 second poll. If the
 *     SHA differs (the document was rendered by an older deployment,
 *     or a new one shipped while this tab was open) we surface a small
 *     "Advottic just updated - Reload" toast. Checks are skipped while
 *     the tab is hidden to avoid waking the device.
 *
 *     The on-mount and on-focus checks are the point. This used to be a
 *     bare setInterval(90s), and every full page load restarted the
 *     clock - so a lawyer clicking from /counsel to /counsel/inbox to a
 *     matter never reached the first tick, and a stale document could
 *     sit on screen for as long as they kept working without ever
 *     offering them the reload.
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
  // Latched once the toast has fired or the user has waved it away. Without
  // it, dismissing did nothing: the poll and the new focus listener simply
  // raised the same toast again on the next tick.
  const settledRef = useRef(false);

  // 1. Refresh on focus. Throttled to once per 5s so a flurry of
  //    visibility events (multitasking on iOS bounces the listener)
  //    doesn't hammer the server.
  //
  //    Two things this must never do, because router.refresh() re-renders
  //    the route and remounts the client components on it - which drops
  //    the caret, moves the scroll position, and clears anything already
  //    typed into an unsubmitted form:
  //
  //    a) Treat focus returning from an <iframe> on the SAME page as the
  //       tab coming back to the foreground. On any page that embeds a
  //       document preview (a firm document, a signing request) the
  //       window fires blur when the reader clicks into the preview and
  //       focus again when they click back into the form beside it, with
  //       the document never once leaving the foreground. That was
  //       wiping the signer fields on /counsel/documents/[id] every time
  //       someone read the PDF and then went to fill the form in.
  //    b) Refresh while the user is mid-entry in a field. A background
  //       freshness check is never worth the text someone was typing, so
  //       we defer: the next focus/visibility event, or the 90s version
  //       poll below, picks it up once they have moved on.
  useEffect(() => {
    // What held focus when the window last blurred. Set to true when the
    // window handed focus to an embedded frame on this same page.
    let blurredIntoEmbed = false;

    function isEditing(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    }

    function maybeRefresh() {
      if (document.visibilityState !== 'visible') return;
      if (isEditing()) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < 5000) return;
      lastRefreshRef.current = now;
      router.refresh();
    }

    function onBlur() {
      const tag = document.activeElement?.tagName;
      blurredIntoEmbed =
        tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT';
    }

    function onFocus() {
      // Focus coming back out of an embedded frame is an in-page move,
      // not a return to the foreground. Consume the latch and skip.
      if (blurredIntoEmbed) {
        blurredIntoEmbed = false;
        return;
      }
      maybeRefresh();
    }

    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', maybeRefresh);
    };
  }, [router]);

  // 2. Compare this document's build SHA against production's, on
  //    mount, on refocus, and on a 90s poll. Latches off once the
  //    toast has fired or been dismissed - one nudge is enough, and
  //    the endpoint stops being polled.
  useEffect(() => {
    let cancelled = false;
    let lastCheck = 0;
    async function checkVersion() {
      if (cancelled || settledRef.current) return;
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      // Focus events arrive in bursts; don't hammer the endpoint.
      if (now - lastCheck < 30_000) return;
      lastCheck = now;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { sha?: string };
        if (cancelled) return;
        if (j.sha && j.sha !== initialShaRef.current) {
          settledRef.current = true;
          setUpdateAvailable(true);
        }
      } catch {
        /* network blip - try again next tick */
      }
    }
    // On mount, once the first paint has settled. This is what catches a
    // document that was already stale when it arrived.
    const first = setTimeout(checkVersion, 2_000);
    const t = setInterval(checkVersion, 90_000);
    function onVisible() {
      if (document.visibilityState === 'visible') checkVersion();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', checkVersion);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkVersion);
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
          onClick={() => {
            settledRef.current = true;
            setUpdateAvailable(false);
          }}
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
