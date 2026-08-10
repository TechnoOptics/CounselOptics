import 'server-only';

import { createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { FIRM_POSTING_ROLES } from './firm-authz';
import { FIRM_DOCUMENT_STATUSES, type FirmRole } from './firm-types';
import {
  INTAKE_LANE_STATUSES,
  intakeLaneFilter,
  type IntakeLane,
} from './intake-lanes';
import {
  REPORT_WEEKS,
  REPORT_WINDOW_DAYS,
  type Count,
  type WeekPoint,
} from './counsel-reports';

/**
 * Every read behind /counsel/reports and /counsel/my.
 *
 * ONE SHAPE, EVERYWHERE: `select('id', { count: 'exact', head: true })`.
 * `head: true` returns no rows at all, so a figure here can only come off
 * the `count` field. That is deliberate and it is the whole design of this
 * module. This product has three times shipped a total that was really the
 * length of a page of rows - the intake lanes over a 200-row read, the
 * signing chase-ups over a list sliced to ten, and a trust aggregate over
 * a 20000-row read - and every one of them looked correct on the screen of
 * whoever wrote it. A count query cannot fail that way: Postgres does the
 * counting and no row limit can reach it.
 *
 * The two exceptions are the two reads that draw ROWS somebody looks at:
 * the oldest-open-requests panel and the replies panel. Both are lists,
 * both are bounded, and neither is counted. Where a list needs a total
 * beside it, the total is its own count query, which is the shape
 * app/counsel/billing already uses for Outstanding.
 *
 * WHAT IS NOT HERE, AND WHY. No sums. PostgREST has no SUM, so a money
 * total would have to be added up in JavaScript over a select of every
 * row, and a sum over a read whose completeness this module cannot prove
 * is the same defect in a different suit. So the money figures on these
 * pages are COUNTS of invoices and of time entries, which are exact, and
 * the amounts are left to /counsel/billing, which is the surface that owns
 * them.
 *
 * WHICH CLIENT. Everything goes through the USER-scoped client except the
 * approvals figures, which go through the service-role client for the same
 * reason app/counsel/page.tsx and /counsel/forms/approvals read that table
 * that way: the queue is a firm-wide surface and its RLS is not written
 * for a firm-wide reader. Authorization for that read is the caller's own
 * firm context, resolved by the page from their own firm_members row
 * before this module is called; `firmId` never comes from the request.
 */

/**
 * Whether a role reaches matter material at all.
 *
 * FIRM_POSTING_ROLES is the set named by the applied
 * supabase/migrations/20260731_staff_role_read_scope.sql in both
 * `cases_firm_member_select` and `firm_documents_member_select`, so this is
 * the same list the database enforces rather than a second copy of it. A
 * `staff` member's select on either table returns an empty set with NO
 * error, which is precisely why this has to be asked in code: the figure
 * would otherwise be a confident zero.
 */
export function canReadMatterMaterial(role: FirmRole): boolean {
  return FIRM_POSTING_ROLES.includes(role);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the reporting window, as the database wants it. */
export function windowStartIso(now = Date.now()): string {
  return new Date(now - REPORT_WINDOW_DAYS * DAY_MS).toISOString();
}

/**
 * The weeks the demand chart covers, oldest first.
 *
 * Weeks rather than days because twelve of them is a quarter, which is the
 * period a firm actually reviews, and because a per-day chart of a small
 * firm's intake is mostly zeroes. Each one becomes its own exact count.
 */
export function reportWeeks(now = Date.now()): Array<{
  startIso: string;
  endIso: string;
  label: string;
}> {
  // Anchored to the current week's Monday, so the last column is the week
  // in progress and every earlier column is a whole week.
  const anchor = new Date(now);
  anchor.setHours(0, 0, 0, 0);
  const backToMonday = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - backToMonday);
  const weeks: Array<{ startIso: string; endIso: string; label: string }> = [];
  for (let i = REPORT_WEEKS - 1; i >= 0; i -= 1) {
    const start = new Date(anchor);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    weeks.push({
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: start.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    });
  }
  return weeks;
}

/** The document statuses that mean a due date is no longer owed. */
const SETTLED_DOCUMENT_STATUSES = [
  ...FIRM_DOCUMENT_STATUSES.filter((s) => s.startsWith('signed_')),
  'canceled',
];

/**
 * "Still on the legal team's plate", as a database predicate.
 *
 * The COMPLEMENT of accepted and closed, not a list of the open statuses,
 * for the reason lib/intake-lanes.ts spells out at intakeLaneFilter: a
 * status the code has never heard of has to reach a person rather than
 * vanish out of every figure. `isIntakeOpen` makes the same choice in
 * JavaScript, so the two agree on a status neither has seen.
 */
const DECIDED_LANE_STATUSES = [
  ...INTAKE_LANE_STATUSES.accepted,
  ...INTAKE_LANE_STATUSES.closed,
];
const NOT_DECIDED = `status.is.null,status.not.in.(${DECIDED_LANE_STATUSES.join(',')})`;

export type FirmReportFigures = {
  requestsReceivedInWindow: Count;
  requestsNeedingAttention: Count;
  requestsOpen: Count;
  lanes: Record<IntakeLane, Count>;
  weekly: WeekPoint[];
  approvalsWaiting: Count;
  approvalsApprovedInWindow: Count;
  approvalsReturnedInWindow: Count;
  approvalsDeclinedInWindow: Count;
  signingSentInWindow: Count;
  signingCompletedInWindow: Count;
  signingAwaiting: Count;
  signingPartial: Count;
  signingChangesRequested: Count;
  signingRejected: Count;
  /** Null when the reader's role does not reach matter material. */
  documentsOverdue: Count;
  mattersOpenedInWindow: Count;
  /** Null when the firm hides time and billing. */
  invoicesUnpaid: Count;
  invoicesPaidInWindow: Count;
  oldestOpenRequests: OpenRequestRow[];
};

export type OpenRequestRow = {
  id: string;
  clientName: string;
  matterType: string | null;
  status: string | null;
  createdAt: string;
};

export async function getFirmReportFigures(input: {
  firmId: string;
  role: FirmRole;
  hideTimeBilling: boolean;
  now?: number;
}): Promise<FirmReportFigures> {
  const { firmId } = input;
  const now = input.now ?? Date.now();
  const since = windowStartIso(now);
  const nowIso = new Date(now).toISOString();
  const supabase = createServerSupabase();
  const admin = createAdminSupabase();
  const matterMaterial = canReadMatterMaterial(input.role);

  const intake = () =>
    supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId);

  const lane = (which: IntakeLane) => {
    const f = intakeLaneFilter(which);
    const q = supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId);
    return f.op === 'in'
      ? q.in('status', f.statuses)
      : q.or(`status.is.null,status.not.in.(${f.statuses.join(',')})`);
  };

  const weeks = reportWeeks(now);

  const [
    receivedRes,
    openRes,
    attentionRes,
    reviewRes,
    acceptedRes,
    closedRes,
    weeklyRes,
    approvalsWaitingRes,
    approvalsApprovedRes,
    approvalsReturnedRes,
    approvalsDeclinedRes,
    signingSentRes,
    signingCompletedRes,
    signingAwaitingRes,
    signingPartialRes,
    signingChangesRes,
    signingRejectedRes,
    documentsOverdueRes,
    mattersOpenedRes,
    invoicesUnpaidRes,
    invoicesPaidRes,
    oldestRes,
  ] = await Promise.all([
    intake().gte('created_at', since),
    intake().or(NOT_DECIDED),
    lane('attention'),
    lane('review'),
    lane('accepted'),
    lane('closed'),
    Promise.all(
      weeks.map((w) =>
        supabase
          .from('firm_matter_intakes')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .gte('created_at', w.startIso)
          .lt('created_at', w.endIso),
      ),
    ),
    admin
      ? admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('status', 'pending')
      : { count: null },
    admin
      ? admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .in('status', ['approved', 'sent'])
          .gte('decided_at', since)
      : { count: null },
    admin
      ? admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('status', 'changes_requested')
          .gte('decided_at', since)
      : { count: null },
    admin
      ? admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('status', 'declined')
          .gte('decided_at', since)
      : { count: null },
    // The denominator and the numerator of the completion share are the
    // SAME set narrowed once, so the two cannot come apart: everything
    // this firm actually sent for signature inside the window.
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .gte('sent_at', since),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .gte('sent_at', since)
      .eq('status', 'completed'),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('status', 'sent'),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('status', 'partial'),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('status', 'changes_requested'),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('status', 'rejected'),
    // The predicate /counsel/documents calls Overdue, restated: past its
    // due date, not signed by anybody, not recalled. `archived_at` matches
    // listFirmDocuments, which is the list that page draws.
    matterMaterial
      ? supabase
          .from('firm_documents')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .is('archived_at', null)
          .lt('due_at', nowIso)
          .not('status', 'in', `(${SETTLED_DOCUMENT_STATUSES.join(',')})`)
      : { count: null },
    matterMaterial
      ? supabase
          .from('cases')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .gte('created_at', since)
      : { count: null },
    input.hideTimeBilling
      ? { count: null }
      : supabase
          .from('firm_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('status', 'sent'),
    input.hideTimeBilling
      ? { count: null }
      : supabase
          .from('firm_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .gte('paid_at', since),
    // A LIST, and the only unbounded thing about it is that it is not one.
    // Nothing takes its length: the total beside it is `requestsOpen`
    // above, which is its own count query.
    supabase
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at')
      .eq('firm_id', firmId)
      .or(NOT_DECIDED)
      .order('created_at', { ascending: true })
      .limit(6),
  ]);

  return {
    requestsReceivedInWindow: receivedRes.count ?? null,
    requestsOpen: openRes.count ?? null,
    requestsNeedingAttention: attentionRes.count ?? null,
    lanes: {
      attention: attentionRes.count ?? null,
      review: reviewRes.count ?? null,
      accepted: acceptedRes.count ?? null,
      closed: closedRes.count ?? null,
    },
    weekly: weeks.map((w, i) => ({
      startIso: w.startIso,
      label: w.label,
      count: weeklyRes[i]?.count ?? null,
    })),
    approvalsWaiting: approvalsWaitingRes.count ?? null,
    approvalsApprovedInWindow: approvalsApprovedRes.count ?? null,
    approvalsReturnedInWindow: approvalsReturnedRes.count ?? null,
    approvalsDeclinedInWindow: approvalsDeclinedRes.count ?? null,
    signingSentInWindow: signingSentRes.count ?? null,
    signingCompletedInWindow: signingCompletedRes.count ?? null,
    signingAwaiting: signingAwaitingRes.count ?? null,
    signingPartial: signingPartialRes.count ?? null,
    signingChangesRequested: signingChangesRes.count ?? null,
    signingRejected: signingRejectedRes.count ?? null,
    documentsOverdue: documentsOverdueRes.count ?? null,
    mattersOpenedInWindow: mattersOpenedRes.count ?? null,
    invoicesUnpaid: invoicesUnpaidRes.count ?? null,
    invoicesPaidInWindow: invoicesPaidRes.count ?? null,
    oldestOpenRequests: toOpenRequestRows(oldestRes),
  };
}

type IntakeListResult = {
  data?: Array<{
    id: string;
    client_name: string | null;
    matter_type: string | null;
    status: string | null;
    created_at: string;
  }> | null;
};

function toOpenRequestRows(res: IntakeListResult): OpenRequestRow[] {
  return (res.data ?? []).map((r) => ({
    id: r.id,
    clientName: r.client_name ?? 'Unnamed request',
    matterType: r.matter_type,
    status: r.status,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// /counsel/my
// ---------------------------------------------------------------------------

export type MyReportFigures = {
  myOpenMatters: Count;
  myOpenRequests: Count;
  myRequestsNeedingAttention: Count;
  firmOpenRequests: Count;
  mySignaturesOut: Count;
  myApprovalDecisionsInWindow: Count;
  myTimeEntriesInWindow: Count;
  myQueue: OpenRequestRow[];
  myReplies: ReplyRow[];
  /**
   * True when the replies read FAILED, as distinct from finding nothing.
   *
   * Only this one read carries the distinction, and it earns it: it is the
   * only query on either page that uses PostgREST's embedded-resource
   * syntax, so a rename of the firm_matter_intakes relationship breaks it
   * while every other query keeps working. Without the flag the panel would
   * say "nobody has replied", which is a statement about the firm rather
   * than about the read, and it would be wrong in the calmest possible way.
   */
  myRepliesFailed: boolean;
};

export type ReplyRow = {
  id: string;
  intakeId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export async function getMyCounselFigures(input: {
  firmId: string;
  userId: string;
  role: FirmRole;
  hideTimeBilling: boolean;
  now?: number;
}): Promise<MyReportFigures> {
  const { firmId, userId } = input;
  const now = input.now ?? Date.now();
  const since = windowStartIso(now);
  const supabase = createServerSupabase();
  const admin = createAdminSupabase();
  const matterMaterial = canReadMatterMaterial(input.role);

  const mine = () =>
    supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('assigned_to', userId);

  const attention = intakeLaneFilter('attention');

  const [
    myMattersRes,
    myOpenRes,
    myAttentionRes,
    firmOpenRes,
    mySigningRes,
    myDecisionsRes,
    myTimeRes,
    myQueueRes,
    myRepliesRes,
  ] = await Promise.all([
    // The caseload page's own default view is "not closed and not
    // archived", so the tile and /counsel/cases?assignee=me agree by
    // construction rather than by promise.
    matterMaterial
      ? supabase
          .from('cases')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('assigned_to', userId)
          .not('status', 'in', '(closed,archived)')
      : { count: null },
    mine().or(NOT_DECIDED),
    attention.op === 'in'
      ? mine().in('status', attention.statuses)
      : mine().or(`status.is.null,status.not.in.(${attention.statuses.join(',')})`),
    supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .or(NOT_DECIDED),
    supabase
      .from('firm_signing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', firmId)
      .eq('requested_by', userId)
      .in('status', ['sent', 'partial']),
    admin
      ? admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('decided_by', userId)
          .gte('decided_at', since)
      : { count: null },
    input.hideTimeBilling
      ? { count: null }
      : supabase
          .from('firm_time_entries')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', firmId)
          .eq('user_id', userId)
          .gte('started_at', since),
    // Lists, both of them. Neither is counted anywhere.
    supabase
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at')
      .eq('firm_id', firmId)
      .eq('assigned_to', userId)
      .or(NOT_DECIDED)
      .order('created_at', { ascending: true })
      .limit(6),
    // What people have said back to me, which is the nearest thing this
    // product has to the reference screen's satisfaction panel. Filtered
    // through the embedded intake so a reply on any request of mine is in
    // scope, rather than only replies on the six drawn above.
    supabase
      .from('firm_intake_messages')
      .select(
        'id, intake_id, author_name, body, created_at, firm_matter_intakes!inner(assigned_to)',
      )
      .eq('firm_id', firmId)
      .eq('firm_matter_intakes.assigned_to', userId)
      .eq('visibility', 'shared')
      .eq('kind', 'message')
      .neq('author_user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  return {
    myOpenMatters: myMattersRes.count ?? null,
    myOpenRequests: myOpenRes.count ?? null,
    myRequestsNeedingAttention: myAttentionRes.count ?? null,
    firmOpenRequests: firmOpenRes.count ?? null,
    mySignaturesOut: mySigningRes.count ?? null,
    myApprovalDecisionsInWindow: myDecisionsRes.count ?? null,
    myTimeEntriesInWindow: myTimeRes.count ?? null,
    myQueue: toOpenRequestRows(myQueueRes),
    myRepliesFailed: myRepliesRes.error != null,
    myReplies: ((myRepliesRes.data ?? []) as Array<{
      id: string;
      intake_id: string;
      author_name: string | null;
      body: string | null;
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      intakeId: r.intake_id,
      authorName: r.author_name ?? 'Someone',
      body: r.body ?? '',
      createdAt: r.created_at,
    })),
  };
}
