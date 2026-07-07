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
 * Behavior is pinned by tests/entitlement-mapping.test.ts. One irregularity in
 * the table below is DELIBERATE and money-critical — do not "clean it up"
 * without changing those tests on purpose:
 *
 *   Legacy STRIPE_PRICE_PRO has tier 'pro' but tierSlug `null`. The null slug
 *   makes the webhook skip the tier-aware grant and fall back to
 *   grantProMonthlyTokens (1.5M), which is what grandfathered Pro subscribers
 *   are owed. A non-null slug would downgrade them to the 500K 'pro' grant at
 *   their next renewal.
 *
 * (The original tierFromPriceId never recognized the `_ANNUAL` ids, so an
 * annual subscriber's subscriptions.tier was written null. That gap is now
 * fixed: each _ANNUAL row carries the same coarse tier as its monthly sibling.
 * Safe because both webhook grant sites resolve the TierSlug FIRST and only
 * fall back to the coarse-'pro' legacy grant when there is no slug — every
 * annual price has a slug, so it never reaches that fallback.)
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
  // Consumer ladder (new billing model). Each _ANNUAL row carries the same
  // coarse tier as its monthly sibling (see the note on the former annual gap).
  { env: 'STRIPE_PRICE_PERSONAL_PRO', tier: 'pro', tierSlug: 'pro' },
  { env: 'STRIPE_PRICE_PERSONAL_PRO_ANNUAL', tier: 'pro', tierSlug: 'pro' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS', tier: 'pro', tierSlug: 'pro_plus' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS_ANNUAL', tier: 'pro', tierSlug: 'pro_plus' },
  // 5-tier consumer ladder (2026-07-07). Coarse tier is 'standard' for Starter
  // (no Bella) and 'pro' for the Bella tiers so the token gauge shows; the fine
  // slug carries the real per-rung caps + unlocks (lib/personal-tiers.ts).
  { env: 'STRIPE_PRICE_PERSONAL_STARTER', tier: 'standard', tierSlug: 'starter' },
  { env: 'STRIPE_PRICE_PERSONAL_STARTER_ANNUAL', tier: 'standard', tierSlug: 'starter' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS8', tier: 'pro', tierSlug: 'plus' },
  { env: 'STRIPE_PRICE_PERSONAL_PLUS8_ANNUAL', tier: 'pro', tierSlug: 'plus' },
  { env: 'STRIPE_PRICE_PERSONAL_PRO15', tier: 'pro', tierSlug: 'premium' },
  { env: 'STRIPE_PRICE_PERSONAL_PRO15_ANNUAL', tier: 'pro', tierSlug: 'premium' },
  { env: 'STRIPE_PRICE_PERSONAL_ULTRA', tier: 'pro', tierSlug: 'ultra' },
  { env: 'STRIPE_PRICE_PERSONAL_ULTRA_ANNUAL', tier: 'pro', tierSlug: 'ultra' },
  // Firm ladder. Coarse tier collapses to 'pro' for anything that still
  // types against Tier (basic | standard | pro).
  { env: 'STRIPE_PRICE_COUNSEL_SOLO', tier: 'pro', tierSlug: 'solo' },
  { env: 'STRIPE_PRICE_COUNSEL_SOLO_ANNUAL', tier: 'pro', tierSlug: 'solo' },
  { env: 'STRIPE_PRICE_COUNSEL_SMALL_FIRM', tier: 'pro', tierSlug: 'small_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL', tier: 'pro', tierSlug: 'small_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_GROWING', tier: 'pro', tierSlug: 'growing_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_GROWING_ANNUAL', tier: 'pro', tierSlug: 'growing_firm' },
  { env: 'STRIPE_PRICE_COUNSEL_ENTERPRISE', tier: 'pro', tierSlug: 'enterprise' },
  { env: 'STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL', tier: 'pro', tierSlug: 'enterprise' },
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
