import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeTier, caseLimit, hasFeature } from '../lib/tier';
import type { Subscription } from '../lib/types';
import type { TrialGrant } from '../lib/trial-entitlement';

/**
 * The consumer feature gates, once an HQ-granted trial can carry a plan level.
 *
 * These are the money-path tests for the WIRING, as distinct from
 * tests/trial-entitlement.test.ts which tests the rule. What has to hold here
 * is that threading a trial through lib/tier.ts changed nothing for anybody
 * who pays, and changed exactly one thing for somebody who does not.
 */

const ENV: Record<string, string> = {
  STRIPE_PRICE_PERSONAL_STARTER: 'price_starter_sentinel',
  STRIPE_PRICE_PERSONAL_ULTRA: 'price_ultra_sentinel',
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

function sub(over: Partial<Subscription>): Subscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    status: 'active',
    priceId: null,
    tier: null,
    cancelAtPeriodEnd: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const liveTrial: TrialGrant = {
  trialTierSlug: 'ultra',
  trialEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
};
const lapsedTrial: TrialGrant = {
  trialTierSlug: 'ultra',
  trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
};

describe('a trial lifts an account that is not paying', () => {
  it('grants the trial rung to somebody with no subscription at all', () => {
    // Ultra is 40 cases with every consumer feature on. Without the trial the
    // same call gives 0 cases and nothing unlocked.
    expect(caseLimit(null)).toBe(0);
    expect(hasFeature(null, 'aiReview')).toBe(false);

    expect(caseLimit(null, liveTrial)).toBe(40);
    expect(hasFeature(null, 'aiReview', liveTrial)).toBe(true);
    expect(activeTier(null, liveTrial)).toBe('pro');
  });

  it('grants the trial rung to somebody whose subscription has lapsed', () => {
    const canceled = sub({ status: 'canceled', priceId: 'price_starter_sentinel', tier: 'standard' });

    expect(caseLimit(canceled)).toBe(0);
    expect(caseLimit(canceled, liveTrial)).toBe(40);
  });
});

describe('a trial never touches somebody who pays', () => {
  /**
   * MUTATION: in lib/tier.ts activeTier, drop the `paid.kind === 'paid'`
   * branch so the trial is consulted for everyone. Every assertion in this
   * block goes red, and the runtime guard in applyTrialToUnpaid throws on top
   * of it.
   */
  const starter = sub({ priceId: 'price_starter_sentinel', tier: 'standard' });

  it('does not lift a payer to the trial rung', () => {
    // Starter is 3 cases with no Advottic Review. The trial says Ultra, which
    // is 40 and everything, and it must not be heard.
    expect(caseLimit(starter, liveTrial)).toBe(3);
    expect(hasFeature(starter, 'aiReview', liveTrial)).toBe(false);
    expect(caseLimit(starter, liveTrial)).toBe(caseLimit(starter));
  });

  it('does not lift a payer whose price this build cannot resolve', () => {
    // A live subscription on an unmapped price is still somebody who pays.
    const unmapped = sub({ priceId: 'price_not_wired', tier: 'standard' });
    expect(caseLimit(unmapped, liveTrial)).toBe(caseLimit(unmapped));
    expect(activeTier(unmapped, liveTrial)).toBe('standard');
  });

  it('still reads a payer coarse tier from their own subscription row', () => {
    // Not re-derived from the price. subscriptions.tier is what the webhook
    // wrote, and switching to the price-derived value would be a silent
    // change to every existing account rather than a trial feature. This row
    // deliberately disagrees with its price to pin that.
    const odd = sub({ priceId: 'price_ultra_sentinel', tier: 'basic' });
    expect(activeTier(odd)).toBe('basic');
    expect(activeTier(odd, liveTrial)).toBe('basic');
  });
});

describe('an expired trial gates exactly as no trial at all', () => {
  it('grants nothing once the date has passed', () => {
    expect(caseLimit(null, lapsedTrial)).toBe(caseLimit(null));
    expect(hasFeature(null, 'aiReview', lapsedTrial)).toBe(false);
    expect(activeTier(null, lapsedTrial)).toBeNull();
  });

  it('grants nothing for a level this build does not sell', () => {
    const bogus: TrialGrant = { trialTierSlug: 'unlimited', trialEndsAt: liveTrial.trialEndsAt };
    expect(caseLimit(null, bogus)).toBe(caseLimit(null));
    expect(hasFeature(null, 'bella', bogus)).toBe(false);
  });
});

describe('omitting the trial leaves every gate as it was', () => {
  it('answers identically with no trial argument and with an empty one', () => {
    const empty: TrialGrant = { trialTierSlug: null, trialEndsAt: null };
    const rows = [null, sub({ priceId: 'price_starter_sentinel', tier: 'standard' })];
    for (const row of rows) {
      expect(caseLimit(row, empty)).toBe(caseLimit(row));
      expect(activeTier(row, empty)).toBe(activeTier(row));
      expect(hasFeature(row, 'collaborators', empty)).toBe(
        hasFeature(row, 'collaborators'),
      );
    }
  });
});
