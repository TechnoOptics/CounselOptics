'use client';

import { useState } from 'react';
import { TIER_FEATURES, TIER_LABEL, type Tier } from '@/lib/types';
import { useIsNativeApp } from '@/components/useIsNativeApp';
import { tierHasIosProduct } from '@/lib/iap';
import { createBrowserSupabase } from '@/lib/supabase/client';

const TIER_TAGLINE: Record<Tier, string> = {
  basic: 'Get organized.',
  standard: 'Add Advottic Review.',
  pro: 'Go unlimited with collaboration.',
};

type Bullet = { label: string };

/**
 * Bullets per tier - INCLUDED features ONLY. Previously the card
 * listed every feature on every tier with a strikethrough for those
 * not included; review feedback (2026-05-11) showed users were
 * reading the strikethrough labels as "included" and the strike as
 * decorative. Solution: list only what the tier actually unlocks,
 * then state in plain text below the list which features require
 * upgrading.
 *
 * The "Public defender directory" used to appear on every tier as a
 * strikethrough line. It is no longer paywalled (per the marketing
 * promise on /) and is free across every tier and the public site,
 * so we no longer list it here at all - it would be confusing to
 * show as a "feature" of paid plans when even free / Public defender
 * works without a subscription.
 */
function bulletsForTier(tier: Tier): Bullet[] {
  const f = TIER_FEATURES[tier];
  const bullets: Bullet[] = [
    {
      label:
        f.caseLimit === null
          ? 'Unlimited cases'
          : `Up to ${f.caseLimit} case${f.caseLimit === 1 ? '' : 's'}`,
    },
    { label: 'Exhibits with category, source, incident date' },
  ];
  if (f.pdfExport) bullets.push({ label: 'PDF case packet export' });
  if (f.bella) bullets.push({ label: 'Bella, your on-demand assistant' });
  if (f.aiReview) bullets.push({ label: 'Advottic Review on every case' });
  if (f.collaborators)
    bullets.push({ label: 'Invite collaborators (attorney sharing)' });
  if (f.eFilingDirectory) bullets.push({ label: 'Court e-filing directory' });
  if (f.proTokens)
    bullets.push({ label: 'Generous monthly Bella + Review tokens, with top-ups' });
  return bullets;
}

/**
 * Plain-text "and what you don't get" footnote for non-top tiers, so
 * a user shopping the cards understands what stays on the table.
 */
function omittedNote(tier: Tier): string | null {
  if (tier === 'basic') {
    return 'Doesn\'t include Bella or Advottic Review. Add Standard for AI-assisted review, or Pro for unlimited cases + collaboration + monthly tokens.';
  }
  if (tier === 'standard') {
    return 'Doesn\'t include unlimited cases, collaborator sharing, court e-filing directory, or the monthly Bella + Review token grant. Add Pro for those.';
  }
  return null;
}

export function TierCard({
  tier,
  currentTier,
  isActive,
  stripeReady,
}: {
  tier: Tier;
  currentTier: Tier | null;
  isActive: boolean;
  stripeReady: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = TIER_FEATURES[tier];
  const bullets = bulletsForTier(tier);
  const isCurrent = isActive && currentTier === tier;
  const isHighlighted = tier === 'standard';

  // Inside the iOS app, paid plans must be sold through Apple In-App
  // Purchase (Guideline 3.1.1), not Stripe. `useIap` is true only for
  // paid tiers that have an App Store product; the free `basic` tier
  // has none, so its button is simply hidden on iOS.
  const { ready, platform } = useIsNativeApp();
  const useIap = ready && platform === 'ios' && tierHasIosProduct(tier);
  const hideButtonOnIos =
    ready && platform === 'ios' && !tierHasIosProduct(tier);

  async function startIapPurchase() {
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) throw new Error('Please sign in before subscribing.');
      const { purchaseTier } = await import('@/lib/iap');
      const res = await purchaseTier(tier, userId);
      if (res.cancelled) {
        setPending(false);
        return;
      }
      // Record the entitlement server-side (authoritative read from
      // RevenueCat), then reflect the unlocked plan.
      await fetch('/api/iap/sync', { method: 'POST' }).catch(() => {});
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not complete the purchase.',
      );
      setPending(false);
    }
  }

  async function startCheckout() {
    if (!stripeReady) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(false);
    }
  }

  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col transition-all duration-300 hover:-translate-y-0.5 ${
        isHighlighted
          ? 'border-gold-500 shadow-card-hover bg-cream-50/40 animate-glow'
          : 'border-ink-200 bg-white shadow-card hover:border-gold-500/50 hover:shadow-card-hover'
      }`}
    >
      {isHighlighted && (
        <span className="absolute -top-2.5 left-6 badge bg-gold-metal text-forest-950 font-semibold tracking-wide shadow-sm">
          Most popular
        </span>
      )}
      <div className="mb-5">
        <p className="eyebrow mb-1">{TIER_LABEL[tier]}</p>
        <h3 className="font-display text-[26px] font-medium tracking-[-0.01em] leading-[1.1] text-forest-900">
          {TIER_TAGLINE[tier]}
        </h3>
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-ink-950 tabular-nums">${f.monthlyPriceUsd}</span>
          <span className="text-sm text-ink-500">/ month</span>
        </p>
      </div>

      <ul className="space-y-2 mb-4 text-sm flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className="mt-0.5 h-4 w-4 rounded-full flex-none flex items-center justify-center bg-forest-900 text-cream-200"
              aria-hidden
            >
              <CheckIcon />
            </span>
            <span className="text-ink-800">{b.label}</span>
          </li>
        ))}
      </ul>

      {omittedNote(tier) && (
        <p className="text-[12px] text-ink-500 leading-relaxed mb-5">
          {omittedNote(tier)}
        </p>
      )}

      {isCurrent ? (
        // Use a brand-tinted treatment instead of btn-secondary, which
        // sits flat on the dark forest theme and gets lost. The gold
        // border + cream label reads as "active" in both modes.
        <button
          type="button"
          disabled
          className="w-full rounded-lg border border-gold-500 bg-gold-500/15 dark:bg-gold-500/20 text-forest-900 dark:text-cream-100 font-semibold py-2.5 px-4 cursor-default flex items-center justify-center gap-2"
          aria-label="Current plan"
        >
          <CheckIcon />
          Your current plan
        </button>
      ) : hideButtonOnIos ? null : (
        <button
          type="button"
          onClick={useIap ? startIapPurchase : startCheckout}
          disabled={useIap ? pending : !stripeReady || pending}
          className={
            isHighlighted
              ? 'btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold w-full'
              : 'btn bg-forest-900 hover:bg-forest-800 dark:bg-gold-metal dark:hover:brightness-110 shadow-brand-glow font-semibold w-full text-cream-50 dark:text-forest-950'
          }
          // Hard-coded inline color as a final guarantee against any CSS
          // precedence quirks. Matches the Tailwind classes above; if a
          // future global rule tries to overwrite the button text color,
          // this inline rule still wins.
          style={
            isHighlighted
              ? undefined
              : { color: 'var(--btn-primary-fg, #fbf7e9)' }
          }
        >
          {pending
            ? useIap
              ? 'Opening App Store...'
              : 'Opening Stripe...'
            : isActive
              ? `Switch to ${TIER_LABEL[tier]}`
              : `Start ${TIER_LABEL[tier]}`}
        </button>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
