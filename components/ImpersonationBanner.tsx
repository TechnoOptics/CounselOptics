'use client';

import { useEffect, useState } from 'react';

const FLAG_KEY = 'adv_impersonating';

/**
 * Sticky top banner that warns the operator they are signed in as
 * someone else via the HQ admin "Sign in as user" flow.
 *
 * How it sticks:
 *   1. The magic-link callback returns the user to
 *      /cases?impersonating=1 (see /api/admin/impersonate).
 *   2. On first render with that query string present, we write
 *      sessionStorage[adv_impersonating] = '1' and strip the URL
 *      param via history.replaceState so the user's address bar
 *      doesn't show it.
 *   3. Every subsequent render in this tab reads sessionStorage.
 *      sessionStorage is scoped to the tab, so closing the tab
 *      ends the impersonation signal without affecting other
 *      sessions.
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Detect the initial signal from the URL and persist it for
      // the lifetime of the tab.
      const url = new URL(window.location.href);
      const hasParam = url.searchParams.get('impersonating') === '1';
      if (hasParam) {
        sessionStorage.setItem(FLAG_KEY, '1');
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

  async function end() {
    try {
      sessionStorage.removeItem(FLAG_KEY);
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
        <button
          type="button"
          onClick={end}
          className="rounded-md bg-white/15 hover:bg-white/25 px-3 py-1.5 text-[12px] font-semibold ring-1 ring-white/30"
        >
          End impersonation &amp; close
        </button>
      </div>
    </div>
  );
}
