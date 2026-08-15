import { describe, expect, it } from 'vitest';
import {
  firmAiGateFor,
  firmAiRefusalMessage,
  firmAiRefusalStatus,
  resolveFirmEntitlement,
  type FirmAiRefusal,
  type FirmEntitlementInput,
} from '../lib/firm-entitlement';
import {
  UNPAID,
  type PaidEntitlement,
  type ResolvedEntitlement,
  type TrialGrant,
} from '../lib/trial-entitlement';
import type { FirmAccessState } from '../lib/firm-access';

/**
 * The firm-side entitlement rule.
 *
 * tests/trial-entitlement.test.ts owns the paid-beats-trial rule itself. What
 * has to hold HERE is the one thing this module adds on top of it: an
 * organization can be CLOSED, and a closed organization is entitled to nothing
 * whether it pays or not.
 *
 * Every test below is written to die under a specific mutation, and the mutation
 * is named in the test. A test that still passes with the guard deleted is not
 * testing the guard.
 */

const T0 = '2026-08-10T12:00:00.000Z';

function at(offsetDays: number): string {
  return new Date(Date.parse(T0) + offsetDays * 86_400_000).toISOString();
}

/** A trial at a level the price table really grants. See lib/entitlements.ts. */
const liveGrowingFirm: TrialGrant = {
  trialTierSlug: 'growing_firm',
  trialEndsAt: at(30),
};
const liveSolo: TrialGrant = { trialTierSlug: 'solo', trialEndsAt: at(30) };
const lapsed: TrialGrant = { trialTierSlug: 'growing_firm', trialEndsAt: at(-1) };
const dateButNoLevel: TrialGrant = { trialTierSlug: null, trialEndsAt: at(30) };
const levelButNoDate: TrialGrant = {
  trialTierSlug: 'growing_firm',
  trialEndsAt: null,
};
const noTrial: TrialGrant = { trialTierSlug: null, trialEndsAt: null };

const paidSolo: PaidEntitlement = {
  kind: 'paid',
  tier: 'pro',
  tierSlug: 'solo',
};
/**
 * A live subscription on a price THIS BUILD DOES NOT RECOGNISE. Not a
 * curiosity: it is what an unconfigured STRIPE_PRICE_* env var produces, and it
 * is the state the old boolean gate let through. It must keep passing.
 */
const paidUnknownPrice: PaidEntitlement = {
  kind: 'paid',
  tier: null,
  tierSlug: null,
};

function input(over: Partial<FirmEntitlementInput> = {}): FirmEntitlementInput {
  return { access: 'active', paid: UNPAID, trial: noTrial, ...over };
}

describe('a closed organization is entitled to nothing', () => {
  it('grants nothing to a suspended organization that is still paying', () => {
    // KILLS: dropping the export_only branch, or reordering it after the
    // delegate call. Without the branch this returns source 'paid', which is
    // how a suspended organization kept full AI access through the route
    // handlers, since a route renders no layout and never saw the redirect.
    const closed = resolveFirmEntitlement(
      input({ access: 'export_only', paid: paidSolo }),
      T0,
    );
    expect(closed.source).toBe('none');
    expect(closed.tierSlug).toBeNull();
    expect(closed.tier).toBeNull();

    // Same organization, open: the subscription answers. This pair is what
    // proves the assertion above is about the access state and not about the
    // fixture being unpaid.
    expect(resolveFirmEntitlement(input({ paid: paidSolo }), T0).source).toBe(
      'paid',
    );
  });

  it('grants nothing to a closed organization with a live trial level', () => {
    // KILLS: computing the answer from the trial dates alone. A suspension is
    // invisible in a TrialGrant, so a version of this rule that only looked at
    // trialEndsAt would return source 'trial' here.
    const closed = resolveFirmEntitlement(
      input({ access: 'export_only', trial: liveGrowingFirm }),
      T0,
    );
    expect(closed.source).toBe('none');
    expect(closed.tierSlug).toBeNull();
  });

  it('is a compile error and a throw for an access state it has no rule for', () => {
    // KILLS: replacing the switch with `if (access === 'export_only')`, which
    // would silently fall through to the granting branch for a third state.
    expect(() =>
      resolveFirmEntitlement(
        input({ access: 'archived' as unknown as FirmAccessState }),
        T0,
      ),
    ).toThrow(/no rule for the access state/);
  });
});

describe('an open organization: paid always beats the trial', () => {
  it('reads a payer from the subscription and never from the trial', () => {
    // The organization pays for Solo and HQ recorded a Growing Firm trial on
    // it. The answer must be Solo. KILLS: any comparison of the two levels, or
    // a "take the higher one" merge, in place of the delegation.
    const resolved = resolveFirmEntitlement(
      input({ paid: paidSolo, trial: liveGrowingFirm }),
      T0,
    );
    expect(resolved.source).toBe('paid');
    expect(resolved.tierSlug).toBe('solo');
  });

  it('does not let a trial extend a payer past the trial end either', () => {
    // A lapsed trial must not downgrade a payer any more than a live one may
    // upgrade them. Both directions, one rule.
    const resolved = resolveFirmEntitlement(
      input({ paid: paidSolo, trial: lapsed }),
      T0,
    );
    expect(resolved.source).toBe('paid');
    expect(resolved.tierSlug).toBe('solo');
  });

  it('keeps a payer on an unrecognised price paid, with a null level', () => {
    // This is the state the previous gate let through, and it still passes.
    // KILLS: gating on a KNOWN tier slug instead of on `source`, which would
    // cut off every organization whose STRIPE_PRICE_* is unset in this build.
    const resolved = resolveFirmEntitlement(
      input({ paid: paidUnknownPrice, trial: liveGrowingFirm }),
      T0,
    );
    expect(resolved.source).toBe('paid');
    expect(resolved.tierSlug).toBeNull();
  });
});

