import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allocateRequestNumber, readRequestPrefix } from '../lib/ticket-allocator';
import { DEFAULT_REQUEST_PREFIX } from '../lib/ticket-numbers';

/**
 * Putting a number on a legal request, driven against a fake that behaves the
 * way the database will.
 *
 * The property this file exists to hold is that two employees filing at the
 * same moment cannot be handed the same reference. That is not a property of
 * careful code. It is a property of `unique (firm_id, request_number)` plus a
 * retry, so the fake below ENFORCES that constraint, and the race test drives
 * every caller through the window between the read and the write at once.
 *
 * A fake that is kinder than the database is a test that proves nothing, so
 * everything the fake does that is not obvious mirrors real Postgres and says
 * so where it does.
 */

type Row = { id: string; firm_id: string; request_number: string | null };

type Db = {
  rows: Row[];
  /** null means firm_settings has no row for this firm at all. */
  settings: { request_prefix?: unknown } | null;
  /** Set to make every read of the column behave as an unapplied migration. */
  columnMissing: boolean;
  /** Every request_number an update attempted, in order. */
  attempted: string[];
  /** How many attempts the unique index rejected. */
  collisions: number;
  /** Called after each completed read of the highest number. */
  onRead: (() => void) | null;
  /**
   * Awaited by EVERY write, and never cleared. That is the difference from a
   * one-shot gate: it holds all callers at the same point so they all read the
   * same highest number and then all try to write, which is the situation the
   * unique index exists for.
   */
  gateAll: (() => Promise<void>) | null;
};

function newDb(partial: Partial<Db> = {}): Db {
  return {
    rows: [],
    settings: null,
    columnMissing: false,
    attempted: [],
    collisions: 0,
    onRead: null,
    gateAll: null,
    ...partial,
  };
}

const missingColumn = {
  code: '42703',
  message: 'column firm_matter_intakes.request_number does not exist',
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
    if (col === 'request_number' && opts?.ascending === false) this.descending = true;
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
        // null as the highest number and the series restarts.
        const nulls = found.filter((r) => r.request_number == null);
        const numbered = found
          .filter((r) => r.request_number != null)
          .sort((a, b) => (a.request_number! < b.request_number! ? 1 : -1));
        found = [...nulls, ...numbered];
      }
      const data = found.slice(0, this.cap).map((r) => ({ request_number: r.request_number }));
      this.db.onRead?.();
      return { data, error: null };
    }

    if (this.db.gateAll) await this.db.gateAll();

    const target = this.db.rows.find((r) => this.matches(r));
    // No error and no row: the predicate did not hold. In the real database
    // that is a request that already has a number, or one that is gone.
    if (!target) return { data: null, error: null };

    const wanted = String(this.patch.request_number);
    this.db.attempted.push(wanted);
    // unique (firm_id, request_number) where request_number is not null.
    const taken = this.db.rows.some(
      (r) => r.firm_id === target.firm_id && r.request_number === wanted,
    );
    if (taken) {
      this.db.collisions += 1;
      return {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "firm_matter_intakes_request_number_idx"',
        },
      };
    }
    target.request_number = wanted;
    return { data: { request_number: wanted }, error: null };
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
  request_number: number,
});

// ── The number a firm gets ───────────────────────────────────────────────

describe('allocateRequestNumber', () => {
  it("gives a firm with nothing filed the owner's starting number", async () => {
    const db = newDb({ rows: [row('i1')], settings: { request_prefix: 'ZT' } });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001000' });
    expect(db.rows[0].request_number).toBe('ZT0001000');
  });

  it('uses the default prefix for a firm that has chosen none', async () => {
    const db = newDb({ rows: [row('i1')] });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: `${DEFAULT_REQUEST_PREFIX}0001000` });
  });

  it('carries on from the number this firm already reached', async () => {
    const db = newDb({
      rows: [row('old', 'ZT0001007'), row('i1')],
      settings: { request_prefix: 'ZT' },
    });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001008' });
  });

  /**
   * Per firm, not global. Another firm's higher number must not push this
   * firm's series forward, or a firm's first request would be numbered by
   * whoever else happens to be on the platform.
   */
  it("ignores another firm's numbers", async () => {
    const db = newDb({
      rows: [
        row('i1'),
        { id: 'other', firm_id: 'firm-2', request_number: 'ZT0009000' },
      ],
      settings: { request_prefix: 'ZT' },
    });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001000' });
  });
});

// ── Immutability ─────────────────────────────────────────────────────────

/**
 * People quote these in email and on the phone. A number that moved after it
 * went out is a number nobody can look up.
 */
describe('once a request has a number', () => {
  it('keeps it, and hands the same one back', async () => {
    const db = newDb({ rows: [row('i1', 'ZT0001004')], settings: { request_prefix: 'ZT' } });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001004' });
    expect(db.rows[0].request_number).toBe('ZT0001004');
  });

  it('is not renumbered by a second caller arriving later', async () => {
    const db = newDb({
      rows: [row('i1', 'ZT0001004'), row('i2', 'ZT0001005')],
      settings: { request_prefix: 'ZT' },
    });
    const admin = fakeAdmin(db);
    await allocateRequestNumber(admin, { firmId: FIRM, intakeId: 'i1' });
    await allocateRequestNumber(admin, { firmId: FIRM, intakeId: 'i1' });
    expect(db.rows[0].request_number).toBe('ZT0001004');
    // Nothing was even attempted: the conditional write never fired.
    expect(db.attempted).toEqual([]);
  });

  /**
   * Changing the firm's prefix does not reach backwards. Every number already
   * quoted keeps the prefix it was issued under.
   */
  it('is untouched when the firm changes its prefix', async () => {
    const db = newDb({ rows: [row('i1', 'ZT0001004')], settings: { request_prefix: 'ACME' } });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001004' });
  });
});

