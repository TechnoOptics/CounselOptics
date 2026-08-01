import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Money-critical: a firm's client must be billed for a piece of work exactly
 * once, and an invoice the firm believes it sent must actually have left the
 * building.
 *
 * These tests drive lib/invoicing.ts against an in-memory stand-in for the
 * Supabase clients (same approach as counsel-guest-revocation.test.ts), so we
 * can assert the outcomes that matter to a client's bill:
 *   - every attorney's time on the matter is claimed by the draft, not just
 *     the drafter's own,
 *   - drafting refuses outright when the service-role client is missing,
 *     rather than half-stamping and leaving colleagues' hours re-billable,
 *   - a concurrent drafter that takes an entry mid-flight causes the whole
 *     draft to roll back, so nothing is billed twice,
 *   - sending flips draft -> sent exactly once, so a double click cannot mint
 *     two payment links or mail the client twice.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /**
   * Fires the instant a firm_time_entries update is EXECUTED, before its
   * predicates are evaluated - the window a concurrent drafter would use.
   */
  onClaim: null as null | (() => void),
  adminAvailable: true,
  seq: 0,
  reset() {
    this.tables = {
      firm_members: [],
      firm_time_entries: [],
      firm_invoices: [],
      firms: [],
    };
    this.onClaim = null;
    this.adminAvailable = true;
    this.seq = 0;
  },
}));

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);

/**
 * Chainable query builder. Predicates are collected and applied at EXECUTION
 * time (not as each method is called) so that a write racing in via onClaim is
 * visible to the update's own WHERE clause, exactly as Postgres would re-check
 * it under read-committed.
 */
class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | null = null;
  private lim: number | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;

  constructor(private table: string) {}

  select() {
    return this;
  }
  insert(v: Row) {
    this.op = 'insert';
    this.payload = v;
    return this;
  }
  update(v: Row) {
    this.op = 'update';
    this.payload = v;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    this.preds.push((r) => (r[col] ?? null) === val);
    return this;
  }
  not(col: string, _op: string, _val: unknown) {
    this.preds.push((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }
  gt(col: string, val: number) {
    this.preds.push((r) => (r[col] as number) > val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }

  private run(): { data: Row[]; error: unknown } {
    const table = (db.tables[this.table] ??= []);

    if (this.op === 'insert') {
      const row: Row = { id: `id-${++db.seq}`, ...(this.payload ?? {}) };
      table.push(row);
      return { data: [row], error: null };
    }

    if (this.table === 'firm_time_entries' && this.op === 'update' && db.onClaim) {
      const hook = db.onClaim;
      db.onClaim = null;
      hook();
    }

    let rows = table.filter((r) => this.preds.every((p) => p(r)));

    if (this.op === 'update') {
      for (const r of rows) Object.assign(r, this.payload);
      return { data: [...rows], error: null };
    }
    if (this.op === 'delete') {
      const gone = new Set(rows.map((r) => r.id));
      db.tables[this.table] = table.filter((r) => !gone.has(r.id));
      // FK firm_time_entries.invoice_id is ON DELETE SET NULL.
      if (this.table === 'firm_invoices') {
        for (const e of db.tables.firm_time_entries ?? []) {
          if (gone.has(e.invoice_id as string)) e.invoice_id = null;
        }
      }
      return { data: [...rows], error: null };
    }

    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) =>
        String(a[col]) < String(b[col])
          ? this.orderAsc
            ? -1
            : 1
          : String(a[col]) > String(b[col])
            ? this.orderAsc
              ? 1
              : -1
            : 0,
      );
    }
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    return { data: rows, error: null };
  }

  single() {
    const { data, error } = this.run();
    return Promise.resolve({ data: data[0] ?? null, error });
  }
  maybeSingle() {
    const { data, error } = this.run();
    return Promise.resolve({ data: data[0] ?? null, error });
  }
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?:
      | ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>)
      | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const { data, error } = this.run();
    return Promise.resolve({ data, error }).then(onfulfilled, onrejected);
  }
}

const client = {
  from: (table: string) => new Query(table),
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
    },
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => client,
  getCurrentUser: async () => ({ id: 'attorney-1', email: 'a@firm.test' }),
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => (db.adminAvailable ? client : null),
}));
vi.mock('../lib/notifications', () => ({ createNotification: async () => {} }));
vi.mock('../lib/email', () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    sentEmails.push({ to: input.to, subject: input.subject });
    return { ok: true, id: 'email-1' };
  },
  buildInvoiceEmailHtml: () => '<p>invoice</p>',
}));

const { buildDraftInvoiceAction, sendInvoiceAction } = await import(
  '../lib/invoicing'
);

