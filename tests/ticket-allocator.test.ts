import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allocateSubmissionTicket, readTicketPrefix } from '../lib/ticket-allocator';
import { TICKET_MAX } from '../lib/ticket-numbers';

/**
 * The allocator, driven against a fake that behaves like the database will.
 *
 * The property this file exists to hold is that two employees raising a
 * request at the same moment cannot receive the same number. That is not a
 * property of careful code, it is a property of `unique (firm_id,
 * ticket_number)` plus a retry, so the fake below ENFORCES that constraint and
 * the concurrency test drives two allocations through the window between the
 * read and the write. Without the constraint the fake would let both writes
 * through and the test would pass while the product shipped duplicate ticket
 * numbers, which is precisely the failure lib/esign-audit.ts's chain append
 * has: a read-then-insert with nothing underneath it to lose against.
 *
 * Everything the fake does that is not obvious mirrors real Postgres and is
 * commented where it does, because a fake that is kinder than the database is
 * a test that proves nothing.
 */

type Row = { id: string; firm_id: string; ticket_number: string | null };

type Db = {
  rows: Row[];
  /** null means firm_settings has no row for this firm at all. */
  settings: { ticket_prefix?: unknown } | null;
  /** Set to make every read of the column behave as an unapplied migration. */
  columnMissing: boolean;
  /** Every ticket_number an update attempted, in order. */
  attempted: string[];
  /** How many attempts the unique index rejected. */
  collisions: number;
  /** Called after each completed read of the highest number. */
  onRead: (() => void) | null;
  /** Awaited once, before the first write, so two callers can interleave. */
  gate: (() => Promise<void>) | null;
  /**
   * Called with each number about to be attempted, before the unique check.
   * Standing in for a competing writer that got there first.
   */
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
  message: 'column firm_template_submissions.ticket_number does not exist',
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
    if (col === 'ticket_number' && opts?.ascending === false) this.descending = true;
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
        const nulls = found.filter((r) => r.ticket_number == null);
        const numbered = found
          .filter((r) => r.ticket_number != null)
          .sort((a, b) => (a.ticket_number! < b.ticket_number! ? 1 : -1));
        found = [...nulls, ...numbered];
      }
      const data = found.slice(0, this.cap).map((r) => ({ ticket_number: r.ticket_number }));
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
    // that is a submission that already has a number, or one that is gone.
    if (!target) return { data: null, error: null };

    const wanted = String(this.patch.ticket_number);
    this.db.attempted.push(wanted);
    this.db.beforeWrite?.(wanted);
    // unique (firm_id, ticket_number) where ticket_number is not null.
    const taken = this.db.rows.some(
      (r) => r.firm_id === target.firm_id && r.ticket_number === wanted,
    );
    if (taken) {
      this.db.collisions += 1;
      return {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "firm_template_submissions_ticket_idx"',
        },
      };
    }
    target.ticket_number = wanted;
    return { data: { ticket_number: wanted }, error: null };
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
const row = (id: string, ticket: string | null = null): Row => ({
  id,
  firm_id: FIRM,
  ticket_number: ticket,
});

// ── The number a firm gets ───────────────────────────────────────────────

describe('allocateSubmissionTicket', () => {
  it('gives a firm with nothing filed its first number, 0000001', async () => {
    const db = newDb({ rows: [row('s1')] });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's1',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000001' });
    expect(db.rows[0].ticket_number).toBe('REQ-0000001');
  });

  it('carries on from the highest number the firm already has', async () => {
    const db = newDb({
      rows: [row('a', 'REQ-0000009'), row('b', 'REQ-0000010'), row('c')],
    });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000011' });
  });

  /**
   * The read has to skip the rows with no number of their own, and this is
   * not a tidiness point. Postgres orders a descending sort NULLS FIRST, and
   * most rows in this table have no ticket number: every submission filed
   * before this shipped, and every one whose allocation failed. A read that
   * did not exclude them would take a null as the highest number, restart the
   * series at one, and then spend its whole retry budget colliding with
   * numbers that are already on filed documents.
   */
  it('ignores the rows that have no number when it looks for the highest', async () => {
    const db = newDb({
      rows: [row('x'), row('y'), row('a', 'REQ-0000004'), row('z'), row('s')],
    });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000005' });
    expect(db.collisions).toBe(0);
  });

  it('counts only this firm, so two firms do not share a series', async () => {
    const db = newDb({
      rows: [
        { id: 'other', firm_id: 'firm-2', ticket_number: 'REQ-0000900' },
        row('mine'),
      ],
    });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 'mine',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000001' });
  });

  it('uses the firm prefix, normalised', async () => {
    const db = newDb({ rows: [row('s1')], settings: { ticket_prefix: ' acme-' } });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's1',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'ACME-0000001' });
  });

  /**
   * A firm that changes its prefix keeps its series. The numbers already on
   * filed documents keep the prefix they were filed under, which is what the
   * setting's own helper text promises, and the next number is one past the
   * highest rather than a restart onto numbers that are already out.
   */
  it('continues the series across a prefix change', async () => {
    const db = newDb({
      rows: [row('a', 'REQ-0000041'), row('s')],
      settings: { ticket_prefix: 'VENDOR' },
    });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'VENDOR-0000042' });
  });
});

// ── The property the whole design exists for ─────────────────────────────

