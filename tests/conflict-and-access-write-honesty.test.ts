import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three writes whose success message is the whole product: a conflicts
 * check that was recorded, a conflict that was cleared with a written
 * reason, and a departed employee who is actually deprovisioned.
 *
 * All three ran unread. PostgREST answers a zero-row UPDATE with
 * `error: null`, and a write with no `.select()` resolves `data: null`
 * besides, so each of them could report success having changed nothing.
 * The conflicts writes go through the MEMBER client, and lib/conflict-check
 * itself documents that a portal employee is not a firm_member and is
 * refused by this table's policy, so a filtered-to-zero write there is
 * routine rather than exotic. The SCIM write is service-role, where a
 * zero-row match means the row genuinely was not there.
 *
 * The fake refuses to turn a zero-row match into an error, because a fake
 * that did could not detect this defect class at all.
 */

type Row = Record<string, unknown>;

const world = {
  tables: {} as Record<string, Row[]>,
  unmatched: new Set<string>(),
  failing: new Set<string>(),
  reset() {
    this.tables = { firm_matter_intakes: [], firm_clients: [], firm_employees: [] };
    this.unmatched = new Set<string>();
    this.failing = new Set<string>();
  },
};

const partnerTicketEvent = vi.fn().mockResolvedValue(undefined);

function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let payload: Row = {};
  let selected = false;
  const rows = () => (world.tables[table] ??= []);

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'update') {
      if (world.failing.has(table)) {
        return { data: null, error: { message: `${table} write rejected` } };
      }
      const hits = world.unmatched.has(table)
        ? []
        : rows().filter((r) => preds.every((p) => p(r)));
      for (const r of hits) Object.assign(r, payload);
      // No `.select()` means no rows come back, whatever moved.
      return { data: selected ? hits.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows().filter((r) => preds.every((p) => p(r))), error: null };
  };

  const api: Record<string, unknown> = {
    select() {
      selected = true;
      return api;
    },
    update(p: Row) {
      op = 'update';
      payload = p;
      return api;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return api;
    },
    neq(col: string, val: unknown) {
      preds.push((r) => r[col] !== val);
      return api;
    },
    is(col: string, val: unknown) {
      preds.push((r) => (r[col] ?? null) === val);
      return api;
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    },
    async single() {
      const { data, error } = run();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return api;
}

const client = { from: (t: string) => builder(t) };

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => client,
  getCurrentUser: async () => ({ id: 'attorney-1', email: 'a@firm.test' }),
}));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => client,
  getCurrentUser: async () => ({ id: 'attorney-1', email: 'a@firm.test' }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => client }));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => client }));
vi.mock('../lib/partner-notify', () => ({
  partnerTicketEvent: (...a: unknown[]) => partnerTicketEvent(...a),
}));

const { runConflictCheckAction, clearConflictAction } = await import(
  '../lib/conflict-check'
);

beforeEach(() => {
  world.reset();
  partnerTicketEvent.mockClear();
  world.tables.firm_matter_intakes.push({
    id: 'intake-1',
    firm_id: 'firm-1',
    client_name: 'Acme Ltd',
    opposing_parties: ['Hohag GmbH'],
    related_parties: [],
    matter_type: null,
    status: 'submitted',
    conflict_results: null,
    conflict_check_notes: null,
  });
});

describe('a conflicts check nobody recorded', () => {
  it('refuses rather than reporting a result the row never took', async () => {
    world.unmatched.add('firm_matter_intakes');

    const res = await runConflictCheckAction('firm-1', 'intake-1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('has not been recorded');
    // Order and outcome are separate claims: the status is untouched and
    // the partner app was not told the ticket moved.
    expect(world.tables.firm_matter_intakes[0].status).toBe('submitted');
    expect(world.tables.firm_matter_intakes[0].conflict_results).toBeNull();
    expect(partnerTicketEvent).not.toHaveBeenCalled();
  });

  it('refuses when the write comes back carrying an error', async () => {
    world.failing.add('firm_matter_intakes');

    const res = await runConflictCheckAction('firm-1', 'intake-1');

    expect(res.ok).toBe(false);
    expect(partnerTicketEvent).not.toHaveBeenCalled();
  });

  it('records a clean check, and says so, when the row really moves', async () => {
    const res = await runConflictCheckAction('firm-1', 'intake-1');

    expect(res.ok).toBe(true);
    expect(res.hits).toEqual([]);
    expect(world.tables.firm_matter_intakes[0].status).toBe(
      'conflict_check_passed',
    );
    expect(partnerTicketEvent).toHaveBeenCalledTimes(1);
  });

  it('records a flagged check when a prior matter names the same party', async () => {
    world.tables.firm_matter_intakes.push({
      id: 'intake-old',
      firm_id: 'firm-1',
      client_name: 'Old Client',
      opposing_parties: ['Acme Ltd'],
      related_parties: [],
      matter_type: null,
      status: 'open',
    });

    const res = await runConflictCheckAction('firm-1', 'intake-1');

    expect(res.ok).toBe(true);
    expect(res.hits?.length).toBeGreaterThan(0);
    expect(world.tables.firm_matter_intakes[0].status).toBe(
      'conflict_check_flagged',
    );
  });
});

describe('clearing a conflict that stayed flagged', () => {
  const REASON = 'Screened the associate off this matter on 2026-08-09.';

  it('refuses rather than claiming a reason was filed for the audit trail', async () => {
    world.unmatched.add('firm_matter_intakes');

    const res = await clearConflictAction('firm-1', 'intake-1', REASON);

    expect(res.ok).toBe(false);
    expect(res.error).toContain('no reason was recorded');
    expect(world.tables.firm_matter_intakes[0].conflict_check_notes).toBeNull();
    expect(world.tables.firm_matter_intakes[0].status).toBe('submitted');
    expect(partnerTicketEvent).not.toHaveBeenCalled();
  });

  it('refuses on an intake id that belongs to another firm', async () => {
    // firm_id is taken straight off the caller's arguments and was never
    // proved by a read, so this predicate is the only thing between a
    // caller and another firm's matter - and it fails by matching nothing.
    const res = await clearConflictAction('firm-OTHER', 'intake-1', REASON);

    expect(res.ok).toBe(false);
    expect(world.tables.firm_matter_intakes[0].conflict_check_notes).toBeNull();
    expect(partnerTicketEvent).not.toHaveBeenCalled();
  });

  it('files the reason when the row really moves', async () => {
    const res = await clearConflictAction('firm-1', 'intake-1', REASON);

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_matter_intakes[0].conflict_check_notes).toBe(REASON);
    expect(world.tables.firm_matter_intakes[0].status).toBe(
      'conflict_check_passed',
    );
  });
});
