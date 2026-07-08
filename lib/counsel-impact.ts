import { createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { relevanceBand } from './timeline-types';
import type { StatusCount, MonthPoint } from './counsel-analytics';

/**
 * Case-centric "Impact" metrics for the firm dashboard. These sit
 * alongside getFirmAnalytics (which covers requests, signing, billing,
 * trust, and people) and add the matter / evidence / schedule / time
 * view the Impact dashboard leads with.
 *
 * Firm scoping:
 *   - cases + firm_time_entries carry firm_id and are member-readable,
 *     so the user-scoped client is enough.
 *   - case_timeline_events has NO firm_id and its RLS is case-member
 *     based, so a firm owner who is not a member of every matter would
 *     under-count. We read it through the admin client, but ONLY for
 *     case ids we have already confirmed belong to this firm - never a
 *     broad read. If the service role is not configured the evidence
 *     block degrades to zeros rather than throwing.
 *
 * All money is integer cents. All reads are bounded.
 */

export type Bucket = { key: string; label: string; count: number };

export type FirmImpact = {
  matters: {
    total: number;
    open: number;
    byStatus: StatusCount[];
    byType: Bucket[];
    byPosture: Bucket[];
  };
  evidence: {
    total: number;
    scored: number;
    high: number;
    medium: number;
    low: number;
    avgScore: number | null;
  };
  schedule: {
    hearingsUpcoming: number;
    nextHearings: Array<{
      caseId: string;
      title: string;
      at: string;
      location: string | null;
    }>;
    deadlinesOverdue: number;
    deadlinesUpcoming: number;
  };
  time: {
    hoursLogged: number;
    billableHours: number;
    unbilledCents: number;
    billedCents: number;
    entries: number;
  };
  activity: MonthPoint[];
};

// Matter statuses that count as "live work" rather than done/parked.
const OPEN_CASE_STATUSES = new Set([
  'open',
  'under_review',
  'needs_evidence',
  'export_ready',
]);
const CLOSED_CASE_STATUSES = new Set(['closed', 'archived']);

const POSTURE_LABEL: Record<string, string> = {
  claimant: 'Claimant',
  defendant: 'Defendant',
};

function prettify(s: string): string {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short' });
}

function tallyStatus(
  rows: Array<{ status?: string | null }>,
): StatusCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const s = (r.status ?? 'unknown').trim() || 'unknown';
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function bucketBy(
  values: Array<string | null | undefined>,
  labelFor: (key: string) => string,
): Bucket[] {
  const m = new Map<string, number>();
  for (const v of values) {
    const key = (v ?? 'unknown').trim() || 'unknown';
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, label: labelFor(key), count }))
    .sort((a, b) => b.count - a.count);
}

type CaseRow = {
  id: string;
  title: string | null;
  status: string | null;
  case_type: string | null;
  posture: string | null;
  hearing_at: string | null;
  hearing_location: string | null;
  created_at: string;
};