// ── The race ─────────────────────────────────────────────────────────────

describe('when a whole office files at once', () => {
  /**
   * THE TEST THIS FILE EXISTS FOR, and it is written to fail if the control is
   * removed rather than to look like it passed.
   *
   * Six callers are held at the write until ALL SIX have finished reading, so
   * every one of them computes the same next number, 1000, from the same empty
   * series. That is the exact interleaving a read-then-write races on. What
   * separates them is the unique index: five writes are rejected with 23505,
   * each of those callers bumps and tries the next number, and the database
   * decides the order rather than the code's own care.
   *
   * Six because MAX_ATTEMPTS is six: the last caller through spends its whole
   * retry budget, so this also pins that the budget is large enough for a
   * realistic simultaneous filing.
   *
   * Deleting the 23505 branch from the allocator makes this red (callers fail
   * instead of retrying). Deleting the unique check from the fake makes it red
   * too (six rows all hold ZT0001000). Both were confirmed by mutation, which
   * is the only reason to believe a concurrency test at all.
   */
  it('never hands the same reference to two of them', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const db = newDb({
      rows: ids.map((id) => row(id)),
      settings: { request_prefix: 'ZT' },
    });

    let allRead: () => void = () => {};
    const reads = new Promise<void>((resolve) => {
      allRead = resolve;
    });
    let seen = 0;
    db.onRead = () => {
      seen += 1;
      if (seen >= ids.length) allRead();
    };
    db.gateAll = () => reads;

    const admin = fakeAdmin(db);
    const results = await Promise.all(
      ids.map((id) => allocateRequestNumber(admin, { firmId: FIRM, intakeId: id })),
    );

    // Every one of them got a reference.
    expect(results.every((r) => r.ok)).toBe(true);

    // And no two got the same one. This is the property.
    const issued = results.map((r) => (r.ok ? r.ticketNumber : ''));
    expect(new Set(issued).size).toBe(ids.length);
    expect([...issued].sort()).toEqual([
      'ZT0001000',
      'ZT0001001',
      'ZT0001002',
      'ZT0001003',
      'ZT0001004',
      'ZT0001005',
    ]);

    // The stored rows agree, so this is not just what the callers were told.
    const stored = db.rows.map((r) => r.request_number);
    expect(new Set(stored).size).toBe(ids.length);
    expect(stored.every((n) => n != null)).toBe(true);

    // They genuinely raced: every caller tried 1000 first and the index threw
    // five of them out. A sequential run would show zero collisions, so this
    // assertion is what stops the test passing for the wrong reason.
    expect(db.attempted.filter((n) => n === 'ZT0001000')).toHaveLength(ids.length);

    // Fifteen rejections, which is 5+4+3+2+1 and not a round number by
    // accident. All six try 1000 and five lose; those five all try 1001 and
    // four lose; and so on down. Pinning the exact triangular number rather
    // than "more than zero" is what makes this assertion able to notice a
    // change in how the retry walks the series.
    const losersEachRound = (ids.length * (ids.length - 1)) / 2;
    expect(losersEachRound).toBe(15);
    expect(db.collisions).toBe(losersEachRound);
  });

  it('carries on past the whole pile-up afterwards', async () => {
    const db = newDb({
      rows: [
        row('a', 'ZT0001000'),
        row('b', 'ZT0001001'),
        row('c', 'ZT0001002'),
        row('next'),
      ],
      settings: { request_prefix: 'ZT' },
    });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'next' });
    expect(res).toEqual({ ok: true, ticketNumber: 'ZT0001003' });
  });
});

// ── Refusals, and the ones that must not be fatal ────────────────────────

describe('when it cannot allocate', () => {
  /**
   * Until the migration is applied there is no column. A request must still be
   * filed: a colleague's legal problem cannot fail to reach the legal team
   * because a counter would not move. The caller shows the derived reference.
   */
  it('refuses in words rather than throwing when the column is not there', async () => {
    const db = newDb({ rows: [row('i1')], columnMissing: true });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'i1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not switched on yet/i);
  });

  it('says so when the request is not there at all', async () => {
    const db = newDb({ rows: [] });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'ghost' });
    expect(res.ok).toBe(false);
  });

  /**
   * A caller naming another firm's request must not get this firm's next
   * number written onto it. The write is scoped to the firm as well as the row.
   */
  it("will not number another firm's request", async () => {
    const db = newDb({
      rows: [{ id: 'theirs', firm_id: 'firm-2', request_number: null }],
      settings: { request_prefix: 'ZT' },
    });
    const res = await allocateRequestNumber(fakeAdmin(db), { firmId: FIRM, intakeId: 'theirs' });
    expect(res.ok).toBe(false);
    expect(db.rows[0].request_number).toBeNull();
  });
});

// ── The prefix ───────────────────────────────────────────────────────────

describe('readRequestPrefix', () => {
  it('reads the firm’s own prefix', async () => {
    const db = newDb({ settings: { request_prefix: 'ZT' } });
    expect(await readRequestPrefix(fakeAdmin(db), FIRM)).toBe('ZT');
  });

  it('normalises what the firm typed', async () => {
    const db = newDb({ settings: { request_prefix: ' z.t. ' } });
    expect(await readRequestPrefix(fakeAdmin(db), FIRM)).toBe('ZT');
  });

  it('falls back for a firm with no settings row at all', async () => {
    const db = newDb({ settings: null });
    expect(await readRequestPrefix(fakeAdmin(db), FIRM)).toBe(DEFAULT_REQUEST_PREFIX);
  });
});
