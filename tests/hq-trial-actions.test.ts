import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The five HQ trial levers in lib/firm-trial-actions.ts.
 *
 * Every export in that module is a public POST endpoint that Next compiles
 * from a 'use server' directive, so the only thing standing between a
 * signed-in non-admin and a commercial control is the first statement of each
 * action. These tests exercise that statement, plus the two preconditions the
 * action names imply.
 *
 * They are plain async functions under the Node environment. The 'use server'
 * directive is an inert string literal to the test transform, so each one is
 * called directly with its three collaborators mocked:
 *
 *   supabase/server -> who is calling
 *   supabase/admin  -> the stored trial state the preconditions read
 *   firm-trials     -> applyTrialAction, the write these must not reach
 *
 * The load-bearing assertion in most cases is NOT the returned value. It is
 * that applyTrialAction was never called: an action that refuses in its
 * message while still writing has failed in the only way that matters.
 */

const auth = vi.hoisted(() => ({
  isAdmin: true,
  user: { id: 'admin-1', email: 'ops@advottic.com' } as
    | { id: string; email: string | null }
    | null,
}));

const db = vi.hoisted(() => ({
  /** What the firms row holds, or null for "no such organization". */
  row: null as { trial_ends_at: string | null } | null,
  /** Set to simulate a read failure rather than an absent row. */
  readError: null as string | null,
  /** Calls to createAdminSupabase, so we can prove the gate runs first. */
  clientRequests: 0,
}));

/**
 * Typed with its argument so `mock.calls[0][0]` is a real value: the tests
 * below assert on what the action HANDED DOWN, not only on what it returned.
 */
const applyTrialAction = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }) as { ok: true }),
);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../lib/security-audit', () => ({
  logSecurityEvent: vi.fn(async () => {}),
}));

vi.mock('../lib/supabase/server', () => ({
  isCurrentUserAdmin: vi.fn(async () => auth.isAdmin),
  getRealCurrentUser: vi.fn(async () => auth.user),
}));

vi.mock('../lib/firm-trials', () => ({ applyTrialAction }));

// Just enough of the chain readTrialSnapshot uses:
// from('firms').select('trial_ends_at').eq('id', id).maybeSingle()
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
}));

import {
  extendTrialAction,
  grantTrialAction,
  resetTrialAction,
  setSeatLimitAction,
  setSuspendedAction,
} from '../lib/firm-trial-actions';

