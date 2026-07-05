import type { Tier } from './types';
import type { TierSlug } from './token-packages';

/**
 * Single source of truth for "what plan does this billing artifact grant?"
 *
 * Before this module, the answer lived in TWO parallel functions in
 * lib/stripe.ts (tierFromPriceId -> coarse Tier for the subscriptions row;
 * tierSlugFromPriceId -> fine TierSlug for the token grant) plus a THIRD map
 * for Apple products in lib/iap-server.ts. Because they read the same
 * STRIPE_PRICE_* env vars but were maintained independently, a new price
 * wired into one but not the other would silently mis-grant. They now all
 * delegate here.
 *
 * Behavior is pinned by tests/entitlement-mapping.test.ts. Two irregularities
 * in the table below are DELIBERATE and money-critical — do not "clean them
 * up" without changing those tests on purpose:
 *
 *   1. Legacy STRIPE_PRICE_PRO has tier 'pro' but tierSlug `null`. The null
 *      slug makes the webhook skip the tier-aware grant and fall back to
 *      grantProMonthlyTokens (1.5M), which is what grandfathered Pro
 *      subscribers are owed. A non-null slug would downgrade them to the
 *      500K 'pro' grant at their next renewal.
 *
 *   2. The `_ANNUAL` prices have tier `null` (only a tierSlug). This mirrors
 *      the original tierFromPriceId, which never recognized annual ids. It is
 *      a latent gap (an annual subscriber's subscriptions.tier would be
 *      written null) — preserved here bug-for-bug so this consolidation
 *      changes no behavior; fixing it is a separate, deliberate change.
 */

export type BillingEntitlement = { tier: Tier | null; tierSlug: TierSlug | null };

type PriceRow = { env: string; tier: Tier | null; tierSlug: TierSlug | null };

/**
 * Ordered price table. First env var whose value equals the given price id
 * wins. In production every STRIPE_PRICE_* holds a distinct Stripe price id,
 * so order only documents intent; it never disambiguates a real collision.
 */
const PRICE_TABLE: readonly PriceRow[] = [
  // Legacy consumer tiers.
  { env: 'STRIPE_PRICE_BASIC', tier: 'basic', tierSlug: 'basic' },
  { env: 'STRIPE_PRICE_STANDARD', tier: 'standard', tierSlug: 'standard' },
  // Legacy Pro: coarse tier 'pro', but NO slug — see irregularity (1).
  { env: 'STRIPE_PRICE_PRO', tier: 'pro', tierSlug: null },
  { env: 'STRIPE_MONTHLY_PRICE_ID', tier: 'standard', tierSlug: 'standard' },
  // Consumer ladder (new billing model).
  { env: 'STRIPE_PRICE_PERSONAL_PRO', tier: 'pro', tierSlug: 'pro' },
  { env: 'STRIPE_PRICE_PERSONAL_PRO_ANNUAL', tier: null, tierSlug: 'pro' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS', tier: 'pro', tierSlug: 'pro_plus' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS_ANNUAL', tier: null, tierSlug: 'pro_plus' },
  // Firm ladder. Coarse tier collapses to 'pro' for anything that still
  // types against Tier (basic | standard | pro).
  { env: 'STRIPE_PRICE_COUNSEL_SOLO', tier: 'pro', tierSlug: 'solo' },
  { env: 'STRIPE_PRICE_COUNSEL_SOLO_ANNUAL', tier: null, tierSlug: 'solo' },
  { env: 'STRIPE_PRICE_COUNSEL_SMALL_FIRM', tier: 'pro', tierSlug: 'small_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL', tier: null, tierSlug: 'small_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_GROWING', tier: 'pro', tierSlug: 'growing_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_GROWING_ANNUAL', tier: null, tierSlug: 'growing_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_ENTERPRISE', tier: 'pro', tierSlug: 'enterprise' },
  { env: 'STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL', tier: null, tierSlug: 'enterprise' },
];

/**
 * Resolve a Stripe Price ID to both the coarse Tier (for the subscriptions
 * row) and the fine TierSlug (for the token grant), in one lookup. Either
 * field can independently be null — see the two irregularities above.
 */
export function resolvePriceEntitlement(
  priceId: string | null | undefined,
): BillingEntitlement {
  if (!priceId) return { tier: null, tierSlug: null };
  for (const row of PRICE_TABLE) {
    const configured = process.env[row.env]?.trim();
    if (configured && priceId === configured) {
      return { tier: row.tier, tierSlug: row.tierSlug };
    }
  }
  return { tier: null, tierSlug: null };
}

// ---------------------------------------------------------------------------
// Apple In-App Purchase product ids. IAP only sells the two consumer tiers
// (standard flat-rate, pro metered); there is no firm ladder on iOS, so this
// is a coarse Tier map with no TierSlug dimension. Mirror of IOS_PRODUCT_BY_TIER
// in lib/iap.ts (the reverse map used to trigger a purchase).
// ---------------------------------------------------------------------------
const IOS_PRODUCT_TIERS: Record<string, Tier> = {
  'com.advottic.app.standard.monthly': 'standard',
  // Pro reuses the repurposed ASC draft id (see IOS_PRODUCT_BY_TIER in lib/iap.ts).
  'com.advottic.app.personal_pro.monthly': 'pro',
};

export function tierFromIosProduct(
  productId: string | null | undefined,
): Tier | null {
  if (!productId) return null;
  return IOS_PRODUCT_TIERS[productId] ?? null;
}
