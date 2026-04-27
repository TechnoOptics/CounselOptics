'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    if (dismissedThisSession || mode === 'expired') return;
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
  }, [dismissedThisSession, mode]);

  if (dismissedThisSession) return null;

  const isExpired = mode === 'expired';

  if (isExpired) {
    return (
      <div className="fixed left-3 right-3 sm:left-auto sm:right-6 bottom-3 sm:bottom-6 sm:max-w-md z-[55]">
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
      className={`fixed left-3 right-3 sm:left-auto sm:right-6 bottom-3 sm:bottom-6 sm:max-w-md z-[55] transition-all duration-500 ease-out ${
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
            {tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)}` : ''}
          </p>
          <p className="text-[11.5px] text-cream-100/70 leading-snug">
            {mode === 'free_trial'
              ? 'Subscribe before it ends to keep Bella, Advottic Review, and case creation.'
              : 'Subscribe before the trial ends to keep your access.'}
          </p>
        </div>
        <Link
          href="/billing"
          className="flex-none rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110"
        >
          Subscribe
        </Link>
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
