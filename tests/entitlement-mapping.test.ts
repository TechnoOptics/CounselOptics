import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierFromPriceId, tierSlugFromPriceId } from '../lib/stripe';
import {
  resolvePriceEntitlement,
  tierFromIosProduct,
} from '../lib/entitlements';

/**
 * Stage-0 characterization tests for the price -> tier mappings.
 *
 * These pin the EXACT current behavior of the two parallel maps before
 * they are consolidated behind a single source of truth (lib/entitlements.ts).
 * The refactor is only allowed to keep these green. Any change here is a
 * change in who gets what plan / how many tokens, i.e. a money decision.
 *
 * The load-bearing invariant is the *intentional divergence* on the legacy
 * STRIPE_PRICE_PRO id: it resolves to the coarse Tier 'pro' (so the
 * subscriptions row is written) but to a NULL TierSlug (so the new
 * tier-aware grant path skips it and the webhook's grantProMonthlyTokens
 * fallback awards the legacy 1.5M grant instead of the 500K 'pro' grant).
 * Collapsing that to a single lookup would silently downgrade every legacy
 * Pro subscriber at their next renewal.
 */

// Distinct sentinel price ids per env var so no two collide and lookup
// order can't produce a false match. The functions read process.env at
// call time, so setting them here is sufficient.
const ENV: Record<string, string> = {
  STRIPE_PRICE_BASIC: 'price_basic_sentinel',
  STRIPE_PRICE_STANDARD: 'price_standard_sentinel',
  STRIPE_PRICE_PRO: 'price_legacy_pro_sentinel',
  STRIPE_MONTHLY_PRICE_ID: 'price_legacy_monthly_sentinel',
  STRIPE_PRICE_PERSONAL_PRO: 'price_personal_pro_sentinel',
  STRIPE_PRICE_PERSONAL_PRO_ANNUAL: 'price_personal_pro_annual_sentinel',
  STRIPE_PRICE_PERSONAL_PLUS: 'price_personal_plus_sentinel',
  STRIPE_PRICE_PERSONAL_PLUS_ANNUAL: 'price_personal_plus_annual_sentinel',
  STRIPE_PRICE_COUNSEL_SOLO: 'price_solo_sentinel',
  STRIPE_PRICE_COUNSEL_SOLO_ANNUAL: 'price_solo_annual_sentinel',
  STRIPE_PRICE_COUNSEL_SMALL_FIRM: 'price_small_firm_sentinel',
  STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL: 'price_small_firm_annual_sentinel',
  STRIPE_PRICE_COUNSEL_GROWING: 'price_growing_sentinel',
  STRIPE_PRICE_COUNSEL_GROWING_ANNUAL: 'price_growing_annual_sentinel',
  STRIPE_PRICE_COUNSEL_ENTERPRISE: 'price_enterprise_sentinel',
  STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL: 'price_enterprise_annual_sentinel',
};

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('tierFromPriceId (coarse Tier for the subscriptions row)', () => {
  const cases: Array<[string, 'basic' | 'standard' | 'pro']> = [
    ['STRIPE_PRICE_BASIC', 'basic'],
    ['STRIPE_PRICE_STANDARD', 'standard'],
    ['STRIPE_PRICE_PRO', 'pro'],
    ['STRIPE_MONTHLY_PRICE_ID', 'standard'],
    ['STRIPE_PRICE_PERSONAL_PRO', 'pro'],
    ['STRIPE_PRICE_PERSONAL_PLUS', 'pro'],
    ['STRIPE_PRICE_COUNSEL_SOLO', 'pro'],
    ['STRIPE_PRICE_COUNSEL_SMALL_FIRM', 'pro'],
    ['STRIPE_PRICE_COUNSEL_GROWING', 'pro'],
    ['STRIPE_PRICE_COUNSEL_ENTERPRISE', 'pro'],
    // Annual prices now resolve to the same coarse tier as their monthly
    // sibling (previously null, the fixed annual gap).
    ['STRIPE_PRICE_PERSONAL_PRO_ANNUAL', 'pro'],
    ['STRIPE_PRICE_PERSONAL_PLUS_ANNUAL', 'pro'],
    ['STRIPE_PRICE_COUNSEL_SOLO_ANNUAL', 'pro'],
    ['STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL', 'pro'],
    ['STRIPE_PRICE_COUNSEL_GROWING_ANNUAL', 'pro'],
    ['STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL', 'pro'],
  ];
  for (const [envKey, expected] of cases) {
    it(`${envKey} -> ${expected}`, () => {
      expect(tierFromPriceId(ENV[envKey])).toBe(expected);
    });
  }

  it('returns null for null / undefined / empty', () => {
    expect(tierFromPriceId(null)).toBeNull();
    expect(tierFromPriceId(undefined)).toBeNull();
    expect(tierFromPriceId('')).toBeNull();
  });

  it('returns null for an unknown price id', () => {
    expect(tierFromPriceId('price_never_seen')).toBeNull();
  });
});

