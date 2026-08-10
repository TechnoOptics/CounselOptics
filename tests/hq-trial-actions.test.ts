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
  /**
   * What the firms row holds, or null for "no such organization". Typed as
   * a bare record, not `{ trial_ends_at: string | null }`, so a test can set
   * it to `{}`: a truthy row that is missing the column entirely, which is
   * different from a row that carries the column set to null.
   */
  row: null as Record<string, unknown> | null,
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
  vi.fn(
    async (_input: Record<string, unknown>) =>
      ({ ok: true, suspended: false }) as { ok: true; suspended: boolean },
  ),
);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * The durable half of the refusal trace. Hoisted so the assertions below can
 * read what was actually recorded, rather than only that something was.
 */
const logSecurityEvent = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => {}),
);

vi.mock('../lib/security-audit', () => ({ logSecurityEvent }));

vi.mock('../lib/supabase/server', () => ({
  isCurrentUserAdmin: vi.fn(async () => auth.isAdmin),
  getRealCurrentUser: vi.fn(async () => auth.user),
}));

/**
 * PARTIAL mock, and the partiality is load-bearing. `applyTrialAction` is the
 * write these tests must prove was never reached, so it is replaced.
 * `readTrialSnapshot` is the PRECONDITION those same tests exercise, and it
 * now lives in this module rather than beside the actions. Replacing it too
 * would leave every precondition case asserting against a stub, and the
 * mutation that closed the last fail-open in it (a truthy row with no
 * trial_ends_at key reading as "no trial") would stop being caught by
 * anything. So the real one runs, against the mocked admin client below.
 */
vi.mock('../lib/firm-trials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/firm-trials')>()),
  applyTrialAction,
}));

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
  // lib/firm-trials.ts imports this for its missing-admin log line. Never
  // reached here, since the admin client above is always available, but a
  // static named import of an absent export fails at binding time.
  isServiceRoleConfigured: () => true,
}));

import {
  extendTrialAction,
  grantTrialAction,
  resetTrialAction,
  setSeatLimitAction,
  setSuspendedAction,
  setTrialTierAction,
} from '../lib/firm-trial-actions';

beforeEach(() => {
  auth.isAdmin = true;
  auth.user = { id: 'admin-1', email: 'ops@advottic.com' };
  db.row = { trial_ends_at: null };
  db.readError = null;
  db.clientRequests = 0;
  applyTrialAction.mockClear();
  logSecurityEvent.mockClear();
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
  [
    'setTrialTierAction',
    () => setTrialTierAction({ firmId: FIRM, tierSlug: 'growing_firm' }),
  ],
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

  /**
   * A REFUSED ATTEMPT ON A COMMERCIAL CONTROL HAS TO STAY OPEN FOR TRIAGE.
   *
   * The severity is not decorative. lib/security-audit.ts auto-acknowledges
   * exactly one value, 'low', which is also what an omitted severity defaults
   * to, so 'low' would file this straight into the closed pile. 'medium' is
   * the lowest value that reaches the queue an operator actually reads.
   */
  it('records the refused attempt where somebody will triage it', async () => {
    auth.isAdmin = false;
    auth.user = { id: 'user-9', email: 'curious@example.com' };

    await grantTrialAction({ firmId: FIRM, days: 14 });

    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0]?.[0];
    expect(event?.kind).toBe('hq_trial_action_denied');
    expect(event?.severity).toBe('medium');
    // Named explicitly: 'low' is the auto-acknowledged value, and an omitted
    // severity defaults to it.
    expect(event?.severity).not.toBe('low');
    expect(event?.severity).not.toBeUndefined();
    expect(event?.userId).toBe('user-9');
  });

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

  it('refuses a truthy row that is missing the trial_ends_at column, rather than treating the missing key as no trial', async () => {
    // `{}` is a row object, so the "no such organization" branch above does
    // not fire. `row.trial_ends_at ?? null` would read the missing key the
    // same as a present null and let grant proceed, which is the fail-open
    // direction this precondition exists to prevent.
    db.row = {};

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

/**
 * THE DEFECT THE OWNER SAW: an extension that reports success and changes
 * nothing the firm can see.
 *
 * Suspension outranks every date in lib/firm-access.ts, and that ordering is
 * deliberate: a date change must not silently reopen an organization somebody
 * closed on purpose. What was wrong is that the reverse was silent too. The
 * write landed, HQ said it worked, and the firm stayed shut out.
 *
 * The choice made here is to COMPLETE the change and report it, rather than to
 * refuse. Refusing would leave the agreed end date unrecorded, and it would
 * make restoring access the only route to extending a suspended organization,
 * which is the precedence inverted through the workflow instead of the code.
 */
describe('an extension that will not reopen the organization says so', () => {
  it('completes the extension on a suspended organization', async () => {
    db.row = { trial_ends_at: FUTURE };
    applyTrialAction.mockResolvedValueOnce({ ok: true, suspended: true });

    const result = await extendTrialAction({ firmId: FIRM, days: 14 });

    // The date is the commercial record of what was agreed. Refusing to write
    // it would be the other way to get this wrong.
    expect(result.ok).toBe(true);
    expect(applyTrialAction).toHaveBeenCalledTimes(1);
  });

  it('names the suspension and the remedy in the result', async () => {
    // The mutation this kills: return a bare `{ ok: true }` from
    // extendTrialAction's tail, which is what it did before.
    db.row = { trial_ends_at: FUTURE };
    applyTrialAction.mockResolvedValueOnce({ ok: true, suspended: true });

    const result = await extendTrialAction({ firmId: FIRM, days: 14 });

    expect(result).toEqual({
      ok: true,
      notice:
        'The end date was saved, but this organization is suspended, so it stays closed and nobody there will see a change. Restore access to reopen it.',
    });
  });

  it('says nothing extra when the extension does reopen the organization', async () => {
    // The other half. Without it the notice could be hardcoded and every
    // ordinary extension would claim a suspension that is not there.
    db.row = { trial_ends_at: FUTURE };
    applyTrialAction.mockResolvedValueOnce({ ok: true, suspended: false });

    const result = await extendTrialAction({ firmId: FIRM, days: 14 });

    expect(result).toEqual({ ok: true });
  });

  it('reports the same thing for a restart, which is the other date lever', async () => {
    db.row = { trial_ends_at: FUTURE };
    applyTrialAction.mockResolvedValueOnce({ ok: true, suspended: true });

    const result = await resetTrialAction({ firmId: FIRM, days: 14 });

    expect(result).toMatchObject({ ok: true });
    expect('notice' in result && result.notice).toMatch(/suspended/);
  });

  it('carries no notice when the write itself failed', async () => {
    // A refusal must not arrive wearing a success message beside it.
    db.row = { trial_ends_at: FUTURE };
    applyTrialAction.mockResolvedValueOnce({
      ok: false,
      error: 'That change did not save. Nothing was written. Try again.',
    } as never);

    const result = await extendTrialAction({ firmId: FIRM, days: 14 });

    expect(result).toEqual({
      ok: false,
      error: 'That change did not save. Nothing was written. Try again.',
    });
  });
});
