import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allocateMatterNumber, readMatterPrefix } from '../lib/ticket-allocator';
import {
  DEFAULT_MATTER_PREFIX,
  DEFAULT_TICKET_PREFIX,
  TICKET_MAX,
  displayMatterNumber,
} from '../lib/ticket-numbers';

/**
 * The matter reference: the thing a firm quotes on the phone, in email and in
 * a filing instead of reading a uuid fragment aloud.
 *
 * Driven against a fake that behaves like the database will, and the fake
 * ENFORCES `unique (firm_id, matter_number) where matter_number is not null`
 * (supabase/migrations/20260813_matter_number.sql). That constraint, not the
 * allocator's own care, is what makes the retry loop an allocator; a fake
 * kinder than the database would let both writes through and this file would
 * pass while the product handed two matters the same reference.
 *
 * Three properties matter more than the rest and each has its own case below:
 *   - a matter that already has a reference is NEVER renumbered, because a
 *     reference that moved after it went out on paper cannot be looked up;
 *   - two people opening a matter at the same moment cannot receive the same
 *     number;
 *   - a matter with no number still renders something, so the feature
 *     degrades to exactly the display the list had before it existed.
 */

type Row = { id: string; firm_id: string; matter_number: string | null };

type Db = {
  rows: Row[];
  /** null means firm_settings has no row for this firm at all. */
  settings: { matter_prefix?: unknown } | null;
  /** Set to make every read of the column behave as an unapplied migration. */
  columnMissing: boolean;
  /** Every matter_number an update attempted, in order. */
  attempted: string[];
  /** How many attempts the unique index rejected. */
  collisions: number;
  /** Called after each completed read of the highest number. */
  onRead: (() => void) | null;
  /** Awaited once, before the first write, so two callers can interleave. */
  gate: (() => Promise<void>) | null;
  /** Stands in for a competing writer that took `wanted` first. */
  beforeWrite: ((wanted: string) => void) | null;
};

function newDb(partial: Partial<Db> = {}): Db {
  return {
    rows: [],
    settings: null,
    columnMissing: false,
    attempted: [],
    collisions: 0,
    onRead: null,
    gate: null,
    beforeWrite: null,
    ...partial,
  };
}

const missingColumn = {
  code: '42703',
  message: 'column cases.matter_number does not exist',
};

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: 'select' | 'update' = 'select';
  private patch: Record<string, unknown> = {};
  private eqs: Array<[string, unknown]> = [];
  private isNull: string[] = [];
  private notNull: string[] = [];
  private descending = false;
  private cap = Infinity;

  constructor(private db: Db, private table: string) {}

  select() {
    return this;
  }
  update(values: Record<string, unknown>) {
    this.op = 'update';
    this.patch = values;
    return this;
  }
  eq(col: string, value: unknown) {
    this.eqs.push([col, value]);
    return this;
  }
  is(col: string, value: unknown) {
    if (value === null) this.isNull.push(col);
    return this;
  }
  not(col: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) this.notNull.push(col);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    if (col === 'matter_number' && opts?.ascending === false) this.descending = true;
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }

  private matches(row: Row): boolean {
    for (const [col, value] of this.eqs) {
      if ((row as unknown as Record<string, unknown>)[col] !== value) return false;
    }
    for (const col of this.isNull) {
      if ((row as unknown as Record<string, unknown>)[col] != null) return false;
    }
    for (const col of this.notNull) {
      if ((row as unknown as Record<string, unknown>)[col] == null) return false;
    }
    return true;
  }

  private async run(): Promise<{ data: unknown; error: unknown }> {
    if (this.table === 'firm_settings') {
      return { data: this.db.settings, error: null };
    }
    // An unapplied migration is a missing column, and PostgREST reports that
    // as an error on the request rather than as an empty result.
    if (this.db.columnMissing) return { data: null, error: missingColumn };

    if (this.op === 'select') {
      let found = this.db.rows.filter((r) => this.matches(r));
      if (this.descending) {
        // Postgres orders DESC as NULLS FIRST. The allocator has to filter the
        // nulls out itself, and if it stops doing that this fake hands it a
        // null as the highest number and the series restarts from one.
        const nulls = found.filter((r) => r.matter_number == null);
        const numbered = found
          .filter((r) => r.matter_number != null)
          .sort((a, b) => (a.matter_number! < b.matter_number! ? 1 : -1));
        found = [...nulls, ...numbered];
      }
      const data = found
        .slice(0, this.cap)
        .map((r) => ({ matter_number: r.matter_number }));
      this.db.onRead?.();
      return { data, error: null };
    }

    const gate = this.db.gate;
    if (gate) {
      this.db.gate = null;
      await gate();
    }
    const target = this.db.rows.find((r) => this.matches(r));
    // No error and no row: the predicate did not hold. In the real database
    // that is a matter that already has a number, or one that is gone, or one
    // that belongs to another firm.
    if (!target) return { data: null, error: null };

    const wanted = String(this.patch.matter_number);
    this.db.attempted.push(wanted);
    this.db.beforeWrite?.(wanted);
    // unique (firm_id, matter_number) where matter_number is not null.
    const taken = this.db.rows.some(
      (r) => r.firm_id === target.firm_id && r.matter_number === wanted,
    );
    if (taken) {
      this.db.collisions += 1;
      return {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "cases_matter_number_idx"',
        },
      };
    }
    target.matter_number = wanted;
    return { data: { matter_number: wanted }, error: null };
  }

  async maybeSingle() {
    const res = await this.run();
    if (Array.isArray(res.data)) return { data: res.data[0] ?? null, error: res.error };
    return res;
  }

  then<A, B>(
    onOk?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onOk, onErr);
  }
}

