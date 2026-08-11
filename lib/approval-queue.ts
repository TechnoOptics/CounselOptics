/**
 * The approvals queue's state: what a URL means, and what it selects.
 *
 * Modelled on lib/matter-list.ts and for the same two reasons. The URL is the
 * source of truth, so a narrowed queue is something a reviewer can send a
 * colleague and the back button steps between views rather than out of the
 * page. And it is pure, so the whole of it is testable with no DOM and no
 * database.
 *
 * The row type is deliberately NARROWER than TemplateSubmission. The queue
 * component is a client component, so everything it is handed is serialized
 * into the page. TemplateSubmission carries `documentText`, which is the
 * wording of an agreement the firm has not agreed to send yet; there is no
 * reason for a list of names and addresses to carry it, and the surest way for
 * it never to leak into a client payload is for the shape the client holds not
 * to have the field at all. toApprovalRow is the one place the narrowing
 * happens.
 */

import { isTerminal, type SubmissionStatus } from './template-submission-types';
import { displayTicket } from './ticket-numbers';
import type { TemplateSubmission } from './template-submission-types';

/** What a queue row shows. No document wording, by construction. */
export type ApprovalRow = {
  id: string;
  ticketNumber: string | null;
  templateName: string;
  category: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  recipientName: string | null;
  recipientEmail: string;
  status: SubmissionStatus;
  revision: number;
  submittedAt: string;
  decidedAt: string | null;
  /** Set when a delivery was attempted after an approval and did not land. */
  releaseError: string | null;
};

export function toApprovalRow(s: TemplateSubmission): ApprovalRow {
  return {
    id: s.id,
    ticketNumber: s.ticketNumber,
    templateName: s.templateName,
    category: s.category,
    submitterName: s.submitterName,
    submitterEmail: s.submitterEmail,
    recipientName: s.recipientName,
    recipientEmail: s.recipientEmail,
    status: s.status,
    revision: s.revision,
    submittedAt: s.submittedAt,
    decidedAt: s.decidedAt,
    releaseError: s.releaseError,
  };
}

/**
 * The four views, each a real subset with a real count.
 *
 *   waiting  the legal team owes a decision
 *   aging    the same, and it has been sitting for over three days
 *   failed   approved, the delivery was attempted, and it did not land
 *   open     everything that is not finished
 *
 * `aging` is a subset of `waiting` and `waiting` is a subset of `open`, which
 * is fine: views narrow a set, they are not obliged to partition it. What they
 * are obliged to be is real, so there is no "Urgent" here, because nothing on
 * a submission records urgency.
 */
export type QueueViewKey = 'waiting' | 'aging' | 'failed' | 'open';

export const QUEUE_VIEW_KEYS: QueueViewKey[] = ['waiting', 'aging', 'failed', 'open'];

/** How long a document waits before the queue calls it out. */
export const AGING_DAYS = 3;

export type QueueSort = 'oldest' | 'newest';

export type ApprovalQueueParams = {
  view: QueueViewKey;
  /** Reference, form name, colleague, recipient. */
  q: string;
  sort: QueueSort;
};

/**
 * The predicate behind a view.
 *
 * `now` is a parameter rather than a call to Date.now() inside, so the aging
 * view is testable and so the count and the rows come from one clock.
 */
export function queueViewTest(
  view: QueueViewKey,
  now = Date.now(),
): (r: ApprovalRow) => boolean {
  switch (view) {
    case 'aging':
      return (r) => r.status === 'pending' && waitedDays(r.submittedAt, now) >= AGING_DAYS;
    case 'failed':
      return (r) => r.status === 'approved' && Boolean(r.releaseError);
    case 'open':
      return (r) => !isTerminal(r.status);
    default:
      return (r) => r.status === 'pending';
  }
}

/** Days since a submission was filed, or 0 for a date that will not parse. */
export function waitedDays(iso: string, now = Date.now()): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now - at) / 86_400_000);
}

/**
 * Whether a row can be part of a bulk action.
 *
 * One rule, read by the checkbox, by the bulk bar, and by the confirmation, so
 * a reviewer can never tick something the action would then refuse. It is
 * 'pending' because that is the only status reviewDecision will move, and the
 * server checks it again for itself on every row.
 */
export function isBulkSelectable(r: ApprovalRow): boolean {
  return r.status === 'pending';
}

/** Rows that are finished: sent, withdrawn, or declined. */
export function isSettled(r: ApprovalRow): boolean {
  return isTerminal(r.status);
}

/**
 * What the search box matches: everything printed on the row, and the
 * reference a colleague would quote over the phone. Never the wording, which
 * this shape does not carry.
 */
export function matchesQuery(r: ApprovalRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [
    r.templateName,
    r.category,
    r.submitterName,
    r.submitterEmail,
    r.recipientName,
    r.recipientEmail,
    displayTicket(r),
    r.id,
  ]
    .some((v) => (v ?? '').toLowerCase().includes(needle));
}

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/**
 * Read the queue's state out of a query string. Every field falls back to its
 * default rather than rejecting, so a hand-edited URL lands somewhere sensible.
 */
