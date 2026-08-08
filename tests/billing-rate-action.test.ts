import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * setFirmMemberRateAction is the only thing in the product that writes
 * firm_members.default_rate_cents, and the only thing that can put a price on
 * hours that were logged before a rate existed. It is a `'use server'` export,
 * so it is a public HTTP endpoint: the Team page choosing not to draw a control
 * is not a gate, and every property below is asserted against a direct call.
 *
 * Three properties are load-bearing:
 *
 *   1. Owner and admin only, decided by the real lib/firm-authz.ts. A rate
 *      change is a change to what a client is charged.
 *   2. An invalid rate is REFUSED, and the stored value is unchanged. Refusing
 *      and coercing both "handle" a bad input; only one of them keeps $1.50
 *      from being billed as $150.00.
 *   3. Repricing reaches every member's hours (so it goes through the
 *      service-role client, since the firm_time_entries write policy is
 *      self-scoped) but never reaches an entry that an invoice has already
 *      claimed and summed.
 *
 * The real firm-authz runs here. Only the two Supabase clients, the trial
 * state, and revalidatePath are stood in for.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: { id: 'user-owner', email: 'owner@example.test' } as {
    id: string;
    email: string;
  } | null,
  tables: {} as Record<string, Row[]>,
  adminAvailable: true,
  /**
   * Whether the fake enforces `firm_members_owner_admin_update`.
   *
   * Set false to take the DATABASE gate away and leave only the code gate, so
   * a test can prove which of the two refused. With it on, an under-privileged
   * caller is stopped twice and swapping callerIsFirmAdmin for a weaker check
   * changes nothing observable - the refusal just arrives from the other gate,
   * one line later, wearing a different message.
   */
  enforceMemberUpdateRls: true,
  seq: 0,
  reset() {
    this.user = { id: 'user-owner', email: 'owner@example.test' };
    this.tables = { firm_members: [], firm_time_entries: [] };
    this.adminAvailable = true;
    this.enforceMemberUpdateRls = true;
    this.seq = 0;
  },
}));

/**
 * Chainable stand-in for PostgREST. `rls: true` models the live
 * firm_time_entries write policy, USING (user_id = auth.uid()) - without it the
 * member client and the service-role client are indistinguishable and a test
 * cannot tell whether a colleague's hours were actually repriced.
 */
class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | null = null;

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
  eq(col: string, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown) {
    this.preds.push((r) => (r[col] ?? null) === val);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }

  private run(): { data: Row[]; error: unknown } {
    const table = (db.tables[this.table] ??= []);
    if (this.op === 'insert') {
      const row: Row = { id: `id-${++db.seq}`, ...(this.payload ?? {}) };
      table.push(row);
      return { data: [row], error: null };
    }
    let rows = table.filter((r) => this.preds.every((p) => p(r)));
    if (this.rls && this.table === 'firm_time_entries' && this.op === 'update') {
      rows = rows.filter((r) => r.user_id === db.user?.id);
    }
    if (
      this.rls &&
      db.enforceMemberUpdateRls &&
      this.table === 'firm_members' &&
      this.op === 'update'
    ) {
      // firm_members_owner_admin_update: the caller must hold owner/admin.
      const caller = table.find(
        (r) => r.user_id === db.user?.id && r.firm_id === FIRM,
      );
      if (!caller || !['owner', 'admin'].includes(String(caller.role))) rows = [];
    }
    if (this.op === 'update') {
      for (const r of rows) Object.assign(r, this.payload);
      return { data: [...rows], error: null };
    }
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

const memberClient = { from: (t: string) => new Query(t, true) };
const adminClient = { from: (t: string) => new Query(t, false) };

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => memberClient,
  getCurrentUser: async () => db.user,
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => (db.adminAvailable ? adminClient : null),
}));
vi.mock('../lib/firm-trials', () => ({
  firmTrialState: async () => 'active',
}));

const { setFirmMemberRateAction, listFirmMemberRatesAction } = await import(
  '../lib/time-tracking'
);

const FIRM = 'firm-1';

function member(userId: string, role: string, rate: number | null = null) {
  db.tables.firm_members.push({
    id: `m-${userId}`,
    firm_id: FIRM,
    user_id: userId,
    role,
    default_rate_cents: rate,
  });
}