describe('an open organization that is not paying: the trial decides', () => {
  it('grants the recorded level, and a different level is a different answer', () => {
    // THE WHOLE POINT OF THE CHANGE. Before it, these two calls were
    // indistinguishable: firms.trial_tier had no runtime consumer, so a
    // Growing Firm pilot ran exactly like a Solo one.
    const growing = resolveFirmEntitlement(
      input({ trial: liveGrowingFirm }),
      T0,
    );
    const solo = resolveFirmEntitlement(input({ trial: liveSolo }), T0);

    expect(growing.source).toBe('trial');
    expect(growing.tierSlug).toBe('growing_firm');
    expect(solo.source).toBe('trial');
    expect(solo.tierSlug).toBe('solo');
    expect(growing.tierSlug).not.toBe(solo.tierSlug);
  });

  it('grants nothing once the trial has ended', () => {
    expect(resolveFirmEntitlement(input({ trial: lapsed }), T0).source).toBe(
      'none',
    );
  });

  it('grants nothing for an end date with no level recorded', () => {
    // Deliberate, and said out loud on the HQ lever: a date opens the
    // organization, a level decides what it can do, and a trial needs both.
    // KILLS: inventing a default level for a trial that has none, which would
    // be a plan the price table does not describe.
    expect(
      resolveFirmEntitlement(input({ trial: dateButNoLevel }), T0).source,
    ).toBe('none');
  });

  it('grants nothing for a level with no end date', () => {
    // A level with no window never starts, rather than never ending.
    expect(
      resolveFirmEntitlement(input({ trial: levelButNoDate }), T0).source,
    ).toBe('none');
  });

  it('grants nothing for a level the price table does not sell', () => {
    // KILLS: trusting the stored text column. `trial_tier` is text, so it can
    // hold a typo, a renamed rung, or 'free'.
    for (const slug of ['free', 'gold', 'growing-firm', 'GROWING_FIRM', '']) {
      const resolved = resolveFirmEntitlement(
        input({ trial: { trialTierSlug: slug, trialEndsAt: at(30) } }),
        T0,
      );
      expect(resolved.source, `slug ${JSON.stringify(slug)}`).toBe('none');
    }
  });

  it('grants nothing to an organization with no subscription and no trial', () => {
    expect(resolveFirmEntitlement(input(), T0).source).toBe('none');
  });
});

describe('firmAiGateFor', () => {
  function resolved(source: ResolvedEntitlement['source']): ResolvedEntitlement {
    return { source, tier: null, tierSlug: null };
  }

  it('refuses a closed organization as access_ended, not as a billing problem', () => {
    // The distinction is the conversation with the customer: a suspended
    // organization is not one that needs to update a card.
    const gate = firmAiGateFor('export_only', resolved('none'));
    expect(gate).toEqual({ ok: false, reason: 'access_ended' });
  });

  it('reports access_ended even if an entitlement somehow resolved', () => {
    // Belt and braces against the two halves being wired up out of step. KILLS:
    // deriving the reason from the entitlement alone.
    const gate = firmAiGateFor('export_only', resolved('paid'));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('access_ended');
  });

  it('refuses an open organization with no entitlement as no_plan', () => {
    expect(firmAiGateFor('active', resolved('none'))).toEqual({
      ok: false,
      reason: 'no_plan',
    });
  });

  it('admits both a payer and a trial', () => {
    expect(firmAiGateFor('active', resolved('paid')).ok).toBe(true);
    // The line this change exists to make true.
    expect(firmAiGateFor('active', resolved('trial')).ok).toBe(true);
  });
});

describe('the refusal copy and status', () => {
  const reasons: FirmAiRefusal[] = ['access_ended', 'no_plan', 'undetermined'];

  it('says something different for each reason', () => {
    const messages = reasons.map(firmAiRefusalMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(20);
  });

  it('never threatens deletion, in any reason', () => {
    // Matches app/counsel/access-ended/page.tsx: under this design nothing is
    // removed, and the copy is a correctness requirement rather than a style
    // preference.
    for (const m of reasons.map(firmAiRefusalMessage)) {
      expect(m).not.toMatch(/delet|remov|eras|destroy/i);
    }
  });

  it('does not send a transient read failure to the billing page', () => {
    // KILLS: collapsing 'undetermined' into the billing message, which is what
    // the single old sentence did.
    expect(firmAiRefusalMessage('undetermined')).not.toMatch(/billing/i);
    expect(firmAiRefusalMessage('no_plan')).toMatch(/billing/i);
  });

  it('retries only the reason that is the app own fault', () => {
    expect(firmAiRefusalStatus('undetermined')).toBe(503);
    // Unchanged from what these routes already returned, so no client handling
    // has to change.
    expect(firmAiRefusalStatus('access_ended')).toBe(402);
    expect(firmAiRefusalStatus('no_plan')).toBe(402);
  });

  it('throws rather than inventing copy for a reason it has no message for', () => {
    expect(() =>
      firmAiRefusalMessage('lapsed' as unknown as FirmAiRefusal),
    ).toThrow(/no message for the refusal/);
  });
});
