import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 *     two payment links or mail the client twice,
 *   - no invoice that has left the live-and-unpaid state leaves a payable
 *     Stripe link behind, and a payment made through one of those links is
 *     reconciled back onto the invoice instead of waiting for someone to
 *     notice the money and click "Mark paid".
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /**
   * Fires the instant a firm_time_entries update is EXECUTED, before its
   * predicates are evaluated - the window a concurrent drafter would use.
   */
  onClaim: null as null | (() => void),
  /** Same idea for the draft -> sent transition on firm_invoices. */
  onSend: null as null | (() => void),
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
    this.onSend = null;
    this.adminAvailable = true;
    this.seq = 0;
  },
}));

/** The signed-in attorney every RLS-scoped query is evaluated as. */
const AUTH_UID = 'attorney-1';

const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string }>,
  /** Set false to make the provider reject, as an unset API key would. */
  deliverable: true,
  reset() {
    this.sent = [];
    this.deliverable = true;
  },
}));

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

  /**
   * `rls: true` models the firm_time_entries write policy the RLS-scoped
   * client is subject to: USING (user_id = auth.uid() AND invoice_id IS
   * NULL). Without this the fake makes the service-role client and the
   * member client indistinguishable, and a test cannot tell whether a
   * colleague's hours were really claimed.
   */
  constructor(
    private table: string,
    private rls = false,
  ) {}

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
    if (this.table === 'firm_invoices' && this.op === 'update' && db.onSend) {
      const hook = db.onSend;
      db.onSend = null;
      hook();
    }

    let rows = table.filter((r) => this.preds.every((p) => p(r)));

    if (
      this.rls &&
      this.table === 'firm_time_entries' &&
      (this.op === 'update' || this.op === 'delete')
    ) {
      rows = rows.filter(
        (r) => r.user_id === AUTH_UID && (r.invoice_id ?? null) === null,
      );
    }

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

/** The member-scoped client: subject to RLS. */
const memberClient = {
  from: (table: string) => new Query(table, true),
};
/** The service-role client: bypasses RLS. */
const adminClient = {
  from: (table: string) => new Query(table, false),
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
    },
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => memberClient,
  getCurrentUser: async () => ({ id: AUTH_UID, email: 'a@firm.test' }),
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => (db.adminAvailable ? adminClient : null),
}));
vi.mock('../lib/notifications', () => ({ createNotification: async () => null }));
vi.mock('../lib/email', () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    if (!mail.deliverable) {
      return { ok: false, error: 'RESEND_API_KEY not configured.' };
    }
    mail.sent.push({ to: input.to, subject: input.subject });
    return { ok: true, id: 'email-1' };
  },
  buildInvoiceEmailHtml: () => '<p>invoice</p>',
  invoiceEmailIdempotencyKey: (i: { invoiceId: string }) =>
    `invoice-${i.invoiceId}`,
}));

const {
  buildDraftInvoiceAction,
  sendInvoiceAction,
  markInvoicePaidAction,
  voidInvoiceAction,
  deleteDraftInvoiceAction,
} = await import('../lib/invoicing');
const { applyStripeInvoicePayment } = await import('../lib/invoicing-stripe');

const FIRM = 'firm-1';
const CASE = 'case-1';

/**
 * Stand-in for the Stripe REST calls the payment-link lifecycle makes.
 * Records which links were minted and which were deactivated, because
 * "was this link switched off" is the whole assertion for half of these
 * tests - a Stripe payment link is REUSABLE, so one left live on a voided
 * or already-paid invoice is a second charge waiting to happen.
 */
const stripe = {
  created: [] as Array<Record<string, string>>,
  deactivated: [] as string[],
  seq: 0,
  reset() {
    this.created = [];
    this.deactivated = [];
    this.seq = 0;
  },
};