export function parseApprovalQueueParams(
  searchParams: Record<string, string | string[] | undefined>,
): ApprovalQueueParams {
  const rawView = one(searchParams.view) as QueueViewKey;
  const rawSort = one(searchParams.sort);
  return {
    view: QUEUE_VIEW_KEYS.includes(rawView) ? rawView : 'waiting',
    q: one(searchParams.q),
    sort: rawSort === 'newest' ? 'newest' : 'oldest',
  };
}

/** The query string for `params`, omitting everything left at default. */
export function approvalQueueQuery(params: ApprovalQueueParams): string {
  const qs = new URLSearchParams();
  if (params.view !== 'waiting') qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.sort !== 'oldest') qs.set('sort', params.sort);
  return qs.toString();
}

/** A link to this queue with `patch` applied. */
export function approvalQueueHref(
  params: ApprovalQueueParams,
  patch: Partial<ApprovalQueueParams>,
  pathname = '/counsel/forms/approvals',
): string {
  const qs = approvalQueueQuery({ ...params, ...patch });
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * The open rows a set of params selects, in order.
 *
 * The view predicate runs first, so the count on the strip and the rows in the
 * card come from one definition. Oldest first is the default because the thing
 * a reviewer clearing a queue wants at the top is whatever has waited longest.
 */
export function selectQueue(
  rows: ApprovalRow[],
  params: ApprovalQueueParams,
  now = Date.now(),
): ApprovalRow[] {
  const test = queueViewTest(params.view, now);
  return sortByFiled(
    rows.filter((r) => test(r) && matchesQuery(r, params.q)),
    params.sort,
  );
}

/**
 * How many rows each view would render, under the search now in force.
 *
 * The strip used to be built in the component from `rows.filter(queueViewTest(key))`
 * while the card underneath was built from selectQueue, which also applies the
 * search. Two expressions, agreeing only while the search box was empty: type
 * anything and "Awaiting decision · 3" sat over "Nothing matches that search."
 *
 * So a count is defined here as the length of the list its own tab would show,
 * from selectQueue itself. Not a parallel predicate that matches it today: the
 * same call. `now` is threaded through so all four views and the rendered list
 * read one clock, which is what keeps the aging count from drifting a row
 * either side of the three-day boundary mid-render.
 */
export function queueViewCounts(
  rows: ApprovalRow[],
  params: ApprovalQueueParams,
  now = Date.now(),
): Record<QueueViewKey, number> {
  const counts = {} as Record<QueueViewKey, number>;
  for (const view of QUEUE_VIEW_KEYS) {
    counts[view] = selectQueue(rows, { ...params, view }, now).length;
  }
  return counts;
}

/**
 * The settled rows, narrowed by the same search.
 *
 * The view strip does not reach this card: its views are about work that is
 * still outstanding, and a finished document is not in any of them. Search
 * does reach it, because somebody looking for one particular agreement wants
 * to find it whether or not it has already gone out. The order is the one the
 * server read them in, newest decision first, which is what a history is.
 */
export function selectHistory(rows: ApprovalRow[], params: ApprovalQueueParams): ApprovalRow[] {
  return rows.filter((r) => isSettled(r) && matchesQuery(r, params.q));
}

/**
 * One row's outcome in a bulk send-back, named so a partial failure is
 * legible, and the cap on how many rows one call will act on.
 *
 * Both live here rather than beside the action, and not for tidiness.
 * lib/template-submissions.ts carries `'use server'`, where only async
 * functions may be exported: a plain `export const` there is a build error the
 * moment anything pulls the module into a client graph, which the queue does.
 * This module is the queue's rules and is client-safe, so it is where a
 * constant the UI and the action must agree on belongs.
 */
export type BulkSendBackResult = {
  id: string;
  /** The reference the reviewer sees on the row, so a failure can be found again. */
  ref: string;
  ok: boolean;
  error?: string;
};

/** The most rows one bulk call will act on. A queue page's worth, and no more. */
export const MAX_BULK_SEND_BACK = 50;

/**
 * What a bulk action's confirmation shows: one line per document, naming the
 * reference, the form, and the outside party it is addressed to.
 *
 * A function rather than markup inside the component, because this is the
 * safety property of the whole bulk path and it has to be testable. A count is
 * the one thing a reviewer cannot check against what they meant to tick, so
 * the rule is that every selected row is named and every recipient with it. If
 * a bulk action is ever added that DOES send, this is the line it must show.
 */
export function confirmationLines(rows: ApprovalRow[]): string[] {
  return rows.map(
    (r) =>
      `${displayTicket(r)} · ${r.templateName} · ${
        r.recipientName ? `${r.recipientName} (${r.recipientEmail})` : r.recipientEmail
      }`,
  );
}

function sortByFiled(rows: ApprovalRow[], sort: QueueSort): ApprovalRow[] {
  const dir = sort === 'oldest' ? 1 : -1;
  return [...rows].sort(
    (a, b) => dir * ((Date.parse(a.submittedAt) || 0) - (Date.parse(b.submittedAt) || 0)),
  );
}
