import { TIER_FEATURES, type Subscription, type Tier, type TierFeatures } from './types';
import type { EffectiveTrialState } from './storage';
import { resolvePriceEntitlement } from './entitlements';
import { personalTierForSlug, COMP_ULTRA_PRICE_ID, type PersonalTier } from './personal-tiers';

/**
 * The active personal-ladder rung for a subscription, or null when the sub is
 * inactive / legacy / firm. The 5-rung consumer ladder needs finer gating than
 * the 3-value coarse Tier can express (five case caps, Bella at rung 3), so
 * caseLimit()/hasFeature() consult this per-rung config first. Legacy
 * (basic/standard) and firm slugs return null and fall back to TIER_FEATURES.
 */
function activePersonalTier(sub: Subscription | null | undefined): PersonalTier | null {
  if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) return null;
  const slug = resolvePriceEntitlement(sub.priceId).tierSlug;
  return personalTierForSlug(slug);
}

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
  // Personal ladder gates by rung (e.g. Bella only from Plus up), overriding
  // the coarse Tier which would over-grant (Plus maps to coarse 'pro').
  const pt = activePersonalTier(sub);
  if (pt) {
    switch (feature) {
      case 'bella': return pt.bella;
      case 'aiReview': return pt.aiReview;
      case 'collaborators': return pt.collaborators;
      case 'proTokens': return pt.priceUsd > 0;
      case 'pdfExport':
      case 'eFilingDirectory':
      case 'publicDefenderDirectory': return true;
    }
  }
  const f = activeFeatures(sub);
  return Boolean(f?.[feature]);
}

/** null = unlimited. */
export function caseLimit(sub: Subscription | null | undefined): number | null {
  // Lifetime comp (founder/owner/QA): Ultra features but uncapped cases.
  if (sub?.priceId === COMP_ULTRA_PRICE_ID) return null;
  const pt = activePersonalTier(sub);
  if (pt) return pt.caseLimit;
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
