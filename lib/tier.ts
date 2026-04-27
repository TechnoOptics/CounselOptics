import { TIER_FEATURES, type Subscription, type Tier, type TierFeatures } from './types';
import type { EffectiveTrialState } from './storage';

/**
 * Returns the "active" tier for a user, or null if they have no current
 * subscription. We treat 'active' and 'trialing' as live; anything else is
 * effectively no access.
 */
export function activeTier(sub: Subscription | null | undefined): Tier | null {
  if (!sub) return null;
  if (sub.status !== 'active' && sub.status !== 'trialing') return null;
  return sub.tier ?? null;
}

/** Convenience: feature record for a subscription, or null if locked. */
export function activeFeatures(
  sub: Subscription | null | undefined,
): TierFeatures | null {
  const t = activeTier(sub);
  return t ? TIER_FEATURES[t] : null;
}

/** True when the subscription's tier (or higher) grants this feature. */
export function hasFeature(
  sub: Subscription | null | undefined,
  feature: keyof Omit<TierFeatures, 'caseLimit' | 'monthlyPriceUsd'>,
): boolean {
  const f = activeFeatures(sub);
  return Boolean(f?.[feature]);
}

/** null = unlimited. */
export function caseLimit(sub: Subscription | null | undefined): number | null {
  const f = activeFeatures(sub);
  return f ? f.caseLimit : 0; // no sub means 0 cases allowed
}

/**
 * True when the user is inside an active trial window of any kind -
 * either the email-anchored 7-day free trial that fires on first
 * sign-up, or a Stripe-subscription trial regardless of which tier
 * they picked. While inside the trial we unlock every feature
 * (Pro-equivalent access) so people can test-drive the whole product.
 */
export function isFullAccessTrial(state: EffectiveTrialState): boolean {
  return state.mode === 'free_trial' || state.mode === 'stripe_trialing';
}
