import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Impact page's money, held to the definition the rest of the product
 * already uses.
 *
 * Two defects lived in getFirmImpact, and they are the same defect twice.
 *
 * 1. "Unbilled time" meant something different here than anywhere else.
 *    buildDraftInvoiceAction, the matter page's "Draft for $X" button and
 *    /counsel/billing all select billable, not-yet-invoiced entries that
 *    have ENDED with a positive duration. This block left `ended_at` out,
 *    so a still-running timer that had already written a duration counted
 *    as money ready to invoice on the Impact page and on no other screen.
 *    Three surfaces said "Unbilled"; this was the one that meant
 *    something else by it.
 *
 * 2. The reads were capped - 5000 matters, 20000 time entries - under a
 *    header that said "All reads are bounded", while the page printed
 *    what came back as firm totals and as the denominator of every
 *    percentage on it. A capped read is a floor. A floor under the label
 *    "Unbilled time" is a wrong number, not a careful one.
 *
 * WHAT THIS TEST DRIVES. The real getFirmImpact. Only the two client
 * factories are faked, and the fake actually APPLIES the filters the
 * query builds rather than recording that they were called: the running
 * timer below is filtered out by the query or it is not, and the money
 * says which. Asserting on recorded call names alone would pass against a
 * `.not()` aimed at the wrong column.
 */

const T0 = new Date('2026-08-09T12:00:00Z');

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Every `.limit()` the code applied, by table. */
  limits: {} as Record<string, number[]>,
}));

const CASES: Row[] = [
  {
    id: 'c1',
    title: 'Bramble',
    status: 'open',
    case_type: 'contract',
    posture: 'claimant',
    hearing_at: null,
    hearing_location: null,
    created_at: '2026-08-01T00:00:00Z',
  },
];

/**
 * One entry of each kind that matters, all billable and all uninvoiced,
 * so the only thing separating them is whether they have ended.
 *
 * $100/h. The closed hour is $100 of unbilled work. The running one is
 * not billable work yet at all - it is a timer somebody left going.
 */
const TIME: Row[] = [
  {
    id: 't1',
    duration_seconds: 3600,
    billable: true,
    rate_cents: 10000,
    invoice_id: null,
    ended_at: '2026-08-08T10:00:00Z',
  },
  {
    id: 't2',
    duration_seconds: 1800,
    billable: true,
    rate_cents: 10000,
    invoice_id: null,
    ended_at: null, // still running
  },
  {
    id: 't3',
    duration_seconds: 3600,
    billable: true,
    rate_cents: 10000,
    invoice_id: 'inv-1',
    ended_at: '2026-08-07T10:00:00Z',
  },
  {
    id: 't4',
    duration_seconds: 0,
    billable: true,
    rate_cents: 10000,
    invoice_id: null,
    ended_at: '2026-08-06T10:00:00Z', // ended with nothing on it
  },
];

const ROWS: Record<string, Row[]> = {
  cases: CASES,
  firm_time_entries: TIME,
  firm_invoices: [
    { status: 'sent', total_cents: 5000, paid_at: null },
    { status: 'paid', total_cents: 2500, paid_at: '2026-08-05T00:00:00Z' },
  ],
  firm_matter_intakes: [
    { status: 'in_progress', created_at: '2026-08-08T00:00:00Z', updated_at: null },
    { status: 'converted', created_at: '2026-07-08T00:00:00Z', updated_at: null },
  ],
};

/**
 * A query builder that filters. Thin, but faithful on the three
 * predicates this module uses, because the point of the test is which
 * rows come back.
 */
function builder(table: string, rows: Row[]) {
  let current = rows;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, value: unknown) => {
    current = current.filter((r) => r[col] === value || col === 'firm_id');
    return q;
  };
  q.in = (col: string, values: unknown[]) => {
    current = current.filter((r) => values.includes(r[col]));
    return q;
  };
  q.is = (col: string, value: unknown) => {
    current = current.filter((r) => (value === null ? r[col] == null : r[col] === value));
    return q;
  };
  q.not = (col: string, op: string, value: unknown) => {
    if (op === 'is' && value === null) {
      current = current.filter((r) => r[col] != null);
    }
    return q;
  };
  q.gt = (col: string, value: number) => {
    current = current.filter((r) => Number(r[col] ?? 0) > value);
    return q;
  };
  q.gte = () => q;
  q.lte = () => q;
  q.order = () => q;
  q.limit = (n: number) => {
    (state.limits[table] ??= []).push(n);
    current = current.slice(0, n);
    return q;
  };
  const settle = () => ({ data: current, error: null, count: current.length });
  q.maybeSingle = async () => ({ data: current[0] ?? null, error: null });
  q.then = (onFulfilled: (v: ReturnType<typeof settle>) => unknown) =>
    Promise.resolve(settle()).then(onFulfilled);
  return q;
}

vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => ({
    from: (table: string) => builder(table, ROWS[table] ?? []),
  }),
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  isSupabaseConfigured: () => true,
}));

vi.mock('../lib/supabase/admin', () => ({
  // Evidence is not this test's subject; the service role is absent so the
  // evidence block takes its documented degrade-to-zero path.
  createAdminSupabase: () => null,
  isServiceRoleConfigured: () => false,
}));

const { getFirmImpact } = await import('../lib/counsel-impact');
const { getFirmAnalytics } = await import('../lib/counsel-analytics');

beforeEach(() => {
  vi.setSystemTime(T0);
  state.limits = {};
});

describe('Impact means what billing means by "unbilled"', () => {
  it('counts a closed billable hour and nothing else as unbilled', async () => {
    const impact = await getFirmImpact('firm-1');
    // t1 only: $100. t2 is still running, t3 is already invoiced, t4 has
    // no time on it.
    expect(impact.time.unbilledCents).toBe(10000);
  });

  it('leaves a running timer out of every time figure', async () => {
    const impact = await getFirmImpact('firm-1');
    // t1 + t3 = 2 hours ended. The half hour on the open timer is not
    // logged work yet, and counting its money as ready to invoice was
    // the defect.
    expect(impact.time.hoursLogged).toBe(2);
    expect(impact.time.billableHours).toBe(2);
    expect(impact.time.entries).toBe(2);
  });

  it('still separates billed from unbilled', async () => {
    const impact = await getFirmImpact('firm-1');
    expect(impact.time.billedCents).toBe(10000);
  });
});

describe('the figures the page states as totals are read as totals', () => {
  it('does not cap the matters read, which every percentage divides by', async () => {
    const impact = await getFirmImpact('firm-1');
    expect(impact.matters.total).toBe(1);
    expect(state.limits.cases ?? []).toEqual([]);
  });

  it('does not cap the time read', async () => {
    await getFirmImpact('firm-1');
    expect(state.limits.firm_time_entries ?? []).toEqual([]);
  });

  it('says in the file which bound is left, rather than claiming none', async () => {
    // The header used to read "All reads are bounded" while the page
    // presented those reads as totals. It now names the one bound that
    // survives, on case_timeline_events, so the next reader finds the
    // limitation next to the code instead of on a screen.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../lib/counsel-impact.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toContain('All reads are bounded');
    expect(src).toContain('case_timeline_events');
    // And the bound it names is really still there.
    expect(/\.limit\(20000\)/.test(src)).toBe(true);
  });
});

/**
 * The same rule applied to the other half of the Impact page.
 *
 * getFirmAnalytics supplies three figures that page states as firm
 * totals, and two of them sit beside the SAME figure computed somewhere
 * else: "invoiced, unpaid" next to /counsel/billing's uncapped
 * Outstanding, and "Open requests" next to the lane count the dashboard
 * now takes exactly. A cap on either makes two screens disagree about
 * one number while both look fine.
 */
describe('the analytics figures that sit next to another screen are uncapped', () => {
  it('reads every invoice, the way /counsel/billing does', async () => {
    const a = await getFirmAnalytics('firm-1');
    expect(a.billing.outstandingCents).toBe(5000);
    expect(state.limits.firm_invoices ?? []).toEqual([]);
  });

  it('reads every request, so "open" matches the dashboard count', async () => {
    const a = await getFirmAnalytics('firm-1');
    // in_progress is open; converted is not.
    expect(a.requests.open).toBe(1);
    expect(a.requests.total).toBe(2);
    expect(state.limits.firm_matter_intakes ?? []).toEqual([]);
  });

  it('leaves the bounds on the reads that only feed breakdowns', async () => {
    // Scoping matters: this was two deliberate exceptions, not a sweep
    // that took every limit off the module. If somebody later states one
    // of these as a total, the bound has to be revisited on purpose.
    await getFirmAnalytics('firm-1');
    for (const table of [
      'firm_signing_requests',
      'firm_documents',
      'firm_trust_transactions',
    ]) {
      expect(state.limits[table] ?? [], `${table} lost its bound`).not.toEqual(
        [],
      );
    }
  });
});
