import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the two failures in lib/firm-trials.ts that are silent by nature:
 * the deliberate fail-open when there is no admin client, and the write path
 * reading a firms row that lost a column.
 *
 * Both suites are written to die under a specific mutation, and each mutation
 * is named in the test it kills. A test that still passes with the guard
 * deleted is not testing the guard.
 */

type Ref = {
  adminAvailable: boolean;
  serviceRoleConfigured: boolean;
  firmRow: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
};

const h = vi.hoisted(() => {
  const ref: Ref = {
    adminAvailable: true,
    serviceRoleConfigured: true,
    firmRow: null,
    updates: [],
    audits: [],
  };

  function makeAdmin() {
    return {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: ref.firmRow,
                    error: null,
                  }),
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: async () => {
                ref.updates.push(patch);
                return { error: null };
              },
            };
          },
          insert: async (row: Record<string, unknown>) => {
            ref.audits.push({ table, ...row });
            return { error: null };
          },
        };
      },
    };
  }

  return { ref, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => (h.ref.adminAvailable ? h.makeAdmin() : null),
  isServiceRoleConfigured: () => h.ref.serviceRoleConfigured,
}));

/**
 * The log-once latches are module level, so every test that counts log lines
 * needs its own copy of the module. Importing fresh is what makes "once" mean
 * once per process rather than once per test run.
 */
async function freshModule() {
  vi.resetModules();
  return import('../lib/firm-trials');
}

const DAY_MS = 86_400_000;

function extend(days: number) {
  return {
    firmId: 'firm-1',
    actorUserId: 'admin-1',
    actorEmail: 'admin@example.com',
    action: { kind: 'extended' as const, days },
    note: null,
  };
}

beforeEach(() => {
  h.ref.adminAvailable = true;
  h.ref.serviceRoleConfigured = true;
  h.ref.firmRow = null;
  h.ref.updates = [];
  h.ref.audits = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the missing admin client is announced, exactly once', () => {
  it('logs one line for two firmTrialState calls, not two and not zero', async () => {
    h.ref.adminAvailable = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { firmTrialState } = await freshModule();

    // The fail-open itself is approved and stays. What is under test is that
    // it is audible.
    expect(await firmTrialState('firm-1')).toBe('active');
    expect(await firmTrialState('firm-2')).toBe('active');

    // Zero kills the "no logging at all" state this started in. Two kills the
    // unlatched console.error that would fire on every request.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/enforcement is OFF/);
  });

  it('logs one line for two listTrialFirms calls, and still returns an empty list', async () => {
    h.ref.adminAvailable = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { listTrialFirms } = await freshModule();

    expect(await listTrialFirms()).toEqual([]);
    expect(await listTrialFirms()).toEqual([]);

    expect(logged).toHaveBeenCalledTimes(1);
    // The empty list must not read as "no organization is on a trial".
    expect(String(logged.mock.calls[0][0])).toMatch(/UNREADABLE/);
  });

  it('keeps the two latches independent, so neither surface swallows the other', async () => {
    h.ref.adminAvailable = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { firmTrialState, listTrialFirms } = await freshModule();

    await listTrialFirms();
    await firmTrialState('firm-1');

    // Collapsing these into one shared boolean would drop this to 1.
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('names the service-role key when that is what is missing', async () => {
    h.ref.adminAvailable = false;
    h.ref.serviceRoleConfigured = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { firmTrialState } = await freshModule();

    await firmTrialState('firm-1');
    expect(String(logged.mock.calls[0][1])).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('points at the Supabase URL when the key is present', async () => {
    h.ref.adminAvailable = false;
    h.ref.serviceRoleConfigured = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { firmTrialState } = await freshModule();

    await firmTrialState('firm-1');
    expect(String(logged.mock.calls[0][1])).toMatch(/Supabase URL/);
  });
});

describe('applyTrialAction refuses a firms row that lost a column', () => {
  it('throws on an extend when trial_ends_at is absent, rather than granting today plus N', async () => {
    // The mutation this kills: delete the requireFirmColumns call in
    // applyTrialAction. Without it, prev.trial_ends_at is undefined, the
    // extend branch falls through to Date.now(), and the action succeeds
    // having quietly turned itself into a reset.
    h.ref.firmRow = { suspended_at: null, seat_limit: 5 };
    const { applyTrialAction } = await freshModule();

    await expect(applyTrialAction(extend(30))).rejects.toThrow(/trial_ends_at/);

    // The refusal has to happen before anything lands. A throw after the
    // update would still leave the larger grant in the table.
    expect(h.ref.updates).toHaveLength(0);
    expect(h.ref.audits).toHaveLength(0);
  });

  it('throws when seat_limit is absent, so previous_value cannot be invented', async () => {
    h.ref.firmRow = { trial_ends_at: null, suspended_at: null };
    const { applyTrialAction } = await freshModule();

    await expect(
      applyTrialAction({
        firmId: 'firm-1',
        actorUserId: 'admin-1',
        actorEmail: 'admin@example.com',
        action: { kind: 'seats_changed', seatLimit: 10 },
        note: null,
      }),
    ).rejects.toThrow(/seat_limit/);

    expect(h.ref.updates).toHaveLength(0);
    expect(h.ref.audits).toHaveLength(0);
  });
});

describe('extending a trial reads the stored end date, not a truthy one', () => {
  it('refuses an unparseable stored trial_ends_at instead of extending from today', async () => {
    // The mutation this kills on its own: revert the base to
    // `prev.trial_ends_at ? ... : Date.now()`. An empty string is present and
    // therefore not "no trial", but it is falsy, so truthiness silently grants
    // today plus 30.
    h.ref.firmRow = { trial_ends_at: '', suspended_at: null, seat_limit: null };
    const { applyTrialAction } = await freshModule();

    const result = await applyTrialAction(extend(30));

    expect(result.ok).toBe(false);
    expect(h.ref.updates).toHaveLength(0);
    expect(h.ref.audits).toHaveLength(0);
  });

  it('extends from a lapsed end date, so a stale trial does not restart at today', async () => {
    const lapsed = '2000-01-01T00:00:00.000Z';
    h.ref.firmRow = {
      trial_ends_at: lapsed,
      suspended_at: null,
      seat_limit: null,
    };
    const { applyTrialAction } = await freshModule();

    const result = await applyTrialAction(extend(30));

    expect(result.ok).toBe(true);
    expect(h.ref.updates).toEqual([
      { trial_ends_at: new Date(Date.parse(lapsed) + 30 * DAY_MS).toISOString() },
    ]);
    // The audit row states what was actually there before, which is the claim
    // the affirmative-direction argument rests on.
    expect(h.ref.audits[0].previous_value).toBe(lapsed);
  });

  it('extends from today only when there is genuinely no trial end', async () => {
    h.ref.firmRow = {
      trial_ends_at: null,
      suspended_at: null,
      seat_limit: null,
    };
    const { applyTrialAction } = await freshModule();

    const before = Date.now();
    const result = await applyTrialAction(extend(30));
    const after = Date.now();

    expect(result.ok).toBe(true);
    const written = Date.parse(
      h.ref.updates[0].trial_ends_at as string,
    );
    expect(written).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(written).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect(h.ref.audits[0].previous_value).toBeNull();
  });
});
