'use client';

import { useEffect, useRef, useState } from 'react';

const FLAG_KEY = 'adv_impersonating';
const START_KEY = 'adv_impersonating_start';
// Audit 2026-05-12 P1-4: hard cap on the impersonation session.
// 60 minutes aligns with the magic-link expiry Supabase already
// imposes on the entry credential; this is the post-click ceiling.
const HARD_EXPIRY_MS = 60 * 60 * 1000;
// How often the timer ticks. Per-second so the countdown reads as
// a real clock without spending compute.
const TICK_MS = 1000;

/**
 * Sticky top banner that warns the operator they are signed in as
 * someone else via the HQ admin "Sign in as user" flow.
 *
 * How it sticks:
 *   1. The magic-link callback returns the user to
 *      /cases?impersonating=1 (see /api/admin/impersonate).
 *   2. On first render with that query string present, we write
 *      sessionStorage[adv_impersonating] = '1' AND the start
 *      timestamp, then strip the URL param via history.replaceState.
 *   3. Every subsequent render in this tab reads sessionStorage.
 *      sessionStorage is scoped to the tab, so closing the tab
 *      ends the impersonation signal without affecting other
 *      sessions.
 *   4. A 1-second ticker computes remaining time against the start
 *      stamp and forces a sign-out when the 60-minute cap is hit.
 *      Audit P1-4: prevents an admin who forgot to End from leaving
 *      the impersonated session open indefinitely.
 *
 * The "End session" button signs the impersonated session out and
 * closes the tab. The admin's original session lives in a separate
 * tab and is untouched.
 *
 * Why visible-by-default:
 *   - An admin who forgets they're impersonating can accidentally
 *     create or edit records as the target user. The banner is
 *     intentionally loud to make that mistake nearly impossible.
 *   - Rendering on every page (not just /cases) protects against
 *     deep-link navigation that bypasses the initial landing.
 *
 * Server side has the audit log; this is the UX side.
 */
export function ImpersonationBanner({
  targetEmail,
}: {
  targetEmail: string | null;
}) {
  const [active, setActive] = useState(false);
  // Remaining ms before the hard expiry. -1 means "not yet armed".
  const [remainingMs, setRemainingMs] = useState<number>(-1);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Detect the initial signal from the URL and persist it for
      // the lifetime of the tab. Record the start time too so the
      // hard-expiry clock has a stable anchor.
      const url = new URL(window.location.href);
      const hasParam = url.searchParams.get('impersonating') === '1';
      if (hasParam) {
        sessionStorage.setItem(FLAG_KEY, '1');
        if (!sessionStorage.getItem(START_KEY)) {
          sessionStorage.setItem(START_KEY, String(Date.now()));
        }
        url.searchParams.delete('impersonating');
        const rest = url.search ? `?${url.searchParams.toString()}` : '';
        window.history.replaceState({}, '', url.pathname + rest + url.hash);
      }
      setActive(sessionStorage.getItem(FLAG_KEY) === '1');
    } catch {
      // sessionStorage can throw in iframes / private mode. If the
      // banner is unreliable here we err on the side of not showing
      // it rather than spamming the page.
    }
  }, []);

  // Hard-expiry ticker. Runs only while `active` so logged-out tabs
  // (or non-impersonation sessions) don't pay any cost. When the
  // 60-minute cap hits, we call end() exactly once - expiredRef
  // gates against re-entry from the per-second tick.
  useEffect(() => {
    if (!active) return;
    let start: number;
    try {
      const raw = sessionStorage.getItem(START_KEY);
      start = raw ? parseInt(raw, 10) : Date.now();
      if (!Number.isFinite(start)) start = Date.now();
    } catch {
      start = Date.now();
    }
    const compute = () => {
      const remaining = HARD_EXPIRY_MS - (Date.now() - start);
      setRemainingMs(remaining);
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        // Force-end the session. Same flow as the manual button.
        end();
      }
    };
    compute();
    const id = setInterval(compute, TICK_MS);
    return () => clearInterval(id);
    // We deliberately depend only on `active` - the ticker should not
    // restart when remainingMs changes (which it does every tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function end() {
    try {
      sessionStorage.removeItem(FLAG_KEY);
      sessionStorage.removeItem(START_KEY);
    } catch {}
    // Sign the impersonated session out, then close the tab. Use
    // a synchronous form POST to /auth/sign-out so the cookie clear
    // happens before the window close attempt.
    try {
      await fetch('/auth/sign-out', { method: 'POST' });
    } catch {}
    // window.close() only works when the window was opened by
    // another tab (which the impersonated tab was via window.open).
    // Fall back to navigating to /sign-in if close is blocked.
    try {
      window.close();
    } catch {}
    setTimeout(() => {
      window.location.replace('/sign-in?next=/admin/users');
    }, 250);
  }

  if (!active) return null;
  // Render the remaining-time clock as MM:SS once the ticker has
  // computed a real number. Before that, we show nothing rather than
  // a flicker. When the timer crosses 5 minutes left, the chip turns
  // amber as a final visual nudge.
  const showClock = remainingMs >= 0;
  const totalSeconds = showClock ? Math.max(0, Math.floor(remainingMs / 1000)) : 0;
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const urgent = showClock && remainingMs < 5 * 60 * 1000;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] bg-rose-700 text-white shadow-lg ring-1 ring-rose-900/40"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <p className="leading-snug">
          <strong className="font-semibold">Impersonating user.</strong>{' '}
          {targetEmail ? (
            <>
              Signed in as <span className="font-mono">{targetEmail}</span>.
            </>
          ) : (
            <>You are signed in as another user.</>
          )}{' '}
          <span className="opacity-90">
            Anything you do here will be attributed to them. End the session
            when you&rsquo;re finished.
          </span>
        </p>
        <div className="flex items-center gap-2">
          {showClock && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono tabular-nums ring-1 ${
                urgent
                  ? 'bg-amber-300/95 text-rose-900 ring-amber-200'
                  : 'bg-white/15 text-white ring-white/30'
              }`}
              title="Hard expiry on this impersonation session. Auto-ends at zero."
            >
              <span aria-hidden>⏱</span>
              <span>{mm}:{ss}</span>
            </span>
          )}
          <button
            type="button"
            onClick={end}
            className="rounded-md bg-white/15 hover:bg-white/25 px-3 py-1.5 text-[12px] font-semibold ring-1 ring-white/30"
          >
            End impersonation &amp; close
          </button>
        </div>
      </div>
    </div>
  );
}
