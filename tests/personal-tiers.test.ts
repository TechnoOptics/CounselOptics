import { describe, it, expect } from 'vitest';
import { PERSONAL_TIERS, personalTierForSlug, COMP_ULTRA_PRICE_ID } from '../lib/personal-tiers';
import { resolvePriceEntitlement } from '../lib/entitlements';
import { caseLimit, hasFeature } from '../lib/tier';
import type { Subscription } from '../lib/types';

function sub(priceId: string | null): Subscription {
  return {
    id: 's', userId: 'u', stripeCustomerId: null, stripeSubscriptionId: null,
    status: 'active', priceId, tier: 'pro', currentPeriodEnd: null,
    cancelAtPeriodEnd: false, createdAt: '', updatedAt: '',
  };
}

describe('personal ladder shape', () => {
  it('has the five confirmed rungs at the confirmed prices + caps', () => {
    expect(PERSONAL_TIERS.map((t) => [t.key, t.priceUsd, t.caseLimit])).toEqual([
      ['free', 0, 1],
      ['starter', 19, 3],
      ['plus', 29, 8],
      ['premium', 59, 15],
      ['ultra', 99, 40],
    ]);
  });

  it('Bella unlocks at Plus (rung 3), not before', () => {
    const byKey = Object.fromEntries(PERSONAL_TIERS.map((t) => [t.key, t]));
    expect(byKey.free.bella).toBe(false);
    expect(byKey.starter.bella).toBe(false);
    expect(byKey.plus.bella).toBe(true);
  });

  it('timeline + group cases are Ultra-only on the personal track', () => {
    for (const t of PERSONAL_TIERS) {
      const ultraOnly = t.key === 'ultra';
      expect(t.timeline).toBe(ultraOnly);
      expect(t.groupCases).toBe(ultraOnly);
    }
  });
});

describe('lifetime comp = Ultra', () => {
  it('the sentinel price id resolves to the Ultra slug', () => {
    expect(resolvePriceEntitlement(COMP_ULTRA_PRICE_ID)).toEqual({ tier: 'pro', tierSlug: 'ultra' });
    expect(personalTierForSlug('ultra')?.key).toBe('ultra');
  });

  it('grants every Ultra feature', () => {
    const s = sub(COMP_ULTRA_PRICE_ID);
    expect(hasFeature(s, 'bella')).toBe(true);
    expect(hasFeature(s, 'aiReview')).toBe(true);
    expect(hasFeature(s, 'collaborators')).toBe(true);
  });

  it('is uncapped on cases (not the 40 Ultra cap)', () => {
    expect(caseLimit(sub(COMP_ULTRA_PRICE_ID))).toBeNull();
  });
});

describe('per-rung gating by fine slug', () => {
  it('Plus grants Bella but not Advottic Review or collaborators', () => {
    // Simulate a Plus subscription by stubbing the price env the table reads.
    process.env.STRIPE_PRICE_PERSONAL_PLUS8 = 'price_plus_test';
    const s = sub('price_plus_test');
    expect(hasFeature(s, 'bella')).toBe(true);
    expect(hasFeature(s, 'aiReview')).toBe(false);
    expect(hasFeature(s, 'collaborators')).toBe(false);
    expect(caseLimit(s)).toBe(8);
    delete process.env.STRIPE_PRICE_PERSONAL_PLUS8;
  });
});
