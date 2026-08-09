import { createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmMember } from './firm-authz';
import { isIntakeOpen } from './intake-lanes';

/**
 * Firm-wide analytics for the Counsel dashboard. One call fans out
 * firm-scoped reads (RLS already limits them to the caller's firm; we
 * also filter by firm_id) and aggregates in JS so the dashboard can
 * show KPI cards, status breakdowns, and a monthly trend without a
 * pile of bespoke SQL. All money is in integer cents.
 */

export type StatusCount = { status: string; count: number };
export type MonthPoint = { label: string; count: number };

export type FirmAnalytics = {
  requests: {
    total: number;
    open: number;
    thisMonth: number;
    thisYear: number;
    byStatus: StatusCount[];
    monthly: MonthPoint[];
    avgResolutionDays: number | null;
  };
  signing: {
    total: number;
    completed: number;
    completedThisMonth: number;
    byStatus: StatusCount[];
    avgTurnaroundDays: number | null;
  };
  documents: { total: number; byStatus: StatusCount[] };
  cases: { total: number; byStatus: StatusCount[] };
  meetings: { total: number; upcoming: number; thisMonth: number };
  billing: {
    outstandingCents: number;
    paidThisMonthCents: number;
    paidThisYearCents: number;
    byStatus: StatusCount[];
  };
  trust: { bookBalanceCents: number };
  people: { members: number; employees: number };
};

const POSITIVE_TRUST = new Set(['deposit', 'refund', 'interest']);

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short' });
}

function tally(rows: Array<{ status?: string | null }>): StatusCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const s = (r.status ?? 'unknown').trim() || 'unknown';
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

/** Whole-day difference between two ISO timestamps, or null. */
function avgDays(pairs: Array<[string | null, string | null]>): number | null {
  const spans: number[] = [];
  for (const [a, b] of pairs) {
    if (!a || !b) continue;
    const t0 = Date.parse(a);
    const t1 = Date.parse(b);
    if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) continue;
    spans.push((t1 - t0) / 86_400_000);
  }
  if (spans.length === 0) return null;
  return spans.reduce((s, n) => s + n, 0) / spans.length;
}

/**
 * The firm's meetings, read with the SERVICE-ROLE client behind an explicit
 * membership check.
 *
 * Every other read in getFirmAnalytics goes through the user-scoped client,
 * and for every other table that is correct. firm_meetings is different: it
 * has RLS enabled and no policies at all, so a user-scoped select on it
 * returns an empty set for every caller and every firm, with no error. The
 * counts below would then read zero for a firm with a full calendar, and
 * nothing would say so. Every other reader and writer of this table already
 * uses the service-role client, so service-role is the table's design and the
 * user-scoped read here was the bug.
 *
 * The membership check is NOT redundant with the caller's own gate. `firmId`
 * is an argument. Until now RLS was the backstop if a caller ever passed one
 * that was not theirs; once this read bypasses RLS, this check is the only
 * thing left, so it goes in front of the query rather than beside it. It is
 * lib/firm-authz.ts, the one firm authorization axis, not a second one.
 *
 * A caller who is not a member gets an empty list, which is exactly what they
 * got before, so no surface changes shape on the refusal path.
 */
async function readFirmMeetings(
  firmId: string,
): Promise<Array<{ start_at: string }>> {
  if (!(await callerIsFirmMember(firmId))) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from('firm_meetings')
    .select('start_at')
    .eq('firm_id', firmId)
    .limit(5000);
  return (data ?? []) as Array<{ start_at: string }>;
}