function installStripeStub() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = Object.fromEntries(
      new URLSearchParams(String(init?.body ?? '')),
    ) as Record<string, string>;

    const deactivate = /\/v1\/payment_links\/(plink_[^/]+)$/.exec(String(url));
    if (deactivate) {
      stripe.deactivated.push(deactivate[1]);
      return new Response(JSON.stringify({ id: deactivate[1], active: false }), {
        status: 200,
      });
    }
    if (String(url).endsWith('/v1/payment_links')) {
      const id = `plink_${++stripe.seq}`;
      stripe.created.push(body);
      return new Response(
        JSON.stringify({ id, url: `https://buy.stripe.com/${id}` }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

function seedSentInvoiceWithLink(over: Row = {}) {
  db.tables.firm_invoices.push({
    id: 'inv-1',
    firm_id: FIRM,
    case_id: CASE,
    client_user_id: null,
    client_email: 'client@example.com',
    client_name: 'Acme Ltd',
    number: 'INV-00001',
    status: 'sent',
    subtotal_cents: 45000,
    total_cents: 45000,
    currency: 'USD',
    created_by: 'attorney-1',
    sent_at: '2026-07-05T09:00:00Z',
    paid_at: null,
    stripe_payment_link: 'https://buy.stripe.com/plink_live',
    stripe_payment_link_id: 'plink_live',
    stripe_payment_intent_id: null,
    ...over,
  });
}

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
    mail.reset();
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
    // Nothing may be created and no time may be stamped. Falling back to
    // the member client here is what caused the double bill: RLS would
    // let it stamp entry-own and silently skip entry-partner, so the
    // partner's hours would sit inside this invoice's total and still
    // read as unbilled next month.
    expect(db.tables.firm_invoices).toHaveLength(0);
    for (const e of db.tables.firm_time_entries) {
      expect(e.invoice_id).toBeNull();
    }
  });

  it('the member client alone could not claim a colleague’s time', async () => {
    // Guards the premise of the test above: if the write policy were ever
    // widened so the member client could claim firm-wide, the refusal
    // would be unnecessary. Asserted against the policy the fake models:
    // USING (user_id = auth.uid() AND invoice_id IS NULL).
    const { createServerSupabase } = await import('../lib/supabase/server');
    await createServerSupabase()
      .from('firm_time_entries')
      .update({ invoice_id: 'some-invoice' })
      .in('id', ['entry-own', 'entry-partner'])
      .is('invoice_id', null)
      .select('id');

    const own = db.tables.firm_time_entries.find((e) => e.id === 'entry-own')!;
    const partner = db.tables.firm_time_entries.find(
      (e) => e.id === 'entry-partner',
    )!;
    expect(own.invoice_id).toBe('some-invoice');
    expect(partner.invoice_id).toBeNull();
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
    mail.reset();
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
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('client@example.com');
    expect(res.emailed).toBe(true);
  });

  it('cannot send the same invoice twice', async () => {
    const first = await sendInvoiceAction('inv-1');
    const second = await sendInvoiceAction('inv-1');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    // One send, one email. A second bill in the client's inbox for the same
    // invoice is the thing this guard exists to prevent.
    expect(mail.sent).toHaveLength(1);
  });

  it('loses the race, and mails nothing, when another send lands first', async () => {
    // A colleague (or a second click) flips the invoice to sent in the
    // window between our read and our write. The status guard on the
    // update must catch it, before any mail or payment link exists.
    db.onSend = () => {
      db.tables.firm_invoices[0].status = 'sent';
    };

    const res = await sendInvoiceAction('inv-1');

    expect(res.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it('returns the invoice to draft when nothing reached the client', async () => {
    // No email, and no account to notify in the app. An invoice nobody was
    // told about must not sit in Outstanding as money owed.
    mail.deliverable = false;

    const res = await sendInvoiceAction('inv-1');

    expect(res.ok).toBe(false);
    expect(res.emailed).toBe(false);
    const inv = db.tables.firm_invoices[0];
    expect(inv.status).toBe('draft');
    expect(inv.sent_at).toBeNull();
  });
});

/**
 * A Stripe payment link is reusable and lives until it is explicitly
 * deactivated. Every exit from "live and unpaid" therefore has to switch
 * the link off, or the client keeps a working Pay button for an invoice
 * that was voided, replaced, or already settled.
 */
describe('the payment link dies with the invoice', () => {
  beforeEach(() => {
    db.reset();
    mail.reset();
    stripe.reset();
    seedFirmAndTime();
    installStripeStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('records the link id alongside the URL when sending', async () => {
    db.tables.firm_invoices.push({
      id: 'inv-1',
      firm_id: FIRM,
      case_id: CASE,
      client_user_id: null,
      client_email: 'client@example.com',
      number: 'INV-00001',
      status: 'draft',
      total_cents: 45000,
      currency: 'USD',
      created_by: 'attorney-1',
      sent_at: null,
    });

    const res = await sendInvoiceAction('inv-1');

    expect(res.ok).toBe(true);
    const inv = db.tables.firm_invoices[0];
    // The URL alone cannot be turned off later: deactivation needs the
    // plink_ id, and buy.stripe.com/... does not contain it.
    expect(inv.stripe_payment_link).toBe('https://buy.stripe.com/plink_1');
    expect(inv.stripe_payment_link_id).toBe('plink_1');
    // ...and the link has to carry the invoice, or a payment made through
    // it arrives at the webhook with nothing to reconcile against.
    expect(stripe.created[0]['metadata[advottic_invoice_id]']).toBe('inv-1');
  });

  it('switches the link off when the invoice is voided', async () => {
    seedSentInvoiceWithLink();

    const res = await voidInvoiceAction(FIRM, 'inv-1');

    expect(res.ok).toBe(true);
    expect(stripe.deactivated).toEqual(['plink_live']);
    expect(db.tables.firm_invoices[0].stripe_payment_link).toBeNull();
  });

  it('switches the link off when a failed send rolls back to draft', async () => {
    // Nothing reached the client, so the invoice returns to draft and will
    // be sent again. The link minted on this attempt must not stay payable:
    // the retry mints a fresh one, and two live links for one invoice is
    // how a client pays twice.
    mail.deliverable = false;
    db.tables.firm_invoices.push({
      id: 'inv-1',
      firm_id: FIRM,
      case_id: CASE,
      client_user_id: null,
      client_email: 'client@example.com',
      number: 'INV-00001',
      status: 'draft',
      total_cents: 45000,
      currency: 'USD',
      created_by: 'attorney-1',
      sent_at: null,
    });

    const res = await sendInvoiceAction('inv-1');

    expect(res.ok).toBe(false);
    expect(stripe.created).toHaveLength(1);
    expect(stripe.deactivated).toEqual(['plink_1']);
    const inv = db.tables.firm_invoices[0];
    expect(inv.status).toBe('draft');
    expect(inv.stripe_payment_link).toBeNull();
    expect(inv.stripe_payment_link_id).toBeNull();
  });

  it('switches the link off when the firm marks the invoice paid by hand', async () => {
    // The wire landed, so the firm marks it paid. The Stripe link is still
    // a working Pay button until we say otherwise, and the client has it
    // in their inbox.
    seedSentInvoiceWithLink();

    const res = await markInvoicePaidAction('inv-1');

    expect(res.ok).toBe(true);
    expect(db.tables.firm_invoices[0].status).toBe('paid');
    expect(stripe.deactivated).toEqual(['plink_live']);
  });

  it('switches the link off when a draft carrying one is deleted', async () => {
    seedSentInvoiceWithLink({ status: 'draft', sent_at: null });

    const res = await deleteDraftInvoiceAction(FIRM, 'inv-1');

    expect(res.ok).toBe(true);
    expect(stripe.deactivated).toEqual(['plink_live']);
  });

  it('still voids the invoice when Stripe will not take the deactivation', async () => {
    // Stripe being down must not block the firm from voiding a mis-sent
    // invoice. The void is the important half; the dead link is reported.
    seedSentInvoiceWithLink();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));

    const res = await voidInvoiceAction(FIRM, 'inv-1');

    expect(res.ok).toBe(true);
    expect(db.tables.firm_invoices[0].status).toBe('void');
    expect(res.error).toMatch(/payment link/i);
  });
});

/**
 * Money that arrives through a Stripe link has to land back on the
 * invoice. Without this the firm's Outstanding figure counts revenue it
 * has already been paid, and someone has to spot the payout in Stripe and
 * click "Mark paid" by hand.
 */
describe('applyStripeInvoicePayment', () => {
  beforeEach(() => {
    db.reset();
    mail.reset();
    stripe.reset();
    seedFirmAndTime();
    installStripeStub();
    seedSentInvoiceWithLink();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('marks the invoice paid and records the payment intent', async () => {
    const res = await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(res.outcome).toBe('paid');
    const inv = db.tables.firm_invoices[0];
    expect(inv.status).toBe('paid');
    expect(inv.paid_at).toBeTruthy();
    expect(inv.stripe_payment_intent_id).toBe('pi_123');
  });

  it('finds the invoice from the link id when the session carries no metadata', async () => {
    // Links minted before the metadata existed, and any event where Stripe
    // hands us the link but not the copied metadata, still have to reconcile.
    const res = await applyStripeInvoicePayment({
      invoiceId: null,
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(res.outcome).toBe('paid');
    expect(db.tables.firm_invoices[0].status).toBe('paid');
  });

  it('deactivates the link so the same invoice cannot be paid twice', async () => {
    await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(stripe.deactivated).toEqual(['plink_live']);
  });

  it('is a no-op on redelivery, because Stripe delivers at least once', async () => {
    const first = await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });
    const second = await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(first.outcome).toBe('paid');
    expect(second.outcome).toBe('already_paid');
    // The redelivery must not restamp paid_at either: "when did this clear"
    // is the date the firm reconciles against, not the date Stripe last
    // happened to retry.
    const inv = db.tables.firm_invoices[0];
    expect(inv.paid_at).toBe(first.outcome === 'paid' ? first.paidAt : null);
  });

  it('does not resurrect a voided invoice, and says so', async () => {
    // Real money against a receivable that was written off. Flipping it to
    // paid would put the void back in AR as collected; the correct move is
    // to leave the status alone and make sure a person hears about it.
    db.tables.firm_invoices[0].status = 'void';

    const res = await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(res.outcome).toBe('not_live');
    expect(db.tables.firm_invoices[0].status).toBe('void');
  });

  it('reports a payment it cannot match rather than swallowing it', async () => {
    const res = await applyStripeInvoicePayment({
      invoiceId: null,
      paymentLinkId: 'plink_from_some_other_product',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(res.outcome).toBe('unmatched');
  });

  it('asks to be retried rather than dropping the payment when the service role is missing', async () => {
    // Returning "handled" here would 2xx the webhook and lose the only
    // notice we get that this invoice was paid.
    db.adminAvailable = false;

    const res = await applyStripeInvoicePayment({
      invoiceId: 'inv-1',
      paymentLinkId: 'plink_live',
      paymentIntentId: 'pi_123',
      amountCents: 45000,
      currency: 'usd',
    });

    expect(res.outcome).toBe('unavailable');
    expect(db.tables.firm_invoices[0].status).toBe('sent');
  });
});
