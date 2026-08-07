import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The five HQ trial levers for an individual user, in
 * lib/user-trial-actions.ts.
 *
 * Every export in that module is a public POST endpoint that Next compiles
 * from a 'use server' directive, so the only thing standing between a
 * signed-in non-admin and a commercial control is the first statement of each
 * action. These tests exercise that statement, the preconditions the action
 * names imply, and the one thing this surface adds over the organization one:
 * a plan level that has to come from the entitlements table.
 *
 * The load-bearing assertion in most cases is NOT the returned value. It is
 * that applyUserTrialAction was never called: an action that refuses in its
 * message while still writing has failed in the only way that matters.
 */

const auth = vi.hoisted(() => ({
  isAdmin: true,
  user: { id: 'admin-1', email: 'ops@advottic.com' } as
    | { id: string; email: string | null }
    | null,
}));

const db = vi.hoisted(() => ({
  /**
   * What the profiles row holds, or null for "no such user". Typed as a bare
   * record so a test can set it to `{}`: a truthy row missing the column
   * entirely, which is different from a row carrying it set to null.
   */
  row: null as Record<string, unknown> | null,
  readError: null as string | null,
  /** Calls to createAdminSupabase, so we can prove the gate runs first. */
  clientRequests: 0,
}));

const applyUserTrialAction = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }) as { ok: true }),
);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const logSecurityEvent = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => {}),
);

vi.mock('../lib/security-audit', () => ({ logSecurityEvent }));

vi.mock('../lib/supabase/server', () => ({
  isCurrentUserAdmin: vi.fn(async () => auth.isAdmin),
  getRealCurrentUser: vi.fn(async () => auth.user),
}));

/**
 * PARTIAL mock, and the partiality is load-bearing. applyUserTrialAction is
 * the write these tests prove was never reached, so it is replaced.
 * readUserTrialSnapshot is the PRECONDITION the same tests exercise, so the
 * real one runs against the mocked admin client below. Replacing it too would
 * leave every precondition case asserting against a stub.
 */
vi.mock('../lib/user-trials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/user-trials')>()),
  applyUserTrialAction,
}));

// Just enough of the chain readUserTrialSnapshot uses:
// from('profiles').select('trial_ends_at').eq('id', id).maybeSingle()
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    db.clientRequests += 1;
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              db.readError
                ? { data: null, error: { message: db.readError } }
                : { data: db.row, error: null },
          }),
        }),
      }),
    };
  },
  isServiceRoleConfigured: () => true,
}));

import {
  clearUserTrialAction,
  extendUserTrialAction,
  grantUserTrialAction,
  resetUserTrialAction,
  setUserTrialTierAction,
} from '../lib/user-trial-actions';
import { ENTITLEMENT_TIER_SLUGS } from '../lib/entitlements';

beforeEach(() => {
  auth.isAdmin = true;
  auth.user = { id: 'admin-1', email: 'ops@advottic.com' };
  db.row = { trial_ends_at: null };
  db.readError = null;
  db.clientRequests = 0;
  applyUserTrialAction.mockClear();
  logSecurityEvent.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const USER = '22222222-2222-2222-2222-222222222222';
const FUTURE = '2027-01-01T00:00:00.000Z';

/**
 * Every lever, called the way the console calls it. Keeping them in one list
 * means a SIXTH action added later without a gate fails this file the moment
 * it is added here, and leaving it out of the list is a visible omission.
 */
const LEVERS: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ['grantUserTrialAction', () => grantUserTrialAction({ userId: USER, days: 14 })],
  ['extendUserTrialAction', () => extendUserTrialAction({ userId: USER, days: 14 })],
  ['resetUserTrialAction', () => resetUserTrialAction({ userId: USER, days: 14 })],
  [
    'setUserTrialTierAction',
    () => setUserTrialTierAction({ userId: USER, tierSlug: 'plus' }),
  ],
  ['clearUserTrialAction', () => clearUserTrialAction({ userId: USER })],
];

describe('the admin gate on every HQ user trial lever', () => {
  for (const [name, call] of LEVERS) {
    it(`${name} refuses a non-admin and writes nothing`, async () => {
      auth.isAdmin = false;
      db.row = { trial_ends_at: FUTURE };

      const result = await call();

      expect(result.ok).toBe(false);
      expect(applyUserTrialAction).not.toHaveBeenCalled();
    });

    it(`${name} refuses before it reads anything`, async () => {
      auth.isAdmin = false;

      await call();

      // The gate is the first statement, so a refused caller never reaches
      // the service-role client. This is what fails if the check is moved
      // below a read rather than deleted outright.
      expect(db.clientRequests).toBe(0);
    });
  }

  /**
   * The severity is not decorative. lib/security-audit.ts auto-acknowledges
   * exactly one value, 'low', which is also what an omitted severity defaults
   * to, so 'low' would file this straight into the closed pile.
   */
  it('records the refused attempt where somebody will triage it', async () => {
    auth.isAdmin = false;
    auth.user = { id: 'user-9', email: 'curious@example.com' };

    await grantUserTrialAction({ userId: USER, days: 14 });

    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0]?.[0];
    expect(event?.kind).toBe('hq_trial_action_denied');
    expect(event?.severity).toBe('medium');
    expect(event?.severity).not.toBe('low');
    expect(event?.userId).toBe('user-9');
  });

  it('refuses when the admin check passes but nobody is signed in', async () => {
    auth.user = null;
    db.row = { trial_ends_at: FUTURE };

    const result = await extendUserTrialAction({ userId: USER, days: 7 });

    expect(result.ok).toBe(false);
    expect(applyUserTrialAction).not.toHaveBeenCalled();
  });
});

