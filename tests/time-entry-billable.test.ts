import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Time that cannot be invoiced must not be logged silently.
 *
 * buildDraftInvoiceAction bills one matter at a time (`.eq('case_id', caseId)`),
 * so an entry with no matter can never reach any invoice. /counsel/time mounted
 * the timer with no matter at all, counted the result in "Unbilled", and
 * offered nothing to correct it afterwards.
 *
 * Mutations these are meant to catch, each applied and watched go red:
 *   - delete the `if (!opts.caseId)` guard in startTimerAction -> "refuses to
 *     start a timer with no matter" goes red.
 *   - delete the `if (!input.caseId)` guard in logManualEntryAction -> "refuses
 *     to back-fill an entry with no matter" goes red.
 *   - drop `.eq('firm_id', firmId)` from the matter lookup -> "refuses a matter
 *     belonging to another organization" goes red.
 *   - drop `.is('invoice_id', null)` from the update -> "refuses to move an
 *     entry that is already on an invoice" goes red.
 *   - drop the zero-row check after the update -> "reports a move that wrote
 *     nothing" goes red.
 *   - remove `cases={caseOptions}` from the page -> "the time page gives the
 *     timer something to pick" goes red.
 *
 * Membership and the active-organization gate are held OPEN in the fakes, so
 * the only thing that can refuse is the thing under test.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserted: [] as Array<{ table: string; row: Row }>,
  seq: 0,
  reset() {
    this.tables = { firm_members: [], firm_time_entries: [], cases: [] };
    this.inserted = [];
    this.seq = 0;
  },
}));

class Q {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private patch: Row | null = null;
  private pending: Row | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  private matched(): Row[] {
    return (db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
  }
  select() {
    return this;
  }
  insert(row: Row) {
    this.mode = 'insert';
    this.pending = row;
    return this;
  }
  update(patch: Row) {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  not(col: string, _op: string, _val: unknown) {
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  gt(col: string, val: number) {
    this.filters.push((r) => Number(r[col] ?? 0) > val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    const keep = this.matched().slice(0, n);
    this.filters.push((r) => keep.includes(r));
    return this;
  }
  private settle(): { data: unknown; error: { message: string } | null } {
    if (this.mode === 'insert') {
      const row = { id: `entry-${++db.seq}`, ...(this.pending ?? {}) };
      (db.tables[this.table] ??= []).push(row);
      db.inserted.push({ table: this.table, row });
      return { data: row, error: null };
    }
    const hit = this.matched();
    if (this.mode === 'update') {
      for (const r of hit) Object.assign(r, this.patch);
      return { data: hit, error: null };
    }
    return { data: hit, error: null };
  }
  maybeSingle() {
    const r = this.settle();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return Promise.resolve({ data, error: r.error });
  }
  single() {
    return this.maybeSingle();
  }
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(this.settle()).then(resolve);
  }
}

const client = { from: (table: string) => new Q(table) };

vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => client,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => client }));
vi.mock('../lib/firm-authz', () => ({
  FIRM_ADMIN_ROLES: ['owner', 'admin'],
  FIRM_POSTING_ROLES: ['owner', 'admin', 'attorney', 'paralegal'],
  callerHasFirmRole: async () => true,
  callerIsFirmAdmin: async () => true,
  requireActiveFirm: async () => undefined,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

let time: typeof import('../lib/time-tracking');

beforeEach(async () => {
  db.reset();
  db.tables.firm_members.push({
    firm_id: 'firm-1',
    user_id: 'user-1',
    role: 'attorney',
    default_rate_cents: 40_000,
  });
  db.tables.cases.push({ id: 'case-1', firm_id: 'firm-1' });
  vi.resetModules();
  time = await import('../lib/time-tracking');
});

describe('a timer names the matter it is for', () => {
  it('refuses to start a timer with no matter, and writes nothing', async () => {
    const res = await time.startTimerAction('firm-1', { description: 'Reading' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/matter/i);
    expect(db.inserted).toHaveLength(0);
  });

  it('starts when it is told which matter', async () => {
    const res = await time.startTimerAction('firm-1', { caseId: 'case-1' });
    expect(res.ok).toBe(true);
    expect(db.tables.firm_time_entries[0]).toMatchObject({
      case_id: 'case-1',
      firm_id: 'firm-1',
      rate_cents: 40_000,
    });
  });

  it('refuses to back-fill an entry with no matter', async () => {
    const res = await time.logManualEntryAction('firm-1', {
      description: 'Reading',
      durationSeconds: 1800,
    });
    expect(res.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });
});

describe('assignTimeEntryToCaseAction', () => {
  function seedOrphan(extra: Row = {}) {
    db.tables.firm_time_entries.push({
      id: 'entry-A',
      firm_id: 'firm-1',
      user_id: 'user-1',
      case_id: null,
      invoice_id: null,
      duration_seconds: 3600,
      billable: true,
      ...extra,
    });
  }

  it('moves the caller"s orphaned entry onto a matter', async () => {
    seedOrphan();
    const res = await time.assignTimeEntryToCaseAction(
      'firm-1',
      'entry-A',
      'case-1',
    );
    expect(res.ok).toBe(true);
    expect(db.tables.firm_time_entries[0]!.case_id).toBe('case-1');
  });

  it('refuses a matter belonging to another organization', async () => {
    seedOrphan();
    db.tables.cases.push({ id: 'case-other', firm_id: 'firm-2' });
    const res = await time.assignTimeEntryToCaseAction(
      'firm-1',
      'entry-A',
      'case-other',
    );
    expect(res.ok).toBe(false);
    expect(db.tables.firm_time_entries[0]!.case_id).toBeNull();
  });

  it('refuses to move an entry that is already on an invoice', async () => {
    seedOrphan({ invoice_id: 'inv-1' });
    const res = await time.assignTimeEntryToCaseAction(
      'firm-1',
      'entry-A',
      'case-1',
    );
    expect(res.ok).toBe(false);
    expect(db.tables.firm_time_entries[0]!.case_id).toBeNull();
  });

  it('reports a move that wrote nothing, rather than claiming success', async () => {
    // Somebody else's entry: the self-scoped filter matches no row, and
    // postgrest-js reports that without an error.
    seedOrphan({ user_id: 'user-2' });
    const res = await time.assignTimeEntryToCaseAction(
      'firm-1',
      'entry-A',
      'case-1',
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not moved/i);
  });
});

describe('the page that mounts the timer', () => {
  it('gives the timer something to pick', () => {
    const src = stripComments(
      readFileSync(new URL('../app/counsel/time/page.tsx', import.meta.url), 'utf8'),
    );
    const mount = /<TimerWidget[\s\S]*?\/>/.exec(src)?.[0] ?? '';
    expect(mount).not.toBe('');
    expect(
      /\bcases=/.test(mount),
      'A timer mounted with neither a caseId nor a list of matters can only produce entries that no invoice can include.',
    ).toBe(true);
  });
});
