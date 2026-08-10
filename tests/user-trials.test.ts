import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The write path in lib/user-trials.ts, which had no test of its own.
 *
 * It carries the same two silent failures the organization side did, for the
 * same reasons, and this file mirrors tests/firm-trials.test.ts deliberately
 * rather than inventing a second shape:
 *
 *   1. PostgREST does not raise an error when an UPDATE matches no row, so a
 *      write that changed nothing reported success and filed an audit row.
 *   2. profiles.is_blocked outranks the trial the same way a firm's
 *      suspended_at does. A blocked account is signed straight back out at
 *      app/auth/callback/route.ts:253, so extending its trial moves a date
 *      nobody behind that account can reach.
 *
 * Each test names the mutation it dies under.
 */

type Ref = {
  profileRow: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  /**
   * What the UPDATE returns when its rows are read back. An empty array is the
   * case this fixture exists for.
   */
  updateRows: Array<Record<string, unknown>>;
  updateError: { message: string } | null;
};

const h = vi.hoisted(() => {
  const ref: Ref = {
    profileRow: null,
    updates: [],
    audits: [],
    updateRows: [{ id: 'user-1', is_blocked: false }],
    updateError: null,
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
                    data: ref.profileRow,
                    error: null,
                  }),
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(..._args: unknown[]) {
                ref.updates.push(patch);
                return {
                  /**
                   * WITHOUT `.select()` THERE IS NO DATA. supabase-js resolves
                   * an update to `{ data: null }` unless the rows are asked
                   * for. Reproducing that is the point: a mock that handed
                   * rows back either way would let the read-back be deleted
                   * from the production code with every test here still green.
                   */
                  then: (
                    resolve: (value: {
                      data: null;
                      error: { message: string } | null;
                    }) => unknown,
                    reject?: (reason: unknown) => unknown,
                  ) =>
                    Promise.resolve({
                      data: null,
                      error: ref.updateError,
                    }).then(resolve, reject),
                  select: async () => ({
                    data: ref.updateRows,
                    error: ref.updateError,
                  }),
                };
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
  createAdminSupabase: () => h.makeAdmin(),
  isServiceRoleConfigured: () => true,
}));

// lib/user-trials.ts imports these for its read paths. Neither is reached by
// the write tests below, but a static named import of an absent export fails
// at binding time.
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => null,
}));

import { applyUserTrialAction } from '../lib/user-trials';

const LAPSED = '2000-01-01T00:00:00.000Z';

function extend(days: number) {
  return {
    userId: 'user-1',
    actorUserId: 'admin-1',
    actorEmail: 'ops@advottic.com',
    action: { kind: 'extended' as const, days },
    note: null,
  };
}

function profileOnALapsedTrial(isBlocked = false) {
  return { trial_ends_at: LAPSED, trial_tier: 'plus', is_blocked: isBlocked };
}

beforeEach(() => {
  h.ref.profileRow = null;
  h.ref.updates = [];
  h.ref.audits = [];
  h.ref.updateRows = [{ id: 'user-1', is_blocked: false }];
  h.ref.updateError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('applyUserTrialAction reports what actually landed', () => {
  it('refuses when the update matched no row, instead of reporting success', async () => {
    // The mutation this kills: drop the `.select(...)` from the update in
    // applyUserTrialAction and delete the zero-row branch.
    h.ref.profileRow = profileOnALapsedTrial();
    h.ref.updateRows = [];

    const result = await applyUserTrialAction(extend(30));

    expect(result.ok).toBe(false);
  });

  it('writes no audit row for a change that did not land', async () => {
    // Separate on purpose. A trail recording an extension nobody received lies
    // in the affirmative direction, and that would survive a fix that only
    // corrected the return value.
    h.ref.profileRow = profileOnALapsedTrial();
    h.ref.updateRows = [];

    await applyUserTrialAction(extend(30));

    expect(h.ref.audits).toHaveLength(0);
  });

  it('reports the block the extension did not lift', async () => {
    // A blocked account is signed back out at the auth callback, so the date
    // moves and nobody behind that account sees anything.
    //
    // The mutation this kills: return a bare `{ ok: true }` from the tail.
    h.ref.profileRow = profileOnALapsedTrial(true);
    h.ref.updateRows = [{ id: 'user-1', is_blocked: true }];

    const result = await applyUserTrialAction(extend(30));

    expect(result).toEqual({ ok: true, blocked: true });
  });

  it('reports no block for an account that is merely lapsed', async () => {
    // The other half, so the field above cannot be hardcoded true.
    h.ref.profileRow = profileOnALapsedTrial();
    h.ref.updateRows = [{ id: 'user-1', is_blocked: false }];

    const result = await applyUserTrialAction(extend(30));

    expect(result).toEqual({ ok: true, blocked: false });
  });

  it('reads the block back from the row it wrote, not the row it read first', async () => {
    // Unblocking and extending are separate levers on the same HQ page with
    // nothing serialising them, so the answer that reaches the operator has to
    // be the state after this write.
    h.ref.profileRow = profileOnALapsedTrial(true);
    h.ref.updateRows = [{ id: 'user-1', is_blocked: false }];

    const result = await applyUserTrialAction(extend(30));

    expect(result).toEqual({ ok: true, blocked: false });
  });

  it('still extends from the stored end date rather than today', async () => {
    // Pins the behaviour the read-back must not disturb: extend adds to the
    // date on file, which is what makes it different from restart.
    h.ref.profileRow = profileOnALapsedTrial();

    const result = await applyUserTrialAction(extend(30));

    expect(result.ok).toBe(true);
    expect(h.ref.updates).toEqual([
      {
        trial_ends_at: new Date(
          Date.parse(LAPSED) + 30 * 86_400_000,
        ).toISOString(),
      },
    ]);
  });
});