describe('tierSlugFromPriceId (fine TierSlug for token grants)', () => {
  const cases: Array<[string, string]> = [
    ['STRIPE_PRICE_BASIC', 'basic'],
    ['STRIPE_PRICE_STANDARD', 'standard'],
    ['STRIPE_MONTHLY_PRICE_ID', 'standard'],
    ['STRIPE_PRICE_PERSONAL_PRO', 'pro'],
    ['STRIPE_PRICE_PERSONAL_PRO_ANNUAL', 'pro'],
    ['STRIPE_PRICE_PERSONAL_PLUS', 'pro_plus'],
    ['STRIPE_PRICE_PERSONAL_PLUS_ANNUAL', 'pro_plus'],
    ['STRIPE_PRICE_COUNSEL_SOLO', 'solo'],
    ['STRIPE_PRICE_COUNSEL_SOLO_ANNUAL', 'solo'],
    ['STRIPE_PRICE_COUNSEL_SMALL_FIRM', 'small_firm'],
    ['STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL', 'small_firm'],
    ['STRIPE_PRICE_COUNSEL_GROWING', 'growing_firm'],
    ['STRIPE_PRICE_COUNSEL_GROWING_ANNUAL', 'growing_firm'],
    ['STRIPE_PRICE_COUNSEL_ENTERPRISE', 'enterprise'],
    ['STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL', 'enterprise'],
  ];
  for (const [envKey, expected] of cases) {
    it(`${envKey} -> ${expected}`, () => {
      expect(tierSlugFromPriceId(ENV[envKey])).toBe(expected);
    });
  }

  it('returns null for null / undefined / empty', () => {
    expect(tierSlugFromPriceId(null)).toBeNull();
    expect(tierSlugFromPriceId(undefined)).toBeNull();
    expect(tierSlugFromPriceId('')).toBeNull();
  });

  it('returns null for an unknown price id', () => {
    expect(tierSlugFromPriceId('price_never_seen')).toBeNull();
  });
});

describe('the intentional legacy-Pro divergence (money-critical invariant)', () => {
  it('STRIPE_PRICE_PRO is Tier "pro" but TierSlug null', () => {
    // If this ever flips to a non-null slug, legacy Pro subscribers get
    // 500K instead of their grandfathered 1.5M grant. It must stay null.
    expect(tierFromPriceId(ENV.STRIPE_PRICE_PRO)).toBe('pro');
    expect(tierSlugFromPriceId(ENV.STRIPE_PRICE_PRO)).toBeNull();
  });
});

describe('resolvePriceEntitlement is the single source both delegators use', () => {
  // Every configured price must satisfy: the unified resolver's fields equal
  // what each public delegator returns. This is what guarantees the two maps
  // can no longer drift.
  for (const envKey of Object.keys(ENV)) {
    it(`${envKey}: {tier,tierSlug} matches both delegators`, () => {
      const combined = resolvePriceEntitlement(ENV[envKey]);
      expect(combined.tier).toBe(tierFromPriceId(ENV[envKey]));
      expect(combined.tierSlug).toBe(tierSlugFromPriceId(ENV[envKey]));
    });
  }

  it('annual prices carry the same coarse tier as their monthly sibling', () => {
    // The former annual gap (tier null) is fixed: an annual subscriber's
    // subscriptions.tier is now written 'pro' instead of null. Both webhook
    // grant sites resolve the slug first, so the coarse tier never affects
    // which token grant fires.
    const proAnnual = resolvePriceEntitlement(ENV.STRIPE_PRICE_PERSONAL_PRO_ANNUAL);
    expect(proAnnual).toEqual({ tier: 'pro', tierSlug: 'pro' });
    const plusAnnual = resolvePriceEntitlement(ENV.STRIPE_PRICE_PERSONAL_PLUS_ANNUAL);
    expect(plusAnnual).toEqual({ tier: 'pro', tierSlug: 'pro_plus' });
    const entAnnual = resolvePriceEntitlement(ENV.STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL);
    expect(entAnnual).toEqual({ tier: 'pro', tierSlug: 'enterprise' });
  });

  it('returns both-null for null / unknown', () => {
    expect(resolvePriceEntitlement(null)).toEqual({ tier: null, tierSlug: null });
    expect(resolvePriceEntitlement('price_never_seen')).toEqual({
      tier: null,
      tierSlug: null,
    });
  });
});

describe('tierFromIosProduct (Apple IAP product -> consumer Tier)', () => {
  it('maps the standard + pro product ids', () => {
    expect(tierFromIosProduct('com.advottic.app.standard.monthly')).toBe('standard');
    expect(tierFromIosProduct('com.advottic.app.personal_pro.monthly')).toBe('pro');
  });
  it('returns null for null / unknown product', () => {
    expect(tierFromIosProduct(null)).toBeNull();
    expect(tierFromIosProduct('com.advottic.app.nonexistent')).toBeNull();
  });
});