function entry(over: Row) {
  db.tables.firm_time_entries.push({
    id: `e-${db.tables.firm_time_entries.length + 1}`,
    firm_id: FIRM,
    user_id: 'user-attorney',
    duration_seconds: 3600,
    billable: true,
    rate_cents: null,
    invoice_id: null,
    ...over,
  });
}

function storedRate(userId: string): number | null | undefined {
  return db.tables.firm_members.find((r) => r.user_id === userId)
    ?.default_rate_cents as number | null | undefined;
}

function seed() {
  member('user-owner', 'owner');
  member('user-admin', 'admin');
  member('user-attorney', 'attorney');
  member('user-paralegal', 'paralegal');
  member('user-staff', 'staff');
}

beforeEach(() => {
  db.reset();
  seed();
});

describe('only an owner or admin may set a billing rate', () => {
  it('lets an owner set one', async () => {
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
    expect(res.ok).toBe(true);
    expect(storedRate('user-attorney')).toBe(45000);
  });

  it('lets an admin set one', async () => {
    db.user = { id: 'user-admin', email: 'admin@example.test' };
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
    expect(res.ok).toBe(true);
    expect(storedRate('user-attorney')).toBe(45000);
  });

  it.each(['user-attorney', 'user-paralegal', 'user-staff'])(
    'refuses %s, who is a member but not an owner or admin',
    async (caller) => {
      db.user = { id: caller, email: `${caller}@example.test` };
      const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
      expect(res.ok).toBe(false);
      // The message identifies WHICH gate refused. Without this the code gate
      // could be swapped for any weaker check and the test would still pass on
      // the RLS refusal that arrives one line later.
      expect(res.error).toBe('Only an owner or admin can set billing rates.');
      expect(storedRate('user-attorney')).toBeNull();
    },
  );

  it.each(['user-attorney', 'user-paralegal', 'user-staff'])(
    'refuses %s with the database policy taken away, so the code gate is the one refusing',
    async (caller) => {
      db.enforceMemberUpdateRls = false;
      db.user = { id: caller, email: `${caller}@example.test` };
      const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Only an owner or admin can set billing rates.');
      expect(storedRate('user-attorney')).toBeNull();
    },
  );

  it('refuses an attorney trying to set their OWN rate', async () => {
    db.user = { id: 'user-attorney', email: 'a@example.test' };
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 99900);
    expect(res.ok).toBe(false);
    expect(storedRate('user-attorney')).toBeNull();
  });

  it('refuses an owner of a DIFFERENT firm', async () => {
    db.tables.firm_members.push({
      id: 'm-outsider',
      firm_id: 'firm-2',
      user_id: 'user-outsider',
      role: 'owner',
      default_rate_cents: null,
    });
    db.user = { id: 'user-outsider', email: 'out@example.test' };
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
    expect(res.ok).toBe(false);
    expect(storedRate('user-attorney')).toBeNull();
  });

  it('refuses a signed-out caller', async () => {
    db.user = null;
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
    expect(res.ok).toBe(false);
    expect(storedRate('user-attorney')).toBeNull();
  });

  it('refuses to reprice anyone when the caller is not an owner or admin', async () => {
    // The reprice runs through the service-role client, so this gate is the
    // ONLY thing standing in front of it. Take the database policy away to
    // prove that.
    db.enforceMemberUpdateRls = false;
    entry({ user_id: 'user-attorney', rate_cents: null });
    db.user = { id: 'user-paralegal', email: 'p@example.test' };
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000, {
      applyToUnbilled: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Only an owner or admin can set billing rates.');
    expect(db.tables.firm_time_entries[0].rate_cents).toBeNull();
  });

  it('refuses a non-admin reading the firm rate sheet', async () => {
    db.user = { id: 'user-attorney', email: 'a@example.test' };
    const res = await listFirmMemberRatesAction(FIRM);
    expect(res.ok).toBe(false);
    expect(res.rates).toBeUndefined();
  });
});