beforeEach(() => {
  auth.isAdmin = true;
  auth.user = { id: 'admin-1', email: 'ops@advottic.com' };
  db.row = { trial_ends_at: null };
  db.readError = null;
  db.clientRequests = 0;
  applyTrialAction.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const FIRM = '11111111-1111-1111-1111-111111111111';
const FUTURE = '2027-01-01T00:00:00.000Z';

/**
 * Every lever, called the way the console calls it. Keeping them in one list
 * means a SIXTH action added later without a gate fails this file the moment
 * it is added here, and leaving it out of the list is a visible omission.
 */
const LEVERS: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ['grantTrialAction', () => grantTrialAction({ firmId: FIRM, days: 14 })],
  ['extendTrialAction', () => extendTrialAction({ firmId: FIRM, days: 14 })],
  ['resetTrialAction', () => resetTrialAction({ firmId: FIRM, days: 14 })],
  ['setSeatLimitAction', () => setSeatLimitAction({ firmId: FIRM, seatLimit: 5 })],
  ['setSuspendedAction', () => setSuspendedAction({ firmId: FIRM, suspended: true })],
];

describe('the admin gate on every HQ trial lever', () => {
  for (const [name, call] of LEVERS) {
    it(`${name} refuses a non-admin and writes nothing`, async () => {
      auth.isAdmin = false;
      db.row = { trial_ends_at: FUTURE };

      const result = await call();

      expect(result.ok).toBe(false);
      expect(applyTrialAction).not.toHaveBeenCalled();
    });

    it(`${name} refuses before it reads anything`, async () => {
      auth.isAdmin = false;

      await call();

      // The gate is the first statement, so a refused caller never reaches the
      // service-role client. This is what fails if the check is moved below a
      // read rather than deleted outright.
      expect(db.clientRequests).toBe(0);
    });
  }

  it('refuses when the admin check passes but nobody is signed in', async () => {
    auth.user = null;
    db.row = { trial_ends_at: FUTURE };

    const result = await extendTrialAction({ firmId: FIRM, days: 7 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });
});

describe('the actor written onto the audit row', () => {
  it('carries the real signed-in identity, both halves', async () => {
    db.row = { trial_ends_at: null };

    await grantTrialAction({ firmId: FIRM, days: 14, note: '  pilot  ' });

    expect(applyTrialAction).toHaveBeenCalledTimes(1);
    expect(applyTrialAction.mock.calls[0]?.[0]).toMatchObject({
      firmId: FIRM,
      actorUserId: 'admin-1',
      actorEmail: 'ops@advottic.com',
      note: 'pilot',
    });
  });
});

describe('the seat limit floor', () => {
  it('refuses zero, because the column refuses zero', async () => {
    // firms_seat_limit_positive is `seat_limit is null or seat_limit > 0`.
    // Passing zero through would surface as 23514, which applyTrialAction
    // reports as "Unavailable. Please try again.", so the operator retries a
    // permanent failure forever.
    const result = await setSeatLimitAction({ firmId: FIRM, seatLimit: 0 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });

  it('refuses a negative limit', async () => {
    const result = await setSeatLimitAction({ firmId: FIRM, seatLimit: -1 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });

  it('accepts one seat, the smallest limit the column allows', async () => {
    const result = await setSeatLimitAction({ firmId: FIRM, seatLimit: 1 });

    expect(result.ok).toBe(true);
    expect(applyTrialAction.mock.calls[0]?.[0]).toMatchObject({
      action: { kind: 'seats_changed', seatLimit: 1 },
    });
  });

  it('still accepts null, which is the only spelling of no limit', async () => {
    const result = await setSeatLimitAction({ firmId: FIRM, seatLimit: null });

    expect(result.ok).toBe(true);
    expect(applyTrialAction.mock.calls[0]?.[0]).toMatchObject({
      action: { kind: 'seats_changed', seatLimit: null },
    });
  });
});

describe('extend requires a date to extend', () => {
  it('refuses an organization with no end date', async () => {
    db.row = { trial_ends_at: null };

    const result = await extendTrialAction({ firmId: FIRM, days: 30 });

    // Without this, applyTrialAction bases the extension on now and files it
    // as action='extended' with previous_value=null: a 30 day trial recorded
    // as an extension of nothing.
    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });

  it('proceeds when there is a date on file', async () => {
    db.row = { trial_ends_at: FUTURE };

    const result = await extendTrialAction({ firmId: FIRM, days: 30 });

    expect(result.ok).toBe(true);
    expect(applyTrialAction.mock.calls[0]?.[0]).toMatchObject({
      action: { kind: 'extended', days: 30 },
    });
  });

  it('refuses when the row cannot be read, rather than assuming no trial', async () => {
    db.readError = 'connection reset';

    const result = await extendTrialAction({ firmId: FIRM, days: 30 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });
});

describe('grant requires there to be no trial yet', () => {
  it('refuses an organization that is already on a clock', async () => {
    db.row = { trial_ends_at: FUTURE };

    const result = await grantTrialAction({ firmId: FIRM, days: 14 });

    // A stale page would otherwise record action='granted' for what is a
    // replacement, cutting a long trial down to the granted length.
    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });

  it('refuses when the row cannot be read, rather than assuming no trial', async () => {
    db.readError = 'connection reset';

    const result = await grantTrialAction({ firmId: FIRM, days: 14 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });

  it('refuses an organization that no longer exists', async () => {
    db.row = null;

    const result = await grantTrialAction({ firmId: FIRM, days: 14 });

    expect(result.ok).toBe(false);
    expect(applyTrialAction).not.toHaveBeenCalled();
  });
});

describe('restart carries no date precondition', () => {
  it('works with no date on file, which is what extend points at', async () => {
    db.row = { trial_ends_at: null };

    const result = await resetTrialAction({ firmId: FIRM, days: 14 });

    expect(result.ok).toBe(true);
    expect(applyTrialAction.mock.calls[0]?.[0]).toMatchObject({
      action: { kind: 'reset', days: 14 },
    });
  });
});

describe('the day bounds', () => {
  for (const days of [0, -1, 366, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`refuses ${String(days)} days`, async () => {
      db.row = { trial_ends_at: null };

      const result = await grantTrialAction({ firmId: FIRM, days });

      expect(result.ok).toBe(false);
      expect(applyTrialAction).not.toHaveBeenCalled();
    });
  }
});
