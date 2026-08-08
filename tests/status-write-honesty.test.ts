import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A status change that did not happen must not be reported as one.
 *
 * `updateCaseStatus` used to run `.update({ status }).eq('id', caseId)` with no
 * `.select()` and check only `error`. postgrest-js does not set an error when
 * an UPDATE matches zero rows, and `cases_update_own` is `auth.uid() =
 * user_id` while `cases` SELECT is membership-wide, so any caller who can see
 * a case without owning it wrote nothing and was told it worked. The audit
 * entry that followed is covered in tests/status-audit-order.test.ts; this
 * file pins the write.
 *
 * Mutations this is meant to catch:
 *   - delete `.select('id')`  -> "asks which rows it wrote" goes red.
 *   - delete the zero-row throw -> "refuses when nothing was written" goes red.
 *
 * The two are separate assertions on purpose. Removing only the `.select()`
 * would still leave `rows` undefined and still throw, so a single "it rejects"
 * test would stay green for the wrong reason and the guard would quietly
 * become an accident.
 */

type Recorded = {
  /** Did the code ask the database which rows it actually wrote? */
  selected: boolean;
  /** Rows the fake reports back as affected. */
  rows: Array<{ id: string }>;
};

const h = vi.hoisted(() => {
  const rec: { current: Recorded } = {
    current: { selected: false, rows: [] },
  };

  /**
   * A postgrest-js shaped fake, faithful on the one point that matters: the
   * builder returned by `.eq()` is itself awaitable AND carries `.select()`.
   * That is why the original defect compiled and ran. Awaiting without
   * selecting resolves clean with nothing to inspect, exactly as the real
   * client does.
   */
  function makeClient() {
    const settle = (withRows: boolean) => ({
      data: withRows ? rec.current.rows : null,
      error: null,
    });
    const builder = (): Record<string, unknown> => ({
      eq: () => builder(),
      select: () => {
        rec.current.selected = true;
        return Promise.resolve(settle(true));
      },
      then: (resolve: (v: unknown) => unknown) => resolve(settle(false)),
    });
    // updateWitnessStatement re-reads its row first to check the caller is the
    // witness on it. That read is a different gate from the write, which is
    // the whole point, so it is a separate branch of the fake and never sets
    // `selected`.
    const readBack = {
      eq: () => ({
        maybeSingle: async () => ({
          data: { user_id: 'user-1', role: 'witness', email: 'a@example.com' },
        }),
      }),
    };
    return {
      from: () => ({ update: () => builder(), select: () => readBack }),
    };
  }

  return { rec, makeClient };
});

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => h.makeClient(),
  requireUser: async () => ({ id: 'user-1' }),
}));

const { updateCaseStatus, updateCaseHearing, updateWitnessStatement, saveExhibitScan } =
  await import('../lib/storage');

beforeEach(() => {
  h.rec.current = { selected: false, rows: [] };
});

describe('updateCaseStatus knows whether it wrote', () => {
  it('asks the database which rows it wrote', async () => {
    h.rec.current.rows = [{ id: 'case-1' }];
    await updateCaseStatus('case-1', 'closed');
    expect(h.rec.current.selected).toBe(true);
  });

  it('refuses when the update matched no row', async () => {
    h.rec.current.rows = [];
    await expect(updateCaseStatus('case-1', 'closed')).rejects.toThrow();
  });

  it('returns normally when the row was written', async () => {
    h.rec.current.rows = [{ id: 'case-1' }];
    await expect(updateCaseStatus('case-1', 'closed')).resolves.toBeUndefined();
  });
});

/**
 * The same shape, found in the same sweep, on the two other writes whose
 * callers make a claim on the strength of them returning: the hearing update
 * (audit entry `hearing_updated`, plus a reminder email to every collaborator)
 * and the witness statement (audit entry `witness_statement_updated`).
 *
 * The witness one is the starker of the two. The function reads the row
 * through the SELECT policy to check ownership and then writes through the
 * UPDATE policy, which is a different gate; in the schema committed to this
 * repo `case_collaborators` has no UPDATE policy at all.
 */
describe('the sibling writes that feed the audit chain know too', () => {
  const cases = [
    ['updateCaseHearing', () =>
      updateCaseHearing({
        caseId: 'case-1',
        hearingAt: null,
        hearingLocation: null,
        hearingNotes: null,
      })],
    ['updateWitnessStatement', () =>
      updateWitnessStatement({ collaboratorId: 'collab-1', statement: 'I saw it.' })],
    ['saveExhibitScan', () =>
      saveExhibitScan('exhibit-1', { summary: 's', modelUsed: 'm' } as never)],
  ] as const;

  for (const [name, run] of cases) {
    it(`${name} refuses when the update matched no row`, async () => {
      h.rec.current.rows = [];
      await expect(run()).rejects.toThrow();
    });

    it(`${name} asks which rows it wrote`, async () => {
      h.rec.current.rows = [{ id: 'row-1' }];
      await run();
      expect(h.rec.current.selected).toBe(true);
    });
  }
});