export async function getFirmAnalytics(firmId: string): Promise<FirmAnalytics> {
  const supabase = createServerSupabase();
  const now = new Date();
  const monthStart = startOfMonth(now).getTime();
  const yearStart = startOfYear(now).getTime();
  const nowMs = now.getTime();

  const [
    intakesRes,
    signingRes,
    documentsRes,
    casesRes,
    meetingRows,
    invoicesRes,
    trustRes,
    membersRes,
    employeesRes,
  ] = await Promise.all([
    supabase
      .from('firm_matter_intakes')
      .select('status, created_at, updated_at')
      .eq('firm_id', firmId)
      .limit(5000),
    supabase
      .from('firm_signing_requests')
      .select('status, created_at, completed_at')
      .eq('firm_id', firmId)
      .limit(5000),
    supabase.from('firm_documents').select('status').eq('firm_id', firmId).limit(5000),
    supabase.from('cases').select('status').eq('firm_id', firmId).limit(5000),
    readFirmMeetings(firmId),
    supabase
      .from('firm_invoices')
      .select('status, total_cents, paid_at')
      .eq('firm_id', firmId)
      .limit(5000),
    supabase
      .from('firm_trust_transactions')
      .select('kind, amount_cents')
      .eq('firm_id', firmId)
      .limit(20000),
    supabase.from('firm_members').select('id', { count: 'exact', head: true }).eq('firm_id', firmId),
    supabase
      .from('firm_employees')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .is('deactivated_at', null),
  ]);

  // ---- Requests / tickets ----
  const intakes = (intakesRes.data ?? []) as Array<{
    status: string | null;
    created_at: string;
    updated_at: string | null;
  }>;
  // "Open" is the shared definition: needs attention plus in review. It used
  // to mean "not engaged and not rejected", which counted converted and
  // closed requests as still open.
  const isResolved = (s: string | null) => !isIntakeOpen(s);
  const monthly: MonthPoint[] = [];
  const buckets = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), 0);
    monthly.push({ label: monthLabel(d), count: 0 });
  }
  for (const r of intakes) {
    const created = new Date(r.created_at);
    const k = monthKey(created);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  {
    let idx = 0;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthly[idx].count = buckets.get(monthKey(d)) ?? 0;
      idx++;
    }
  }
  const requests = {
    total: intakes.length,
    open: intakes.filter((r) => !isResolved(r.status)).length,
    thisMonth: intakes.filter((r) => Date.parse(r.created_at) >= monthStart).length,
    thisYear: intakes.filter((r) => Date.parse(r.created_at) >= yearStart).length,
    byStatus: tally(intakes),
    monthly,
    avgResolutionDays: avgDays(
      intakes.filter((r) => isResolved(r.status)).map((r) => [r.created_at, r.updated_at]),
    ),
  };

  // ---- Signing ----
  const signing = (signingRes.data ?? []) as Array<{
    status: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
  const signingBlock = {
    total: signing.length,
    completed: signing.filter((s) => s.status === 'completed').length,
    completedThisMonth: signing.filter(
      (s) => s.completed_at && Date.parse(s.completed_at) >= monthStart,
    ).length,
    byStatus: tally(signing),
    avgTurnaroundDays: avgDays(
      signing
        .filter((s) => s.status === 'completed')
        .map((s) => [s.created_at, s.completed_at]),
    ),
  };

  // ---- Documents + cases ----
  const documents = (documentsRes.data ?? []) as Array<{ status: string | null }>;
  const cases = (casesRes.data ?? []) as Array<{ status: string | null }>;

  // ---- Meetings ----
  const meetings = meetingRows;
  const meetingsBlock = {
    total: meetings.length,
    upcoming: meetings.filter((m) => Date.parse(m.start_at) >= nowMs).length,
    thisMonth: meetings.filter((m) => Date.parse(m.start_at) >= monthStart).length,
  };

  // ---- Billing ----
  const invoices = (invoicesRes.data ?? []) as Array<{
    status: string | null;
    total_cents: number;
    paid_at: string | null;
  }>;
  const billing = {
    outstandingCents: invoices
      .filter((i) => i.status === 'sent')
      .reduce((s, i) => s + (i.total_cents ?? 0), 0),
    paidThisMonthCents: invoices
      .filter((i) => i.paid_at && Date.parse(i.paid_at) >= monthStart)
      .reduce((s, i) => s + (i.total_cents ?? 0), 0),
    paidThisYearCents: invoices
      .filter((i) => i.paid_at && Date.parse(i.paid_at) >= yearStart)
      .reduce((s, i) => s + (i.total_cents ?? 0), 0),
    byStatus: tally(invoices),
  };

  // ---- Trust ----
  const trustRows = (trustRes.data ?? []) as Array<{ kind: string; amount_cents: number }>;
  const bookBalanceCents = trustRows.reduce(
    (s, t) =>
      s +
      (POSITIVE_TRUST.has(t.kind) ? t.amount_cents : -t.amount_cents),
    0,
  );

  return {
    requests,
    signing: signingBlock,
    documents: { total: documents.length, byStatus: tally(documents) },
    cases: { total: cases.length, byStatus: tally(cases) },
    meetings: meetingsBlock,
    billing,
    trust: { bookBalanceCents },
    people: {
      members: membersRes.count ?? 0,
      employees: employeesRes.count ?? 0,
    },
  };
}
