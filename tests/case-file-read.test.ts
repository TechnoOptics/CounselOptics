import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What lib/case-file.ts does when it CANNOT get an answer.
 *
 * The migration adding cases.litigation_mode is written and not applied, so
 * the column-absent branch here is the live path today, not a defensive
 * flourish. Three ways the read can fail, and every one of them must fail
 * CLOSED:
 *
 *   - the column is not there yet (PostgREST 42703)
 *   - the read errors for any other reason
 *   - the service-role client is not configured
 *
 * This is the lesson the phone-signing card taught this repo at its own
 * expense: an absent `signature_methods` column parsed as "unrestricted", so
 * the card rendered, and the mint then failed against a table that did not
 * exist. An absent column defaulting to the permissive answer is a fail-OPEN
 * default, and it must never be the thing that decides whether to offer a
 * surface. Here the permissive answer is "this is a court case, show the
 * workbench", so these tests are the claim that it is never reached by
 * accident.
 *
 * Supabase resolves with `{ error }` and never throws, which is why every
 * case below hands back an error OBJECT rather than rejecting: a try/catch in
 * the module would catch none of this.
 *
 * Mutations, each verified red:
 *   - make CLOSED `{ mode: 'litigation' }`: the error and no-client cases go
 *     red.
 *   - drop the isUnknownColumnError retry: "still answers from the hearing"
 *     goes red.
 *   - report `storable: true` on the fallback path: "does not offer a switch
 *     it cannot write" goes red.
 */

const h = vi.hoisted(() => {
  const s = {
    /** null stands in for a database without the migration. */
    litigationMode: null as boolean | null,
    hearingAt: null as string | null,
    /** True: every select fails the way PostgREST fails an absent column. */
    columnMissing: false,
    /** True: the read fails for some other reason entirely. */
    readBroken: false,
    /** False: SUPABASE_SERVICE_ROLE_KEY is not set. */
    hasAdmin: true,
  };
  /** Every select(...) string the module sent, so ordering can be asserted. */
  const selects: string[] = [];
  return { s, selects };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () =>
    h.s.hasAdmin
      ? {
          from: () => ({
            select: (columns: string) => {
              h.selects.push(columns);
              const node: Record<string, unknown> = {};
              node.eq = () => node;
              node.maybeSingle = async () => {
                if (h.s.readBroken) {
                  return { data: null, error: { code: '08006', message: 'connection failed' } };
                }
                if (h.s.columnMissing && columns.includes('litigation_mode')) {
                  return {
                    data: null,
                    error: {
                      code: '42703',
                      message: 'column cases.litigation_mode does not exist',
                    },
                  };
                }
                const row: Record<string, unknown> = {
                  hearing_at: h.s.hearingAt,
                  hearing_location: null,
                };
                if (columns.includes('litigation_mode')) {
                  row.litigation_mode = h.s.litigationMode;
                }
                return { data: row, error: null };
              };
              return node;
            },
          }),
        }
      : null,
}));

const { getCaseFileState, caseFileIsOpen, caseFileRefusal } = await import(
  '../lib/case-file'
);

beforeEach(() => {
  h.selects.length = 0;
  h.s.litigationMode = null;
  h.s.hearingAt = null;
  h.s.columnMissing = false;
  h.s.readBroken = false;
  h.s.hasAdmin = true;
});

describe('a database that has not run the migration yet', () => {
  beforeEach(() => {
    h.s.columnMissing = true;
  });

  it('still answers, from the hearing, rather than failing the request', async () => {
    h.s.hearingAt = '2026-09-01T09:00:00Z';
    const state = await getCaseFileState('case-1');
    expect(state.mode).toBe('litigation');
    expect(state.source).toBe('hearing');
    // It asked for the column, was refused, and asked again without it.
    expect(h.selects[0]).toContain('litigation_mode');
    expect(h.selects[1]).not.toContain('litigation_mode');
  });

  it('is simple for a matter with no hearing, which is the default anyway', async () => {
    const state = await getCaseFileState('case-1');
    expect(state.mode).toBe('simple');
    expect(state.source).toBe('default');
  });

  it('does not offer a switch it cannot write', async () => {
    // The whole point. `storable: false` is what stops the panel drawing a
    // button whose action would fail at the point of use.
    expect((await getCaseFileState('case-1')).storable).toBe(false);
    h.s.columnMissing = false;
    expect((await getCaseFileState('case-1')).storable).toBe(true);
  });
});

describe('a read that fails outright', () => {
  it('closes the case file rather than opening it', async () => {
    h.s.readBroken = true;
    const state = await getCaseFileState('case-1');
    expect(state.mode).toBe('simple');
    expect(await caseFileIsOpen('case-1')).toBe(false);
    expect(await caseFileRefusal('case-1')).not.toBeNull();
  });

  it('closes it when there is no service-role client at all', async () => {
    h.s.hasAdmin = false;
    expect((await getCaseFileState('case-1')).mode).toBe('simple');
    expect((await getCaseFileState('case-1')).storable).toBe(false);
  });

  it('closes it for a matter id that resolves to no row', async () => {
    // maybeSingle on a miss returns { data: null, error: null }, which is not
    // an error and would sail past a check that only looked at `error`.
    h.s.readBroken = false;
    h.s.columnMissing = false;
    const state = await getCaseFileState('case-1');
    expect(state.mode).toBe('simple');
  });
});

describe('a database that has run it', () => {
  it('opens on an explicit true and closes on an explicit false', async () => {
    h.s.litigationMode = true;
    expect(await caseFileIsOpen('case-1')).toBe(true);
    h.s.litigationMode = false;
    expect(await caseFileIsOpen('case-1')).toBe(false);
  });

  it('lets an explicit false beat a hearing that is still on the record', async () => {
    h.s.litigationMode = false;
    h.s.hearingAt = '2026-09-01T09:00:00Z';
    expect(await caseFileIsOpen('case-1')).toBe(false);
  });

  it('reads the case-file columns in their own request', async () => {
    // Same reason cases.matter_number is read in its own request: PostgREST
    // fails the WHOLE request over one absent column, so folding
    // litigation_mode into the select that fetches the matter would take the
    // matter page down on a database without the migration rather than fall
    // back.
    await getCaseFileState('case-1');
    for (const columns of h.selects) {
      expect(columns).not.toMatch(/\btitle\b|\bsubject_name\b|\bfirm_id\b/);
    }
  });
});
