'use client';

import { useState } from 'react';

/**
 * Sticky top banner shown while an HQ admin is viewing the app AS another user
 * via the "act as" overlay (see lib/act-as.ts + /api/admin/impersonate).
 *
 * Unlike the old magic-link impersonation, the admin's OWN session is never
 * touched: the overlay lives in a separate `adv_act_as` cookie. So `active` is
 * driven from the SERVER (the layout passes `readActAs() !== null`), and
 * "End impersonation" simply deletes that cookie: the admin is instantly back as
 * themselves, with no sign-out and no effect on any other tab or user.
 *
 * The overlay's target access token expires after ~1 hour; once it does the
 * server stops honouring the overlay and this banner disappears on the next
 * navigation, so there's no client-side hard-expiry clock to maintain.
 */
export function ImpersonationBanner({
  targetEmail,
  active,
}: {
  targetEmail: string | null;
  /** Server-resolved: true when an act-as overlay is active for this request. */
  active?: boolean;
}) {
  const [ending, setEnding] = useState(false);

  async function end() {
    if (ending) return;
    setEnding(true);
    try {
      await fetch('/api/admin/impersonate/stop', { method: 'POST' });
    } catch {
      /* even if the POST fails we still navigate; the cookie clear is idempotent */
    }
    // Full navigation so every server component re-renders as the real admin.
    window.location.assign('/admin/users');
  }

  if (!active) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] bg-rose-700 text-white shadow-lg ring-1 ring-rose-900/40"
    >
      <div
        className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-[13px]"
        style={{ paddingTop: 'calc(0.5rem + var(--safe-top))' }}
      >
        <p className="leading-snug">
          <strong className="font-semibold">Viewing as another user.</strong>{' '}
          {targetEmail ? (
            <>
              You are seeing Advottic as{' '}
              <span className="font-mono">{targetEmail}</span>.
            </>
          ) : (
            <>You are viewing the app as another user.</>
          )}{' '}
          <span className="opacity-90">
            Your admin account is untouched. Anything you do here is attributed
            to them. End when you&rsquo;re finished.
          </span>
        </p>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="shrink-0 rounded-md bg-white/15 hover:bg-white/25 px-3 py-1.5 text-[12px] font-semibold ring-1 ring-white/30 disabled:opacity-60"
        >
          {ending ? 'Ending…' : 'End & return to HQ'}
        </button>
      </div>
    </div>
  );
}
