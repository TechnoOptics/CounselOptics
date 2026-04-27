'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Soft-glowing reminder strip that surfaces while a user is on their
 * 7-day Stripe trial. It fades in on mount, lingers for ~10 seconds,
 * then fades out and reappears every ~6 minutes — frequent enough to
 * remind, not so frequent it nags. Manual dismiss puts it away for
 * the rest of the session.
 *
 * Mounted once in the root layout; visible for any signed-in user
 * whose subscription status is `trialing`. After the trial flips to
 * `past_due` / `canceled` (or expires without a card on file), a
 * different "trial ended" banner takes over.
 */
export function TrialBanner({
  status,
  trialEndsAt,
  tier,
}: {
  status: 'trialing' | 'past_due' | 'inactive' | 'canceled' | 'unpaid';
  trialEndsAt: string | null;
  tier: string | null;
}) {
  const [visible, setVisible] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  // Pulse cycle: show 10s, hide 6min, repeat. Manual dismiss kills it.
  useEffect(() => {
    if (dismissedThisSession) return;
    setVisible(true);
    const hide = setTimeout(() => setVisible(false), 10_000);
    const cycle = setInterval(() => {
      setVisible((v) => !v);
      if (!visible) {
        // schedule auto-hide 10s after the show
        setTimeout(() => setVisible(false), 10_000);
      }
    }, 360_000);
    return () => {
      clearTimeout(hide);
      clearInterval(cycle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissedThisSession]);

  if (dismissedThisSession) return null;

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000))
    : null;

  const isTrial = status === 'trialing';
  const isExpired =
    status === 'past_due' || status === 'canceled' || status === 'unpaid';

  // Trial ended (no active subscription) — different copy + always visible.
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
              Your trial has ended
            </p>
            <p className="text-[11.5px] text-cream-100/75 leading-snug">
              You can still view your cases and find counsel. Subscribe to keep using Bella, Legal Eye, and create new cases.
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

  if (!isTrial) return null;

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
            {daysLeft !== null
              ? daysLeft <= 1
                ? 'Last day of your free trial'
                : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left on your free trial`
              : "You're on a 7-day free trial"}
            {tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)}` : ''}
          </p>
          <p className="text-[11.5px] text-cream-100/70 leading-snug">
            Subscribe before it ends to keep Bella, Legal Eye, and case creation.
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