describe('extend and restart stay different actions', () => {
  it('extend refuses when there is no end date to move', async () => {
    db.row = { trial_ends_at: null };

    const result = await extendUserTrialAction({ userId: USER, days: 7 });

    expect(result.ok).toBe(false);
    // Without this precondition, applyUserTrialAction falls back to now and
    // files a fresh trial as action='extended' with previous_value=null: an
    // extension of nothing, recorded as though something were extended.
    expect(applyUserTrialAction).not.toHaveBeenCalled();
  });

  it('grant refuses when a clock is already running', async () => {
    db.row = { trial_ends_at: FUTURE };

    const result = await grantUserTrialAction({ userId: USER, days: 14 });

    expect(result.ok).toBe(false);
    expect(applyUserTrialAction).not.toHaveBeenCalled();
  });

  it('restart replaces the date and says so in the audit kind', async () => {
    db.row = { trial_ends_at: FUTURE };

    const result = await resetUserTrialAction({ userId: USER, days: 30 });

    expect(result.ok).toBe(true);
    expect(applyUserTrialAction.mock.calls[0]?.[0]?.action).toEqual({
      kind: 'reset',
      days: 30,
    });
  });

  it('records the actor on every write, both halves', async () => {
    db.row = { trial_ends_at: FUTURE };

    await extendUserTrialAction({ userId: USER, days: 7, note: '  agreed on call  ' });

    const sent = applyUserTrialAction.mock.calls[0]?.[0];
    expect(sent?.actorUserId).toBe('admin-1');
    expect(sent?.actorEmail).toBe('ops@advottic.com');
    expect(sent?.note).toBe('agreed on call');
  });
});

describe('the plan level comes from the entitlements table or not at all', () => {
  it('accepts every level the price table defines', async () => {
    for (const slug of ENTITLEMENT_TIER_SLUGS) {
      applyUserTrialAction.mockClear();
      db.row = { trial_ends_at: FUTURE };

      const result = await setUserTrialTierAction({ userId: USER, tierSlug: slug });

      expect(result.ok).toBe(true);
      expect(applyUserTrialAction.mock.calls[0]?.[0]?.action).toEqual({
        kind: 'tier_changed',
        tierSlug: slug,
      });
    }
  });

  it('refuses a level nobody sells, and writes nothing', async () => {
    // MUTATION: drop the isEntitlementTierSlug branch of readTierSlug in
    // lib/user-trial-actions.ts so the value passes through. Every case here
    // goes red, because each would then be stored as a plan level.
    for (const bogus of ['unlimited', 'free', 'PLUS', 'growing firm', 7, {}]) {
      applyUserTrialAction.mockClear();
      db.row = { trial_ends_at: FUTURE };

      const result = await setUserTrialTierAction({
        userId: USER,
        tierSlug: bogus as never,
      });

      expect(result.ok).toBe(false);
      expect(applyUserTrialAction).not.toHaveBeenCalled();
    }
  });

  it('refuses a level on an account with no trial window', async () => {
    // A level with no end date grants nothing, so storing one would report
    // success for a change with no effect.
    db.row = { trial_ends_at: null };

    const result = await setUserTrialTierAction({ userId: USER, tierSlug: 'plus' });

    expect(result.ok).toBe(false);
    expect(applyUserTrialAction).not.toHaveBeenCalled();
  });

  it('clears the level without needing a trial window', async () => {
    db.row = { trial_ends_at: null };

    const result = await setUserTrialTierAction({ userId: USER, tierSlug: null });

    expect(result.ok).toBe(true);
    expect(applyUserTrialAction.mock.calls[0]?.[0]?.action).toEqual({
      kind: 'tier_changed',
      tierSlug: null,
    });
  });
});

describe('clearing a trial', () => {
  it('takes the account off the clock and records who did it', async () => {
    db.row = { trial_ends_at: FUTURE };

    const result = await clearUserTrialAction({ userId: USER, note: 'granted in error' });

    expect(result.ok).toBe(true);
    const sent = applyUserTrialAction.mock.calls[0]?.[0];
    expect(sent?.action).toEqual({ kind: 'cleared' });
    expect(sent?.actorUserId).toBe('admin-1');
    expect(sent?.note).toBe('granted in error');
  });
});

describe('the day count', () => {
  for (const bad of [0, -1, 366, 1.5, Number.NaN, Infinity, '14' as never, null as never]) {
    it(`refuses ${String(bad)} days and writes nothing`, async () => {
      db.row = { trial_ends_at: null };

      const result = await grantUserTrialAction({ userId: USER, days: bad as number });

      expect(result.ok).toBe(false);
      expect(applyUserTrialAction).not.toHaveBeenCalled();
    });
  }
});