describe('two employees at the same moment', () => {
  /**
   * Both allocations read the highest number before either of them writes,
   * so both compute the same next number. Exactly one write wins; the loser
   * is rejected by the unique index with 23505, bumps, and writes the next
   * one. Neither caller sees an error and the two numbers are different.
   *
   * The gate below is what makes that interleaving deterministic rather than
   * a hope about timing: the first write waits until both reads have
   * happened.
   */
  it('cannot hand the same number to both', async () => {
    const db = newDb({ rows: [row('seed', 'REQ-0000004'), row('a'), row('b')] });

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
      allocateSubmissionTicket(admin, { firmId: FIRM, submissionId: 'a' }),
      allocateSubmissionTicket(admin, { firmId: FIRM, submissionId: 'b' }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const numbers = [
      first.ok ? first.ticketNumber : '',
      second.ok ? second.ticketNumber : '',
    ].sort();
    expect(numbers).toEqual(['REQ-0000005', 'REQ-0000006']);

    // The constraint did the work, not the code's own care: one attempt was
    // rejected, and both callers tried the same number first.
    expect(db.collisions).toBe(1);
    expect(db.attempted.filter((n) => n === 'REQ-0000005')).toHaveLength(2);

    // And the rows themselves hold two different numbers.
    const stored = db.rows.filter((r) => r.id === 'a' || r.id === 'b').map((r) => r.ticket_number);
    expect(new Set(stored).size).toBe(2);
  });

  it('the next allocation after a race carries on past both of them', async () => {
    const db = newDb({
      rows: [row('a', 'REQ-0000005'), row('b', 'REQ-0000006'), row('c')],
    });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 'c',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000007' });
  });

  /**
   * The retry is bounded. A firm under enough contention that six numbers in
   * a row are taken between the read and the write gets a refusal, and the
   * caller treats that the way it treats every other allocation failure: the
   * document is still filed and it shows the derived reference. An unbounded
   * loop here would hold a submission open indefinitely.
   */
  it('gives up rather than looping forever', async () => {
    const db = newDb({ rows: [row('a', 'REQ-0000004'), row('s')] });
    // A competitor takes every number a moment before this caller writes it,
    // six times running. Six is the budget lib/invoicing.ts settled on.
    let stolen = 0;
    db.beforeWrite = (wanted) => {
      stolen += 1;
      db.rows.push({ id: `rival-${stolen}`, firm_id: FIRM, ticket_number: wanted });
    };
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res.ok).toBe(false);
    expect(db.attempted).toEqual([
      'REQ-0000005',
      'REQ-0000006',
      'REQ-0000007',
      'REQ-0000008',
      'REQ-0000009',
      'REQ-0000010',
    ]);
    expect(db.rows.find((r) => r.id === 's')?.ticket_number).toBeNull();
  });
});

// ── Refusals, and the ones that must not be fatal ────────────────────────

describe('when it cannot allocate', () => {
  /**
   * REFUSE, DO NOT WRAP. The fixed seven-digit pad is what makes the text
   * ordering above correct, so the end of the series is a stop rather than a
   * roll-over onto numbers that are already on filed documents.
   */
  it('refuses at the end of the series', async () => {
    const db = newDb({ rows: [row('a', `REQ-${TICKET_MAX}`), row('s')] });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(TICKET_MAX));
    expect(db.attempted).toEqual([]);
  });

  /**
   * The unmigrated case, and the one that decides whether this slice is safe
   * to ship ahead of the owner applying the migration. The column is not
   * there, the allocator says so plainly and returns rather than throwing,
   * and the caller carries on filing the submission.
   */
  it('says the column is not there yet instead of throwing', async () => {
    const db = newDb({ rows: [row('s')], columnMissing: true });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/database update/i);
  });

  /**
   * Idempotent. A retry, or a second caller arriving late, must not file a
   * second number onto a record that already has one: the reference is
   * quoted in notifications and in email, and a record whose reference
   * changed once is a record nobody can look up.
   */
  it('returns the number a submission already has', async () => {
    const db = newDb({ rows: [row('s', 'REQ-0000042')] });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res).toEqual({ ok: true, ticketNumber: 'REQ-0000042' });
    expect(db.rows[0].ticket_number).toBe('REQ-0000042');
  });

  it('reports a submission that is not there', async () => {
    const db = newDb({ rows: [] });
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 'ghost',
    });
    expect(res.ok).toBe(false);
  });
});

/**
 * The end of the series can also be reached by the retry rather than by the
 * read, and that path needs its own stop. A caller that starts three short of
 * the last number and loses three races in a row would otherwise bump past it
 * and write an eighth digit, which sorts below every seven-digit number and
 * makes the next read hand out numbers that are already on filed documents.
 */
describe('when the retry walks off the end of the series', () => {
  it('stops rather than writing an eighth digit', async () => {
    const db = newDb({ rows: [row('a', 'REQ-9999996'), row('s')] });
    db.beforeWrite = (wanted) => {
      db.rows.push({ id: `rival-${wanted}`, firm_id: FIRM, ticket_number: wanted });
    };
    const res = await allocateSubmissionTicket(fakeAdmin(db), {
      firmId: FIRM,
      submissionId: 's',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(TICKET_MAX));
    expect(db.attempted).toEqual(['REQ-9999997', 'REQ-9999998', 'REQ-9999999']);
    expect(db.attempted.every((n) => n.length === 'REQ-0000000'.length)).toBe(true);
    expect(db.rows.find((r) => r.id === 's')?.ticket_number).toBeNull();
  });
});

describe('readTicketPrefix', () => {
  it('defaults when the firm has no settings row at all', async () => {
    expect(await readTicketPrefix(fakeAdmin(newDb()), FIRM)).toBe('REQ');
  });

  it('defaults when the column is not there yet', async () => {
    expect(await readTicketPrefix(fakeAdmin(newDb({ settings: {} })), FIRM)).toBe('REQ');
  });

  it('normalises what the firm typed', async () => {
    const db = newDb({ settings: { ticket_prefix: 'n.d.a' } });
    expect(await readTicketPrefix(fakeAdmin(db), FIRM)).toBe('NDA');
  });
});