const FIRM = 'firm-1';
const CASE = 'case-1';

function seedFirmAndTime() {
  db.tables.firms.push({ id: FIRM, name: 'Anderson Foundation' });
  db.tables.firm_members.push({
    firm_id: FIRM,
    user_id: 'attorney-1',
    role: 'attorney',
  });
  // One hour of the drafter's own time at $250/hr, half an hour of a
  // colleague's at $400/hr. $250.00 + $200.00 = $450.00.
  db.tables.firm_time_entries.push(
    {
      id: 'entry-own',
      firm_id: FIRM,
      case_id: CASE,
      user_id: 'attorney-1',
      description: 'Drafting',
      started_at: '2026-07-01T10:00:00Z',
      ended_at: '2026-07-01T11:00:00Z',
      duration_seconds: 3600,
      rate_cents: 25000,
      billable: true,
      invoice_id: null,
    },
    {
      id: 'entry-partner',
      firm_id: FIRM,
      case_id: CASE,
      user_id: 'partner-9',
      description: 'Review',
      started_at: '2026-07-02T10:00:00Z',
      ended_at: '2026-07-02T10:30:00Z',
      duration_seconds: 1800,
      rate_cents: 40000,
      billable: true,
      invoice_id: null,
    },
  );
}

describe('buildDraftInvoiceAction claims time exactly once', () => {
  beforeEach(() => {
    db.reset();
    sentEmails.length = 0;
    seedFirmAndTime();
  });

  it('claims every attorney’s time on the matter, not just the drafter’s', async () => {
    const res = await buildDraftInvoiceAction(FIRM, CASE, 'client@example.com');

    expect(res.ok).toBe(true);
    expect(res.subtotalCents).toBe(45000);
    expect(res.lineCount).toBe(2);
    const invoiceId = res.invoiceId;
    expect(invoiceId).toBeTruthy();
    for (const e of db.tables.firm_time_entries) {
      expect(e.invoice_id).toBe(invoiceId);
    }
  });

  it('refuses to draft at all when the service-role client is unavailable', async () => {
    db.adminAvailable = false;

    const res = await buildDraftInvoiceAction(FIRM, CASE, 'client@example.com');

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    // Nothing may be created and no time may be stamped: a half-stamped
    // draft is what leaves a colleague's hours re-billable next month.
    expect(db.tables.firm_invoices).toHaveLength(0);
    for (const e of db.tables.firm_time_entries) {
      expect(e.invoice_id).toBeNull();
    }
  });

  it('bills nothing when a concurrent draft takes an entry mid-flight', async () => {
    db.onClaim = () => {
      const partner = db.tables.firm_time_entries.find(
        (e) => e.id === 'entry-partner',
      )!;
      partner.invoice_id = 'invoice-from-the-other-drafter';
    };

    const res = await buildDraftInvoiceAction(FIRM, CASE, 'client@example.com');

    expect(res.ok).toBe(false);
    // The draft must be rolled back entirely, and our own claim released.
    expect(db.tables.firm_invoices).toHaveLength(0);
    const own = db.tables.firm_time_entries.find((e) => e.id === 'entry-own')!;
    expect(own.invoice_id).toBeNull();
    const partner = db.tables.firm_time_entries.find(
      (e) => e.id === 'entry-partner',
    )!;
    expect(partner.invoice_id).toBe('invoice-from-the-other-drafter');
  });
});

describe('sendInvoiceAction', () => {
  beforeEach(() => {
    db.reset();
    sentEmails.length = 0;
    seedFirmAndTime();
    db.tables.firm_invoices.push({
      id: 'inv-1',
      firm_id: FIRM,
      case_id: CASE,
      client_user_id: null,
      client_email: 'client@example.com',
      client_name: 'Acme Ltd',
      number: 'INV-00001',
      status: 'draft',
      subtotal_cents: 45000,
      total_cents: 45000,
      currency: 'USD',
      created_by: 'attorney-1',
      sent_at: null,
    });
  });

  it('moves the draft to sent and emails the client', async () => {
    const res = await sendInvoiceAction('inv-1');

    expect(res.ok).toBe(true);
    const inv = db.tables.firm_invoices[0];
    expect(inv.status).toBe('sent');
    expect(inv.sent_at).toBeTruthy();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('client@example.com');
    expect(res.emailed).toBe(true);
  });

  it('cannot send the same invoice twice', async () => {
    const first = await sendInvoiceAction('inv-1');
    const second = await sendInvoiceAction('inv-1');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    // One send, one email. A second bill in the client's inbox for the same
    // invoice is the thing this guard exists to prevent.
    expect(sentEmails).toHaveLength(1);
  });
});
