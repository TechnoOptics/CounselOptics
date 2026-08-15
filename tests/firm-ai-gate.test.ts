import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firm } from '../lib/firm-types';
import type { Subscription } from '../lib/types';

/**
 * The WIRING, as distinct from tests/firm-entitlement.test.ts which tests the
 * rule. Mirrors what tests/tier-trial-uplift.test.ts does for the consumer side.
 *
 * What has to hold: threading the firm trial through the AI gate changed nothing
 * for an organization that pays, and changed exactly two things otherwise. An
 * organization on an HQ trial with a level can now use the routes, and a
 * suspended organization can no longer use them on the strength of its creator's
 * card.
 *
 * The mock is a real fixture rather than a stub of firmEntitlementInputs, so the
 * one read and its key-presence gate are exercised too. Deleting the
 * requireFirmColumns call in that function has to fail a test here.
 */

const ENV: Record<string, string> = {
  STRIPE_PRICE_COUNSEL_SOLO: 'price_counsel_solo_sentinel',
  STRIPE_PRICE_COUNSEL_GROWING: 'price_counsel_growing_sentinel',
};
const savedEnv: Record<string, string | undefined> = {};

type Ref = {
  adminAvailable: boolean;
  firmRow: Record<string, unknown> | null;
  readError: { message: string } | null;
  subscription: Subscription | null;
  subscriptionThrows: boolean;
};

const h = vi.hoisted(() => {
  const ref: Ref = {
    adminAvailable: true,
    firmRow: null,
    readError: null,
    subscription: null,
    subscriptionThrows: false,
  };

  function makeAdmin() {
    return {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: ref.readError ? null : ref.firmRow,
                    error: ref.readError,
                  }),
                };
              },
            };
          },
        };
      },
    };
  }

  return { ref, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => (h.ref.adminAvailable ? h.makeAdmin() : null),
  isServiceRoleConfigured: () => true,
}));

// firm-storage pulls these in at module load. Neither is reached by firmAiGate.
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => null,
  getCurrentUser: async () => null,
  isSupabaseConfigured: () => true,
}));

vi.mock('../lib/storage', () => ({
  getSubscriptionForUser: async () => {
    if (h.ref.subscriptionThrows) throw new Error('subscriptions read failed');
    return h.ref.subscription;
  },
}));

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    userId: 'creator-1',
    status: 'active',
    priceId: null,
    tier: null,
    cancelAtPeriodEnd: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function firm(over: Partial<Firm> = {}): Firm {
  return {
    id: 'firm-1',
    createdBy: 'creator-1',
    ...over,
  } as Firm;
}

