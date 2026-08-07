import type { Tier } from './types';
import type { TierSlug } from './token-packages';
import { COMP_ULTRA_PRICE_ID } from './personal-tiers';

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
 * the table below is DELIBERATE and money-critical. Do not "clean it up"
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
 * fall back to the coarse-'pro' legacy grant when there is no slug, and every
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
  // Legacy Pro: coarse tier 'pro', but NO slug. See irregularity (1).
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
 * field can independently be null. See the two irregularities above.
 */
export function resolvePriceEntitlement(
  priceId: string | null | undefined,
): BillingEntitlement {
  if (!priceId) return { tier: null, tierSlug: null };
  // Lifetime comp accounts (founder/owner/QA) carry a sentinel price id that
  // never exists in Stripe, so grant Ultra. See lib/personal-tiers.ts.
  if (priceId === COMP_ULTRA_PRICE_ID) return { tier: 'pro', tierSlug: 'ultra' };
  for (const row of PRICE_TABLE) {
    const configured = process.env[row.env]?.trim();
    if (configured && priceId === configured) {
      return { tier: row.tier, tierSlug: row.tierSlug };
    }
  }
  return { tier: null, tierSlug: null };
}

// ---------------------------------------------------------------------------
// The tier VOCABULARY, derived from the table above rather than written twice.
//
// HQ can put an account on a trial that runs at a plan level. That level has
// to mean the same thing as a paid plan of that name, or the product has two
// answers to "what does Growing Firm include" and one of them is wrong. So
// the set of levels a trial may run at, and the coarse Tier each one grants,
// are READ OFF PRICE_TABLE. There is deliberately no second list: a hand
// written one would be a second place to get an entitlement wrong, and it
// would drift the first time a rung is added here and not there.
//
// Three properties fall out of deriving it, and all three are wanted:
//
//   Legacy STRIPE_PRICE_PRO contributes NOTHING, because its slug is null.
//   That is the money-critical irregularity documented above, and a trial can
//   therefore never be run at the grandfathered 1.5M grant. Good: that grant
//   belongs to people who bought it.
//
//   'free' is absent, because no price grants it. A trial at 'free' is not a
//   trial, it is the absence of one, and offering it would be a lever that
//   silently does nothing.
//
//   Monthly and annual rows collapse, because they carry the same slug and
//   the same tier. A trial has no billing period to pick.
// ---------------------------------------------------------------------------

function buildSlugTiers(): ReadonlyMap<TierSlug, Tier | null> {
  const map = new Map<TierSlug, Tier | null>();
  for (const row of PRICE_TABLE) {
    if (row.tierSlug === null) continue;
    const existing = map.get(row.tierSlug);
    // A slug that two rows disagree about has no single answer, and picking
    // either one silently is how an entitlement goes wrong quietly. The table
    // is static and env-independent, so this throws during module evaluation
    // in dev, in test and in `next build` rather than in front of a customer.
    if (existing !== undefined && existing !== row.tier) {
      throw new Error(
        `entitlements: the tier slug ${row.tierSlug} maps to both ${String(existing)} and ${String(row.tier)}. One slug grants one coarse tier.`,
      );
    }
    map.set(row.tierSlug, row.tier);
  }
  return map;
}

const SLUG_TIERS = buildSlugTiers();

/**
 * Every plan level the price table can grant, in table order. This is the
 * only list a trial level may come from.
 */
export const ENTITLEMENT_TIER_SLUGS: readonly TierSlug[] = Object.freeze([
  ...SLUG_TIERS.keys(),
]);

/**
 * Whether an arbitrary stored value names a plan level this product sells.
 *
 * Takes `unknown` on purpose. The value it guards arrives from a text column,
 * so it is a string at best and anything at worst, and narrowing it here is
 * what lets the trial resolver refuse rather than coerce.
 */
export function isEntitlementTierSlug(value: unknown): value is TierSlug {
  return typeof value === 'string' && SLUG_TIERS.has(value as TierSlug);
}

/**
 * What a plan level grants, in the same shape resolvePriceEntitlement returns
 * for a price id. Same table, same answer, reached without a Stripe price.
 */
export function entitlementForTierSlug(slug: TierSlug): BillingEntitlement {
  const tier = SLUG_TIERS.get(slug);
  if (tier === undefined) return { tier: null, tierSlug: null };
  return { tier, tierSlug: slug };
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
