'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDateShort } from '@/lib/format';

type Mode = 'stripe_trialing' | 'free_trial' | 'expired';

/**
 * Soft-glowing reminder strip surfacing the user's trial / lapsed
 * status. Pulses on for ~10s, hides for 6min, repeats - frequent
 * enough to remind, not so frequent it nags. Manual dismiss kills
 * it for the rest of the session.
 *
 * Three modes:
 *   - stripe_trialing : 7-day Stripe trial after they hit Subscribe
 *   - free_trial      : first 7 days from email's first_signup_at
 *                       (anchored in signup_history so a delete +
 *                       re-signup with the same email cannot reset)
 *   - expired         : free trial up + no active subscription
 *                       (rose-ringed, no auto-hide)
 */
// Audit V7 CR-60: 24-hour postpone storage. Holds the wall-clock
// timestamp (ms since epoch) that the trial reminder should next
// surface. Stored in localStorage so the postpone survives page
// reloads but not browser-data clears. Per-account scoping is
// unnecessary because every signed-in profile produces its own
// `TrialBanner` mount; the storage key is shared across sessions
// for the same browser profile.
const POSTPONE_STORAGE_KEY = 'advottic-trial-banner-postpone-until';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function TrialBanner({
  mode,
  trialEndsAt,
  daysRemaining,
  tier,
}: {
  mode: Mode;
  trialEndsAt: string | null;
  daysRemaining: number;
  tier: string | null;
}) {
  const [visible, setVisible] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  // Audit V7 CR-60: honor a localStorage-backed postpone so a user
  // who explicitly says "remind me later" actually gets 24 hours of
  // peace, not just dismissal until next reload.
  const [postponedUntil, setPostponedUntil] = useState<number | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POSTPONE_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > Date.now()) {
        setPostponedUntil(n);
      } else if (raw) {
        // Stale postpone window - clear so we don't re-check it.
        localStorage.removeItem(POSTPONE_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (dismissedThisSession || mode === 'expired' || postponedUntil !== null) return;
    // Reduced-motion users get a static, always-visible reminder
    // instead of the pulse-on / pulse-off cycle. Still dismissable.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setVisible(true);
    if (reduceMotion) return;
    const hide = setTimeout(() => setVisible(false), 10_000);
    const cycle = setInterval(() => {
      setVisible((v) => !v);
      if (!visible) {
        setTimeout(() => setVisible(false), 10_000);
      }
    }, 360_000);
    return () => {
      clearTimeout(hide);
      clearInterval(cycle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissedThisSession, mode, postponedUntil]);

  if (dismissedThisSession) return null;
  if (postponedUntil !== null) return null;

  // Audit V7 CR-60: derive the trial start date so the toast tells
  // the user how long they've been in the trial, not just how long
  // they have left. trialEndsAt comes from the server as ISO; the
  // free / Stripe trial windows are both 7 days, so subtracting
  // (7 - daysRemaining) days lands on the start. We render the
  // date in the viewer's locale via toLocaleDateString to keep the
  // copy human; falling back to a plain "Day N of 7" framing when
  // trialEndsAt is missing.
  const trialDayOfSeven = Math.max(1, Math.min(7, 7 - daysRemaining + 1));
  const startedLabel = (() => {
    if (!trialEndsAt) return `Day ${trialDayOfSeven} of 7`;
    try {
      const startMs = new Date(trialEndsAt).getTime() - 7 * ONE_DAY_MS;
      const startDate = new Date(startMs);
      return `In trial since ${formatDateShort(startDate)}`;
    } catch {
      return `Day ${trialDayOfSeven} of 7`;
    }
  })();

  function postponeForOneDay() {
    const until = Date.now() + ONE_DAY_MS;
    try {
      localStorage.setItem(POSTPONE_STORAGE_KEY, String(until));
    } catch {
      /* ignore */
    }
    setPostponedUntil(until);
  }

  const isExpired = mode === 'expired';

  if (isExpired) {
    return (
      // Reader model: the banner itself may show on iOS, but the Subscribe
      // CTA and tier name are hidden there (data-hide-on-ios) - the app sells
      // nothing and names no purchasable tiers (Guidelines 2.1(b)/3.1.1).
      <div className="fixed left-[calc(0.75rem+var(--safe-left))] right-[calc(0.75rem+var(--safe-right))] sm:left-auto sm:right-[calc(1.5rem+var(--safe-right))] bottom-[calc(5rem+var(--safe-bottom))] sm:bottom-[calc(6rem+var(--safe-bottom))] sm:max-w-md z-[55]">
        <div
          role="status"
          className="trial-banner-glow rounded-xl bg-forest-950 text-cream-100 ring-1 ring-rose-300/40 shadow-card-hover px-4 py-3 flex items-center gap-3 backdrop-blur"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-rose-400 animate-pulse flex-none" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold leading-tight">
              Your free trial has ended
            </p>
            <p className="text-[11.5px] text-cream-100/75 leading-snug">
              You can still view your cases and look up counsel. Subscribe to keep using Bella, Advottic Review, and create new cases.
            </p>
          </div>
          <Link
            href="/billing"
            data-hide-on-ios
            className="flex-none rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110"
          >
            Subscribe
          </Link>
        </div>
      </div>
    );
  }

  // Trialing (Stripe or free) - pulsing reminder.
  return (
    <div
      className={`fixed left-[calc(0.75rem+var(--safe-left))] right-[calc(0.75rem+var(--safe-right))] sm:left-auto sm:right-[calc(1.5rem+var(--safe-right))] bottom-[calc(5rem+var(--safe-bottom))] sm:bottom-[calc(6rem+var(--safe-bottom))] sm:max-w-md z-[55] transition-all duration-500 ease-out ${
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
    >
      <div
        role="status"
        aria-live="polite"
        className="trial-banner-glow rounded-xl bg-forest-950 text-cream-100 ring-1 ring-gold-300/40 shadow-card-hover px-4 py-3 flex items-center gap-3 backdrop-blur"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold leading-tight">
            {daysRemaining <= 1
              ? 'Last day of your free trial'
              : `${daysRemaining} days left on your free trial`}
            {tier ? <span data-hide-on-ios>{` · ${tier[0].toUpperCase()}${tier.slice(1)}`}</span> : null}
          </p>
          <p className="text-[11.5px] text-cream-100/70 leading-snug">
            {mode === 'free_trial'
              ? 'Subscribe before it ends to keep Bella, Advottic Review, and case creation.'
              : 'Subscribe before the trial ends to keep your access.'}
          </p>
          {/*
            Audit V7 CR-60: "in-trial since" sub-line + 24h postpone.
            Tells the user how long they've been in the trial, which
            anchors the "X days left" framing above with a concrete
            start date.
          */}
          <p className="text-[10.5px] text-cream-100/55 leading-snug mt-0.5">
            {startedLabel}
          </p>
        </div>
        <div className="flex-none flex flex-col items-end gap-1">
          <Link
            href="/billing"
            data-hide-on-ios
            className="rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110"
          >
            Subscribe
          </Link>
          <button
            type="button"
            onClick={postponeForOneDay}
            className="text-[10.5px] text-cream-100/55 hover:text-cream-100/85 underline underline-offset-2"
          >
            Remind me tomorrow
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDismissedThisSession(true)}
          aria-label="Dismiss trial reminder"
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
