import { TIER_FEATURES, type Subscription, type Tier, type TierFeatures } from './types';
import type { EffectiveTrialState } from './storage';
import { personalTierForSlug, COMP_ULTRA_PRICE_ID, type PersonalTier } from './personal-tiers';
import {
  applyTrialToUnpaid,
  paidFromSubscription,
  resolveAccountEntitlement,
  type TrialGrant,
} from './trial-entitlement';

/**
 * An HQ-granted trial, which every gate below now takes as an OPTIONAL second
 * input. Omitting it is exactly the behaviour these functions had before the
 * trial existed, which is what makes threading it through one call site at a
 * time safe.
 *
 * A trial can only ever LIFT an account that is not paying.
 * lib/trial-entitlement.ts holds that rule structurally, and nothing in this
 * file re-decides it: a payer's answer below is still read from their own
 * subscription row and never from a trial.
 */
const NO_TRIAL: TrialGrant = { trialTierSlug: null, trialEndsAt: null };

/** The billing artifact the resolver reads, from this file's Subscription. */
function paidState(sub: Subscription | null | undefined) {
  return paidFromSubscription(
    sub ? { status: sub.status, priceId: sub.priceId ?? null } : null,
  );
}

/**
 * The active personal-ladder rung for a subscription, or null when the sub is
 * inactive / legacy / firm. The 5-rung consumer ladder needs finer gating than
 * the 3-value coarse Tier can express (five case caps, Bella at rung 3), so
 * caseLimit()/hasFeature() consult this per-rung config first. Legacy
 * (basic/standard) and firm slugs return null and fall back to TIER_FEATURES.
 */
function activePersonalTier(
  sub: Subscription | null | undefined,
  trial: TrialGrant = NO_TRIAL,
): PersonalTier | null {
  // With no trial this is exactly what it was: live subscription, price
  // resolved through lib/entitlements.ts, rung looked up from the slug. The
  // resolver returns that same slug for a payer, and returns the trial's slug
  // only for an account that is not paying.
  const resolved = resolveAccountEntitlement(paidState(sub), trial, new Date());
  return personalTierForSlug(resolved.tierSlug);
}

/**
 * Returns the "active" tier for a user, or null if they have no current
 * subscription. We treat 'active' and 'trialing' as live; anything else is
 * effectively no access.
 */
export function activeTier(
  sub: Subscription | null | undefined,
  trial: TrialGrant = NO_TRIAL,
): Tier | null {
  const paid = paidState(sub);
  // A PAYER'S COARSE TIER IS STILL READ FROM THEIR OWN ROW, not re-derived
  // from the price. subscriptions.tier is what the webhook wrote, and
  // switching this to the price-derived tier would be a silent change to
  // every existing account's entitlement rather than a trial feature.
  if (paid.kind === 'paid') return sub?.tier ?? null;
  // Not paying, so the trial is allowed to speak. `paid` is narrowed to the
  // unpaid member here, which is the only thing applyTrialToUnpaid accepts.
  return applyTrialToUnpaid(paid, trial, new Date()).tier;
}

/** Convenience: feature record for a subscription, or null if locked. */
export function activeFeatures(
  sub: Subscription | null | undefined,
  trial: TrialGrant = NO_TRIAL,
): TierFeatures | null {
  const t = activeTier(sub, trial);
  return t ? TIER_FEATURES[t] : null;
}

/** True when the subscription's tier (or higher) grants this feature. */
export function hasFeature(
  sub: Subscription | null | undefined,
  feature: keyof Omit<TierFeatures, 'caseLimit' | 'monthlyPriceUsd'>,
  trial: TrialGrant = NO_TRIAL,
): boolean {
  // Personal ladder gates by rung (e.g. Bella only from Plus up), overriding
  // the coarse Tier which would over-grant (Plus maps to coarse 'pro').
  const pt = activePersonalTier(sub, trial);
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
  const f = activeFeatures(sub, trial);
  return Boolean(f?.[feature]);
}

/** null = unlimited. */
export function caseLimit(
  sub: Subscription | null | undefined,
  trial: TrialGrant = NO_TRIAL,
): number | null {
  // Lifetime comp (founder/owner/QA): Ultra features but uncapped cases.
  if (sub?.priceId === COMP_ULTRA_PRICE_ID) return null;
  const pt = activePersonalTier(sub, trial);
  if (pt) return pt.caseLimit;
  const f = activeFeatures(sub, trial);
  return f ? f.caseLimit : 0; // no sub and no trial means 0 cases allowed
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