function fakeAdmin(db: Db): SupabaseClient {
  return { from: (table: string) => new Query(db, table) } as unknown as SupabaseClient;
}

const FIRM = 'firm-1';
const row = (id: string, number: string | null = null): Row => ({
  id,
  firm_id: FIRM,
  matter_number: number,
});

// ── The reference a firm gets ────────────────────────────────────────────

describe('allocateMatterNumber', () => {
  it('gives a firm with no numbered matters its first reference', async () => {
    const db = newDb({ rows: [row('c1')] });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c1',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000001' });
    expect(db.rows[0].matter_number).toBe('MAT-0000001');
  });

  it('carries on from the highest reference the firm already has', async () => {
    const db = newDb({
      rows: [row('a', 'MAT-0000009'), row('b', 'MAT-0000010'), row('c')],
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000011' });
  });

  /**
   * The NULLS FIRST guard, and it is not tidiness. `matter_number` is nullable
   * for every consumer case and for any matter whose allocation failed, and
   * Postgres orders a descending sort NULLS FIRST. A read that did not exclude
   * the nulls would take one as the highest number, restart the series at one,
   * and spend the whole retry budget colliding with references that are
   * already on filings.
   */
  it('ignores the matters that have no number when it looks for the highest', async () => {
    const db = newDb({
      rows: [row('x'), row('y'), row('a', 'MAT-0000004'), row('z'), row('c')],
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000005' });
    expect(db.collisions).toBe(0);
  });

  /**
   * PER FIRM, NOT GLOBAL. The prefix is the firm's own, so two firms both
   * holding MAT-0000001 is the design and not a collision. Nothing in the
   * product resolves a matter by its reference alone: every route and link
   * keys on the case uuid.
   */
  it('counts only this firm, so two firms can both hold MAT-0000001', async () => {
    const db = newDb({
      rows: [
        { id: 'other', firm_id: 'firm-2', matter_number: 'MAT-0000001' },
        row('mine'),
      ],
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'mine',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000001' });
  });

  it('uses the firm matter prefix, normalised', async () => {
    const db = newDb({ rows: [row('c1')], settings: { matter_prefix: ' leg-' } });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c1',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'LEG-0000001' });
  });

  /**
   * The matter series defaults to MAT and the ticket series to REQ, and they
   * must not converge. One shared prefix would eventually issue REQ-0000005
   * for an employee's document AND REQ-0000005 for a matter, and a reference
   * that resolves to two records of different kinds is worse than none.
   */
  it('does not default onto the ticket series prefix', async () => {
    expect(DEFAULT_MATTER_PREFIX).not.toBe(DEFAULT_TICKET_PREFIX);
    const db = newDb({ rows: [row('c1')] });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c1',
    });
    expect(res.ok && res.ticketNumber.startsWith(`${DEFAULT_MATTER_PREFIX}-`)).toBe(true);
  });

  it('continues the series across a prefix change', async () => {
    const db = newDb({
      rows: [row('a', 'MAT-0000041'), row('c')],
      settings: { matter_prefix: 'LEG' },
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'LEG-0000042' });
  });
});

// ── A reference that has been quoted never moves ─────────────────────────

describe('a matter that already has a reference', () => {
  /**
   * The property the conditional write exists for. A refresh, a second tab and
   * a caller arriving late all read back the number that is there rather than
   * issuing another one. A matter reference is quoted in email and on filings;
   * one that changed once is one nobody can look up.
   */
  it('is never renumbered, and gets its own number back', async () => {
    const db = newDb({ rows: [row('c', 'MAT-0000042')] });
    const admin = fakeAdmin(db);
    const first = await allocateMatterNumber(admin, { firmId: FIRM, caseId: 'c' });
    const second = await allocateMatterNumber(admin, { firmId: FIRM, caseId: 'c' });
    expect(first).toEqual({ ok: true, ticketNumber: 'MAT-0000042' });
    expect(second).toEqual({ ok: true, ticketNumber: 'MAT-0000042' });
    expect(db.rows[0].matter_number).toBe('MAT-0000042');
    // Not one write was even attempted against a numbered row.
    expect(db.attempted).toEqual([]);
  });

  it('keeps it even when the firm has since changed its prefix', async () => {
    const db = newDb({
      rows: [row('c', 'MAT-0000007')],
      settings: { matter_prefix: 'LEG' },
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000007' });
  });

  /**
   * The write is scoped to the firm as well as the row. A caller naming a case
   * id from another firm must not have this firm's next number written onto
   * it, which is the `'use server' + service role` shape that has produced
   * cross-tenant writes in this repo before.
   */
  it('will not write this firm number onto another firm matter', async () => {
    const db = newDb({
      rows: [{ id: 'theirs', firm_id: 'firm-2', matter_number: null }],
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'theirs',
    });
    expect(res.ok).toBe(false);
    expect(db.rows[0].matter_number).toBeNull();
  });
});

// ── Two people opening a matter at the same moment ───────────────────────

describe('two matters opened at the same moment', () => {
  /**
   * Both allocations read the highest number before either of them writes, so
   * both compute the same next one. Exactly one write wins; the loser is
   * rejected by the unique index with 23505, bumps, and writes the next. The
   * gate makes that interleaving deterministic rather than a hope about
   * timing: the first write waits until both reads have happened.
   */
  it('cannot hand the same reference to both', async () => {
    const db = newDb({ rows: [row('seed', 'MAT-0000004'), row('a'), row('b')] });

    let bothRead: () => void = () => {};
    const reads = new Promise<void>((resolve) => {
      bothRead = resolve;
    });
    let seen = 0;
    db.onRead = () => {
      seen += 1;
      if (seen >= 2) bothRead();
    };
    db.gate = () => reads;

    const admin = fakeAdmin(db);
    const [first, second] = await Promise.all([
      allocateMatterNumber(admin, { firmId: FIRM, caseId: 'a' }),
      allocateMatterNumber(admin, { firmId: FIRM, caseId: 'b' }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const numbers = [
      first.ok ? first.ticketNumber : '',
      second.ok ? second.ticketNumber : '',
    ].sort();
    expect(numbers).toEqual(['MAT-0000005', 'MAT-0000006']);

    // The constraint did the work, not the code's own care: one attempt was
    // rejected, and both callers tried the same number first.
    expect(db.collisions).toBe(1);
    expect(db.attempted.filter((n) => n === 'MAT-0000005')).toHaveLength(2);

    // And the two matters hold two different references.
    const stored = db.rows
      .filter((r) => r.id === 'a' || r.id === 'b')
      .map((r) => r.matter_number);
    expect(new Set(stored).size).toBe(2);
  });

  it('the next matter after a race carries on past both of them', async () => {
    const db = newDb({
      rows: [row('a', 'MAT-0000005'), row('b', 'MAT-0000006'), row('c')],
    });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'MAT-0000007' });
  });
});

// ── Refusals, none of which may be fatal to a matter ─────────────────────

describe('when it cannot allocate', () => {
  /**
   * The unmigrated case, and the one that decides whether this is safe to ship
   * ahead of the owner applying 20260813_matter_number.sql. The column is not
   * there, the allocator says so plainly and returns rather than throwing, and
   * the matter page renders with the reference it always had.
   */
  it('says the column is not there yet instead of throwing', async () => {
    const db = newDb({ rows: [row('c')], columnMissing: true });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/database update/i);
  });

  it('refuses at the end of the series rather than wrapping', async () => {
    const db = newDb({ rows: [row('a', `MAT-${TICKET_MAX}`), row('c')] });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(TICKET_MAX));
    expect(db.attempted).toEqual([]);
  });

  it('gives up rather than looping forever', async () => {
    const db = newDb({ rows: [row('a', 'MAT-0000004'), row('c')] });
    let stolen = 0;
    db.beforeWrite = (wanted) => {
      stolen += 1;
      db.rows.push({ id: `rival-${stolen}`, firm_id: FIRM, matter_number: wanted });
    };
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'c',
    });
    expect(res.ok).toBe(false);
    expect(db.attempted).toHaveLength(6);
    expect(db.rows.find((r) => r.id === 'c')?.matter_number).toBeNull();
  });

  it('reports a matter that is not there', async () => {
    const db = newDb({ rows: [] });
    const res = await allocateMatterNumber(fakeAdmin(db), {
      firmId: FIRM,
      caseId: 'ghost',
    });
    expect(res.ok).toBe(false);
  });
});

describe('readMatterPrefix', () => {
  it('defaults when the firm has no settings row at all', async () => {
    expect(await readMatterPrefix(fakeAdmin(newDb()), FIRM)).toBe('MAT');
  });

  it('defaults when the column is not there yet', async () => {
    expect(await readMatterPrefix(fakeAdmin(newDb({ settings: {} })), FIRM)).toBe('MAT');
  });

  it('normalises what the firm typed', async () => {
    const db = newDb({ settings: { matter_prefix: 'l.e.g' } });
    expect(await readMatterPrefix(fakeAdmin(db), FIRM)).toBe('LEG');
  });
});

// ── What an unnumbered matter shows ──────────────────────────────────────

describe('displayMatterNumber', () => {
  const ID = '8b1aee48-2c11-4b0e-9a1f-6d2c1f0e77aa';

  it('shows the reference when the matter has one', () => {
    expect(displayMatterNumber({ matterNumber: 'MAT-0000012', id: ID })).toBe(
      'MAT-0000012',
    );
  });

  /**
   * THE FALLBACK IS THE FEATURE DEGRADING, NOT FAILING. A matter with no
   * number, whether because the migration is not applied or because an
   * allocation could not complete, shows exactly what the counsel list and the
   * matter breadcrumb showed before references existed: the leading segment of
   * the id. It matches components/counsel/patterns.tsx shortRef, which is what
   * those two surfaces called until now.
   */
  it('falls back to the leading segment of the id when it has none', () => {
    expect(displayMatterNumber({ matterNumber: null, id: ID })).toBe('8b1aee48');
    expect(displayMatterNumber({ id: ID })).toBe('8b1aee48');
    expect(displayMatterNumber({ matterNumber: '   ', id: ID })).toBe('8b1aee48');
  });

  it('never renders empty, even for an id with no dash in it', () => {
    expect(displayMatterNumber({ matterNumber: null, id: 'abc' })).toBe('abc');
  });
});