/** The three columns firmEntitlementInputs selects, as PostgREST returns them. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trial_ends_at: null,
    suspended_at: null,
    trial_tier: null,
    ...over,
  };
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  h.ref.adminAvailable = true;
  h.ref.firmRow = row();
  h.ref.readError = null;
  h.ref.subscription = null;
  h.ref.subscriptionThrows = false;
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

async function gate(f: Firm = firm()) {
  const { firmAiGate } = await import('../lib/firm-storage');
  return firmAiGate(f);
}

describe('nothing changed for an organization that pays', () => {
  it('admits a firm whose creator is on a live counsel price', async () => {
    h.ref.subscription = sub({ priceId: ENV.STRIPE_PRICE_COUNSEL_SOLO });
    const result = await gate();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entitlement.tierSlug).toBe('solo');
  });

  it('admits a firm whose creator is on a price this build does not know', async () => {
    // The state an unset STRIPE_PRICE_* produces. The old boolean gate admitted
    // it, so this one must too. KILLS: gating on a known tier slug.
    h.ref.subscription = sub({ priceId: 'price_not_in_this_builds_table' });
    const result = await gate();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement.source).toBe('paid');
      expect(result.entitlement.tierSlug).toBeNull();
    }
  });

  it('admits a creator inside a Stripe trial, and refuses a canceled one', async () => {
    h.ref.subscription = sub({ status: 'trialing' });
    expect((await gate()).ok).toBe(true);

    h.ref.subscription = sub({ status: 'canceled' });
    const refused = await gate();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('no_plan');
  });

  it('refuses an organization with no subscription and no trial', async () => {
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_plan');
  });
});

describe('an HQ firm trial now buys what it says it buys', () => {
  it('admits a firm on a live trial with a level, nobody paying', async () => {
    // THE DEFECT THIS CLOSES. Before, this firm could open the counsel shell
    // through firmAccessState and then got 402 from every AI route, because by
    // definition nobody behind a trial is paying.
    h.ref.firmRow = row({
      trial_ends_at: inDays(14),
      trial_tier: 'growing_firm',
    });
    const result = await gate();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement.source).toBe('trial');
      expect(result.entitlement.tierSlug).toBe('growing_firm');
    }
  });

  it('carries the level through, so a Growing Firm pilot differs from a Solo one', async () => {
    h.ref.firmRow = row({ trial_ends_at: inDays(14), trial_tier: 'solo' });
    const solo = await gate();
    h.ref.firmRow = row({
      trial_ends_at: inDays(14),
      trial_tier: 'growing_firm',
    });
    const growing = await gate();

    expect(solo.ok && growing.ok).toBe(true);
    if (solo.ok && growing.ok) {
      expect(solo.entitlement.tierSlug).toBe('solo');
      expect(growing.entitlement.tierSlug).toBe('growing_firm');
    }
  });

  it('refuses a trial clock with no level, as no_plan', async () => {
    h.ref.firmRow = row({ trial_ends_at: inDays(14) });
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_plan');
  });

  it('refuses a lapsed trial as access_ended, not as a billing problem', async () => {
    // The clock closed the organization, so the access state answers first.
    h.ref.firmRow = row({
      trial_ends_at: inDays(-1),
      trial_tier: 'growing_firm',
    });
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('access_ended');
  });

  it('admits a trial on a firm with no creator at all', async () => {
    // KILLS: restoring the old `if (!firm.createdBy) return false` short
    // circuit, which answered the whole question from the subscription and so
    // could never see a trial.
    h.ref.firmRow = row({
      trial_ends_at: inDays(14),
      trial_tier: 'growing_firm',
    });
    const result = await gate(firm({ createdBy: null }));
    expect(result.ok).toBe(true);
  });
});

describe('a suspension now reaches the route handlers', () => {
  it('refuses a suspended organization whose creator is still paying', async () => {
    // THE SECOND DEFECT THIS CLOSES. counselAccessRedirect is a layout gate and
    // a route handler renders no layout, so this organization kept full AI
    // access. KILLS: dropping the access state from the gate.
    h.ref.subscription = sub({ priceId: ENV.STRIPE_PRICE_COUNSEL_SOLO });
    h.ref.firmRow = row({ suspended_at: inDays(-2) });
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('access_ended');
  });

  it('refuses a suspended organization with a future trial end date', async () => {
    // Suspension outranks the dates, per lib/firm-access.ts.
    h.ref.firmRow = row({
      suspended_at: inDays(-2),
      trial_ends_at: inDays(30),
      trial_tier: 'growing_firm',
    });
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('access_ended');
  });
});

describe('what happens when the answer cannot be established', () => {
  it('refuses with undetermined when the firms read fails', async () => {
    // KILLS: catching the throw and yielding an access state, which is the
    // fail-open lib/firm-authz.ts prohibits. Every path out of that catch must
    // be a refusal.
    h.ref.readError = { message: 'connection reset' };
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('undetermined');
  });

  it('refuses with undetermined when the organization does not exist', async () => {
    h.ref.firmRow = null;
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('undetermined');
  });

  it('refuses with undetermined when the select lost the trial_tier column', async () => {
    // KILLS: deleting requireFirmColumns(row, ['trial_tier']) in
    // firmEntitlementInputs, or reading the column as `?? null`. A lenient read
    // reports a provisioned trial as having no level, which looks exactly like
    // an organization nobody set up and is precisely the silent-nothing this
    // whole change removes.
    h.ref.firmRow = { trial_ends_at: inDays(14), suspended_at: null };
    const result = await gate();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('undetermined');
  });

  it('falls back to the subscription alone when there is no admin client', async () => {
    // The one deliberate fail-open, and it reproduces the behaviour this
    // product had before the trial carried a level: a missing service-role key
    // is a deployment fault affecting the whole estate, not a fact about one
    // organization. It must NOT hand out a trial.
    h.ref.adminAvailable = false;
    h.ref.subscription = sub({ priceId: ENV.STRIPE_PRICE_COUNSEL_SOLO });
    expect((await gate()).ok).toBe(true);

    h.ref.subscription = null;
    const refused = await gate();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('no_plan');
  });

  it('treats a failed subscription read as unpaid, and the trial still applies', async () => {
    // Pre-existing posture, preserved: the old gate also swallowed this read.
    // What is new is that a trial can still answer, so a transient
    // subscriptions fault no longer takes a trial organization down with it.
    h.ref.subscriptionThrows = true;
    h.ref.firmRow = row({
      trial_ends_at: inDays(14),
      trial_tier: 'growing_firm',
    });
    const result = await gate();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entitlement.source).toBe('trial');
  });
});