export async function getFirmImpact(firmId: string): Promise<FirmImpact> {
  const supabase = createServerSupabase();
  const now = new Date();
  const nowMs = now.getTime();
  const in30Days = nowMs + 30 * 86_400_000;

  const [casesRes, timeRes] = await Promise.all([
    supabase
      .from('cases')
      .select(
        'id, title, status, case_type, posture, hearing_at, hearing_location, created_at',
      )
      .eq('firm_id', firmId)
      .limit(5000),
    supabase
      .from('firm_time_entries')
      .select('duration_seconds, billable, rate_cents, invoice_id')
      .eq('firm_id', firmId)
      .limit(20000),
  ]);

  const cases = (casesRes.data ?? []) as CaseRow[];

  // ---- Matters ----
  const matters = {
    total: cases.length,
    open: cases.filter((c) => OPEN_CASE_STATUSES.has(c.status ?? '')).length,
    byStatus: tallyStatus(cases),
    byType: bucketBy(
      cases.map((c) => c.case_type),
      (k) => (k === 'unknown' ? 'Uncategorized' : prettify(k)),
    ),
    byPosture: bucketBy(
      cases.map((c) => c.posture),
      (k) => POSTURE_LABEL[k] ?? prettify(k),
    ),
  };

  // ---- Schedule (hearings + deadline pressure, from cases.hearing_at) ----
  const withHearing = cases.filter((c) => c.hearing_at);
  const upcoming = withHearing
    .filter((c) => Date.parse(c.hearing_at as string) >= nowMs)
    .sort(
      (a, b) =>
        Date.parse(a.hearing_at as string) - Date.parse(b.hearing_at as string),
    );
  const schedule = {
    hearingsUpcoming: upcoming.length,
    nextHearings: upcoming.slice(0, 5).map((c) => ({
      caseId: c.id,
      title: (c.title ?? 'Untitled matter').trim() || 'Untitled matter',
      at: c.hearing_at as string,
      location: c.hearing_location,
    })),
    // A matter whose hearing date has passed but is not closed is an
    // overdue deadline that still needs attention.
    deadlinesOverdue: withHearing.filter(
      (c) =>
        Date.parse(c.hearing_at as string) < nowMs &&
        !CLOSED_CASE_STATUSES.has(c.status ?? ''),
    ).length,
    deadlinesUpcoming: withHearing.filter((c) => {
      const t = Date.parse(c.hearing_at as string);
      return t >= nowMs && t <= in30Days;
    }).length,
  };

  // ---- Activity: matters opened per month (last 6 months) ----
  const activity: MonthPoint[] = [];
  const buckets = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), 0);
    activity.push({ label: monthLabel(d), count: 0 });
  }
  for (const c of cases) {
    const k = monthKey(new Date(c.created_at));
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  {
    let idx = 0;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      activity[idx].count = buckets.get(monthKey(d)) ?? 0;
      idx++;
    }
  }

  // ---- Time ----
  const timeRows = (timeRes.data ?? []) as Array<{
    duration_seconds: number | null;
    billable: boolean | null;
    rate_cents: number | null;
    invoice_id: string | null;
  }>;
  let secondsLogged = 0;
  let billableSeconds = 0;
  let unbilledCents = 0;
  let billedCents = 0;
  for (const e of timeRows) {
    const secs = e.duration_seconds ?? 0;
    if (secs <= 0) continue;
    secondsLogged += secs;
    const cents = Math.round((secs / 3600) * (e.rate_cents ?? 0));
    if (e.billable) {
      billableSeconds += secs;
      if (e.invoice_id) billedCents += cents;
      else unbilledCents += cents;
    }
  }
  const time = {
    hoursLogged: secondsLogged / 3600,
    billableHours: billableSeconds / 3600,
    unbilledCents,
    billedCents,
    entries: timeRows.filter((e) => (e.duration_seconds ?? 0) > 0).length,
  };

  // ---- Evidence volume + relevance distribution ----
  // Read through the admin client, scoped to this firm's own case ids.
  const evidence = await getEvidenceImpact(cases.map((c) => c.id));

  return { matters, evidence, schedule, time, activity };
}

async function getEvidenceImpact(caseIds: string[]): Promise<
  FirmImpact['evidence']
> {
  const empty = {
    total: 0,
    scored: 0,
    high: 0,
    medium: 0,
    low: 0,
    avgScore: null as number | null,
  };
  if (caseIds.length === 0) return empty;
  const admin = createAdminSupabase();
  if (!admin) return empty;

  // Chunk the IN() list so a firm with thousands of matters does not
  // build one enormous query.
  const CHUNK = 500;
  const rows: Array<{ ai_extracted: unknown }> = [];
  for (let i = 0; i < caseIds.length; i += CHUNK) {
    const slice = caseIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from('case_timeline_events')
      .select('ai_extracted')
      .in('case_id', slice)
      .limit(20000);
    if (error) return empty;
    rows.push(...((data ?? []) as Array<{ ai_extracted: unknown }>));
  }

  let scored = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let scoreSum = 0;
  for (const r of rows) {
    const raw = (r.ai_extracted as { relevance_score?: unknown } | null)
      ?.relevance_score;
    if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
    const band = relevanceBand(raw);
    if (!band) continue;
    scored += 1;
    scoreSum += raw;
    if (band === 'high') high += 1;
    else if (band === 'medium') medium += 1;
    else low += 1;
  }
  return {
    total: rows.length,
    scored,
    high,
    medium,
    low,
    avgScore: scored > 0 ? scoreSum / scored : null,
  };
}
