import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_TIER_SLUGS,
  entitlementForTierSlug,
  isEntitlementTierSlug,
  resolvePriceEntitlement,
} from '../lib/entitlements';
import {
  applyTrialToUnpaid,
  paidFromSubscription,
  resolveAccountEntitlement,
  UNPAID,
  type PaidEntitlement,
} from '../lib/trial-entitlement';

/**
 * The money path for HQ-granted trials.
 *
 * A trial here carries a PLAN LEVEL, so it is no longer only a date: it can
 * change what an account is entitled to. That puts it beside the price table
 * in lib/entitlements.ts, and every test below is written to die under one
 * named mutation. A test that still passes with its guard removed is not
 * testing the guard, and on this path the cost of that is a billing incident.
 *
 * The three that matter most, named where they are asserted:
 *
 *   M1  a trial beating a paid subscription
 *   M2  an expired trial still granting its tier
 *   M3  a trial tier that is not in the entitlements table being accepted
 */

const NOW = new Date('2026-08-06T12:00:00.000Z');
const FUTURE = new Date('2026-09-01T00:00:00.000Z').toISOString();
const PAST = new Date('2026-07-01T00:00:00.000Z').toISOString();

const ENV: Record<string, string> = {
  STRIPE_PRICE_PERSONAL_PLUS8: 'price_plus8_sentinel',
  STRIPE_PRICE_COUNSEL_GROWING: 'price_growing_sentinel',
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

describe('the trial tier vocabulary is the entitlements table', () => {
  it('accepts every slug the price table can produce', () => {
    // Not a hand-written list. The point of the derivation is that there is
    // no second list to drift, so the assertion reads the same table the
    // resolver does.
    expect(ENTITLEMENT_TIER_SLUGS.length).toBeGreaterThan(0);
    for (const slug of ENTITLEMENT_TIER_SLUGS) {
      expect(isEntitlementTierSlug(slug)).toBe(true);
      // Every accepted slug must also answer what coarse tier it grants,
      // because the subscriptions-shaped half of the answer is what the rest
      // of the product reads.
      expect(entitlementForTierSlug(slug).tierSlug).toBe(slug);
    }
  });

  it('carries the same coarse tier the price table gives that slug', () => {
    expect(entitlementForTierSlug('plus')).toEqual(
      resolvePriceEntitlement('price_plus8_sentinel'),
    );
    expect(entitlementForTierSlug('growing_firm')).toEqual(
      resolvePriceEntitlement('price_growing_sentinel'),
    );
  });

  it('does not offer free as a trial level, because no price grants it', () => {
    // 'free' is a TierSlug but no row of the price table maps to it, so it is
    // not something a trial can be run AT. A trial at 'free' is just no trial.
    expect(isEntitlementTierSlug('free')).toBe(false);
    expect(ENTITLEMENT_TIER_SLUGS).not.toContain('free');
  });

  it('refuses anything that is not a slug of that table', () => {
    expect(isEntitlementTierSlug('unlimited')).toBe(false);
    expect(isEntitlementTierSlug('')).toBe(false);
    expect(isEntitlementTierSlug(null)).toBe(false);
    expect(isEntitlementTierSlug(undefined)).toBe(false);
    expect(isEntitlementTierSlug(7)).toBe(false);
  });
});

describe('a paid subscription always beats a trial', () => {
  /**
   * MUTATION M1: in resolveAccountEntitlement, replace the paid branch with
   * an unconditional `return applyTrialToUnpaid(paid as never, trial, now)`.
   *
   * That is the only way to write "trial wins", because the honest spelling
   * does not compile: applyTrialToUnpaid accepts the unpaid member of the
   * union and nothing else. Under the cast, the runtime half of the same
   * guard throws, and every assertion in this block goes red.
   */
  const paidPlus: PaidEntitlement = {
    kind: 'paid',
    tier: 'pro',
    tierSlug: 'plus',
  };

  it('does not lift a payer to the trial level', () => {
    const resolved = resolveAccountEntitlement(
      paidPlus,
      { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
      NOW,
    );
    expect(resolved).toEqual({ source: 'paid', tier: 'pro', tierSlug: 'plus' });
  });

  it('does not downgrade a payer to a lower trial level', () => {
    const resolved = resolveAccountEntitlement(
      paidPlus,
      { trialTierSlug: 'starter', trialEndsAt: FUTURE },
      NOW,
    );
    expect(resolved.tierSlug).toBe('plus');
    expect(resolved.source).toBe('paid');
  });

  it('does not extend a payer whose trial has already lapsed', () => {
    const resolved = resolveAccountEntitlement(
      paidPlus,
      { trialTierSlug: 'ultra', trialEndsAt: PAST },
      NOW,
    );
    expect(resolved).toEqual({ source: 'paid', tier: 'pro', tierSlug: 'plus' });
  });

  it('refuses at runtime to apply a trial to a paid account', () => {
    // The compile-time half of M1 cannot be exercised from a test, so this
    // asserts the runtime half directly. Delete the throw and this goes red.
    expect(() =>
      applyTrialToUnpaid(
        paidPlus as unknown as typeof UNPAID,
        { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
        NOW,
      ),
    ).toThrow(/paid/i);
  });

  it('treats a subscription in a live status as paid, whatever the trial says', () => {
    for (const status of ['active', 'trialing'] as const) {
      const paid = paidFromSubscription({
        status,
        priceId: 'price_plus8_sentinel',
      });
      expect(paid.kind).toBe('paid');
      const resolved = resolveAccountEntitlement(
        paid,
        { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
        NOW,
      );
      expect(resolved.source).toBe('paid');
      expect(resolved.tierSlug).toBe('plus');
    }
  });

  it('leaves a lapsed or absent subscription open to a trial', () => {
    for (const status of ['canceled', 'inactive', 'past_due', 'unpaid', 'incomplete'] as const) {
      expect(
        paidFromSubscription({ status, priceId: 'price_plus8_sentinel' }).kind,
      ).toBe('unpaid');
    }
    expect(paidFromSubscription(null).kind).toBe('unpaid');
  });

  it('treats a live subscription on an unrecognised price as paid, not as room for a trial', () => {
    // The price does not resolve, so the entitlement is null and the account
    // reads as free. It is still SOMEBODY WHO PAYS, and a trial that lifted
    // them would be lifting a customer whose price we simply failed to map.
    const paid = paidFromSubscription({ status: 'active', priceId: 'price_not_wired' });
    expect(paid).toEqual({ kind: 'paid', tier: null, tierSlug: null });
    expect(
      resolveAccountEntitlement(
        paid,
        { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
        NOW,
      ).source,
    ).toBe('paid');
  });
});

describe('an expired trial resolves exactly as no trial at all', () => {
  /**
   * MUTATION M2: in applyTrialToUnpaid, delete the `now >= end` comparison
   * (or invert it) so the window is never checked. Every assertion here goes
   * red, because each one is an expired or edge-of-expiry trial that must
   * grant nothing.
   */
  const none = { source: 'none', tier: null, tierSlug: null };

  it('grants nothing once the end date has passed', () => {
    expect(
      resolveAccountEntitlement(UNPAID, { trialTierSlug: 'ultra', trialEndsAt: PAST }, NOW),
    ).toEqual(none);
  });

  it('grants nothing at the exact instant the trial ends', () => {
    expect(
      resolveAccountEntitlement(
        UNPAID,
        { trialTierSlug: 'ultra', trialEndsAt: NOW.toISOString() },
        NOW,
      ),
    ).toEqual(none);
  });

  it('still grants while the end date is ahead', () => {
    expect(
      resolveAccountEntitlement(UNPAID, { trialTierSlug: 'ultra', trialEndsAt: FUTURE }, NOW),
    ).toEqual({ source: 'trial', tier: 'pro', tierSlug: 'ultra' });
  });

  it('reads the end date the same whether it arrives as a Date or an ISO string', () => {
    // PostgREST hands this back as an ISO STRING, and a Date-typed field
    // holding a string fails OPEN on comparison. Both spellings are declared
    // and both are validated, so both must agree.
    const asString = resolveAccountEntitlement(
      UNPAID,
      { trialTierSlug: 'ultra', trialEndsAt: PAST },
      NOW,
    );
    const asDate = resolveAccountEntitlement(
      UNPAID,
      { trialTierSlug: 'ultra', trialEndsAt: new Date(PAST) },
      NOW,
    );
    expect(asString).toEqual(asDate);
    expect(asDate).toEqual(none);
  });

  it('grants nothing when the stored end date is unparseable', () => {
    // new Date('garbage') is an Invalid Date whose comparisons are ALL false,
    // so a coercion without validation reads as "not yet expired" forever.
    expect(
      resolveAccountEntitlement(UNPAID, { trialTierSlug: 'ultra', trialEndsAt: 'garbage' }, NOW),
    ).toEqual(none);
  });

  it('grants nothing when the end date is not a Date or a string at all', () => {
    // new Date(null) is the epoch: a perfectly VALID Date that a NaN check
    // cannot see, and one that sits before every trial end.
    for (const bad of [null, 0, {}, [], true]) {
      expect(
        resolveAccountEntitlement(
          UNPAID,
          { trialTierSlug: 'ultra', trialEndsAt: bad as never },
          NOW,
        ),
      ).toEqual(none);
    }
  });

  it('refuses to resolve against a clock it cannot read', () => {
    expect(() =>
      resolveAccountEntitlement(
        UNPAID,
        { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
        'garbage',
      ),
    ).toThrow();
    expect(() =>
      resolveAccountEntitlement(
        UNPAID,
        { trialTierSlug: 'ultra', trialEndsAt: FUTURE },
        null as never,
      ),
    ).toThrow();
  });
});

describe('a trial level outside the entitlements table grants nothing', () => {
  /**
   * MUTATION M3: in applyTrialToUnpaid, drop the isEntitlementTierSlug check
   * and pass the stored string straight to entitlementForTierSlug. Every
   * assertion here goes red, because each stores a level the price table
   * never defines.
   */
  const none = { source: 'none', tier: null, tierSlug: null };

  it('refuses a level nobody sells', () => {
    for (const bogus of ['unlimited', 'PLUS', 'plus ', 'free', '', 'growing firm']) {
      expect(
        resolveAccountEntitlement(
          UNPAID,
          { trialTierSlug: bogus, trialEndsAt: FUTURE },
          NOW,
        ),
      ).toEqual(none);
    }
  });

  it('refuses a level that is not a string', () => {
    for (const bogus of [7, {}, [], true]) {
      expect(
        resolveAccountEntitlement(
          UNPAID,
          { trialTierSlug: bogus as never, trialEndsAt: FUTURE },
          NOW,
        ),
      ).toEqual(none);
    }
  });

  it('grants nothing for a clock with no level on it', () => {
    expect(
      resolveAccountEntitlement(UNPAID, { trialTierSlug: null, trialEndsAt: FUTURE }, NOW),
    ).toEqual(none);
  });

  it('grants nothing for a level with no clock on it', () => {
    // A level with no end date has no window, so it never starts rather than
    // never ending. The permissive reading of this pair is the expensive one.
    expect(
      resolveAccountEntitlement(UNPAID, { trialTierSlug: 'ultra', trialEndsAt: null }, NOW),
    ).toEqual(none);
  });
});
