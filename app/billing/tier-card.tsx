'use client';

import { useState } from 'react';
import { TIER_FEATURES, TIER_LABEL, type Tier } from '@/lib/types';
import { useIsNativeApp } from '@/components/useIsNativeApp';
import type { NativePlatform } from '@/lib/platform';

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
  serverPlatform,
}: {
  tier: Tier;
  currentTier: Tier | null;
  isActive: boolean;
  stripeReady: boolean;
  /**
   * Server-rendered, UA-derived platform (see nativePlatformFromUserAgent
   * in lib/platform.ts) - the AUTHORITATIVE signal for whether this is
   * the iOS app, correct on the very first paint.
   *
   * Root cause of the 5th App Store rejection (2.1(b), 2026-07-02):
   * this component previously decided IAP-vs-Stripe SOLELY from
   * useIsNativeApp(), which resolves `window.Capacitor` in a client
   * useEffect that runs once with no retry. On the remote-URL WebView
   * that check can run before the native bridge finishes injecting -
   * the EXACT race already diagnosed and fixed server-side for the
   * 2.3.10 Google-Play-badge rejection (see app/layout.tsx), but never
   * applied here. When it loses the race, `platform` resolves to 'web'
   * for a real iOS session, so the Subscribe button silently wires
   * itself to startCheckout() (Stripe) instead of startIapPurchase()
   * (Apple IAP) - explaining both "tapped Subscribe, it just hangs"
   * (a Stripe checkout call/redirect inside a review sandbox that
   * doesn't behave like production) AND RevenueCat showing zero SDK
   * connections ever (configure() is never even called in that path).
   */
  serverPlatform: NativePlatform;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = TIER_FEATURES[tier];
  const bullets = bulletsForTier(tier);
  const isCurrent = isActive && currentTier === tier;
  const isHighlighted = tier === 'standard';

  // Advottic uses the "reader" model on iOS: the app does NOT sell
  // subscriptions in-app. Plans are purchased on the web (advottic.com via
  // Stripe) and the iOS app simply unlocks based on the signed-in account's
  // entitlement. This removes Apple IAP entirely, sidestepping the StoreKit
  // issues that blocked review AND Apple's 30% cut. On iOS we show an
  // informational note in place of a buy button; web/Android use Stripe.
  //
  // isIOS is server-authoritative OR client-confirmed (see serverPlatform) so
  // a racy client read can never wrongly show a buy button to a real iOS user.
  const { ready, platform } = useIsNativeApp();
  const isIOS = serverPlatform === 'ios' || (ready && platform === 'ios');
  const isPaidTier = f.monthlyPriceUsd > 0;

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
      // Diagnostic tag: if this path's prefix is what shows up in the
      // Simulator instead of startIapPurchase's [card:...] tag, it
      // proves the button never called the IAP path at all - isIOS
      // resolved false, meaning the server-authoritative UA detection
      // (or the client fallback) isn't engaging in this build.
      const message = err instanceof Error ? err.message : 'Could not start checkout.';
      setError(`[stripeCheckout] ${message}`);
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
        {/* The price sat above the isIOS branch and so rendered inside the
            iOS app regardless of it. Guideline 3.1.1: no prices in the app.
            Gated twice - the server/client-confirmed isIOS check, plus the
            data-hide-on-ios CSS backstop for a session where neither signal
            resolved. */}
        {!isIOS && (
          <p data-hide-on-ios className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-ink-950 tabular-nums">${f.monthlyPriceUsd}</span>
            <span className="text-sm text-ink-500">/ month</span>
          </p>
        )}
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
      ) : isIOS ? (
        // App Store Guideline 3.1.1 / 3.1.3(c) Enterprise Services: no purchase control and no
        // call to action to purchase outside the app. Naming where to buy
        // is itself a call to action, so this is a bare statement of fact
        // about how access works and nothing more.
        isPaidTier ? (
          <p className="rounded-lg border border-forest-900/15 bg-forest-900/[0.03] px-3.5 py-3 text-[12.5px] leading-snug text-ink-700 dark:border-cream-50/15 dark:bg-cream-50/[0.04] dark:text-cream-200/90">
            Your access unlocks here automatically when your account is subscribed.
          </p>
        ) : null
      ) : (
        <button
          type="button"
          onClick={startCheckout}
          disabled={!stripeReady || pending}
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
            ? 'Opening Stripe...'
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