describe('an invalid rate is refused, not coerced', () => {
  const BAD: Array<[string, unknown]> = [
    ['zero', 0],
    ['negative', -45000],
    ['a fractional cent', 450.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['past the sanity bound', 1_000_001],
    ['a numeric string', '45000'],
    ['a boolean', true],
    ['an object', {}],
    ['undefined', undefined],
  ];

  it.each(BAD)('refuses %s and leaves the stored rate alone', async (_l, bad) => {
    db.tables.firm_members.find((r) => r.user_id === 'user-attorney')!
      .default_rate_cents = 30000;
    const res = await setFirmMemberRateAction(
      FIRM,
      'user-attorney',
      bad as number,
    );
    expect(res.ok).toBe(false);
    expect(storedRate('user-attorney')).toBe(30000);
  });

  it.each(BAD)('refuses %s before repricing any time entry', async (_l, bad) => {
    entry({ user_id: 'user-attorney', rate_cents: 30000 });
    const res = await setFirmMemberRateAction(
      FIRM,
      'user-attorney',
      bad as number,
      { applyToUnbilled: true },
    );
    expect(res.ok).toBe(false);
    expect(db.tables.firm_time_entries[0].rate_cents).toBe(30000);
  });

  it('accepts null, which clears the rate', async () => {
    db.tables.firm_members.find((r) => r.user_id === 'user-attorney')!
      .default_rate_cents = 30000;
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', null);
    expect(res.ok).toBe(true);
    expect(storedRate('user-attorney')).toBeNull();
  });

  it('refuses a user who is not a member of this firm', async () => {
    const res = await setFirmMemberRateAction(FIRM, 'user-stranger', 45000);
    expect(res.ok).toBe(false);
  });
});

describe('repricing reaches unbilled hours and stops at invoiced ones', () => {
  it('does nothing to existing time unless asked', async () => {
    entry({ user_id: 'user-attorney', rate_cents: null });
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000);
    expect(res.ok).toBe(true);
    expect(res.repricedEntries).toBe(0);
    expect(db.tables.firm_time_entries[0].rate_cents).toBeNull();
  });

  it('reprices a colleague’s unbilled hours, which an RLS-scoped write could not', async () => {
    // The caller is the owner; the hours belong to someone else. The
    // firm_time_entries write policy is USING (user_id = auth.uid()), so this
    // only passes if the update went through the service-role client.
    entry({ user_id: 'user-attorney', rate_cents: null });
    entry({ user_id: 'user-paralegal', rate_cents: null });
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000, {
      applyToUnbilled: true,
    });
    expect(res.ok).toBe(true);
    expect(res.repricedEntries).toBe(1);
    expect(db.tables.firm_time_entries[0].rate_cents).toBe(45000);
    // Only the named member's hours move.
    expect(db.tables.firm_time_entries[1].rate_cents).toBeNull();
  });

  it('never reprices an entry an invoice has already claimed', async () => {
    entry({ user_id: 'user-attorney', rate_cents: null, invoice_id: null });
    entry({ user_id: 'user-attorney', rate_cents: 0, invoice_id: 'inv-1' });
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000, {
      applyToUnbilled: true,
    });
    expect(res.ok).toBe(true);
    expect(res.repricedEntries).toBe(1);
    expect(db.tables.firm_time_entries[0].rate_cents).toBe(45000);
    // Repricing this one would leave the invoice's stored subtotal_cents
    // disagreeing with its own lines, on a document that may be with a client.
    expect(db.tables.firm_time_entries[1].rate_cents).toBe(0);
  });

  it('reprices only within the named firm', async () => {
    entry({ user_id: 'user-attorney', rate_cents: null });
    entry({ user_id: 'user-attorney', rate_cents: null, firm_id: 'firm-2' });
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000, {
      applyToUnbilled: true,
    });
    expect(res.ok).toBe(true);
    expect(res.repricedEntries).toBe(1);
    expect(db.tables.firm_time_entries[1].rate_cents).toBeNull();
  });

  it('says so rather than silently repricing nothing when the service role is missing', async () => {
    entry({ user_id: 'user-attorney', rate_cents: null });
    db.adminAvailable = false;
    const res = await setFirmMemberRateAction(FIRM, 'user-attorney', 45000, {
      applyToUnbilled: true,
    });
    expect(res.ok).toBe(false);
    expect(db.tables.firm_time_entries[0].rate_cents).toBeNull();
  });
});

describe('listFirmMemberRatesAction', () => {
  it('returns the whole firm’s rates to an owner', async () => {
    db.tables.firm_members.find((r) => r.user_id === 'user-attorney')!
      .default_rate_cents = 45000;
    const res = await listFirmMemberRatesAction(FIRM);
    expect(res.ok).toBe(true);
    expect(res.rates?.['user-attorney']).toBe(45000);
    expect(res.rates?.['user-paralegal']).toBeNull();
  });
});
