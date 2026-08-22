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

import {
  ALL_SUBMISSION_STATUSES,
  isTerminal,
  type SubmissionStatus,
} from './template-submission-types';
import { displayTicket } from './ticket-numbers';
import type { TemplateSubmission } from './template-submission-types';
import {
  readAuthorizationStatus,
  type AuthorizationStatus,
  type SigningDirection,
} from './signing-authorization';

/**
 * WHY THE TWO DIRECTIONS SHARE ONE ROW TYPE AND ONE QUEUE.
 *
 * Two things now wait on the same decision by the same people. A colleague
 * fills in one of the firm's templates for somebody outside, and nothing goes
 * out until the legal team approves it. And somebody outside sends US their
 * document and asks us to sign it, and nothing is signed until the legal team
 * authorises it. They come from different tables and they read differently on
 * screen, but they are one job: a person who may bind the firm, deciding
 * whether the firm is bound.
 *
 * A second queue would be a second place to look every morning and a second
 * gate to keep in step with the first, and the gate is the same function in
 * both directions (canApproveSubmissions in lib/template-approval.ts). So
 * there is ONE queue, ONE record shape, and the direction is a facet on it.
 *
 * The framing differs and the record does not. queueFraming below is where
 * the words change; nothing else branches on direction.
 */
export type QueueDirection = SigningDirection;

/** The facet, including the unnarrowed state. */
export type QueueDirectionFacet = 'all' | QueueDirection;

export const QUEUE_DIRECTION_FACETS: QueueDirectionFacet[] = ['all', 'outbound', 'inbound'];

/**
 * What each direction is called, and what the columns of a row mean in it.
 *
 * Outbound: a form a colleague filled in, addressed to somebody outside, and
 * the decision releases it.
 *
 * Inbound: a document somebody outside sent in, and the decision lets the
 * firm sign it. `recipient` on such a row is the party who SENT it, which is
 * why the column heading has to change with the facet: a column labelled
 * "Recipient" over the sender's name is a queue that misleads a reviewer
 * about who is waiting on whom.
 */
export const QUEUE_FRAMING: Record<
  QueueDirection,
  {
    facetLabel: string;
    /**
     * What the decision DOES, in the words that fit this direction. Stated
     * under the list whenever the facet is narrowed to one of them, because
     * a reviewer clearing a mixed queue is doing two different things with
     * one button and the sentence is the only thing that says which.
     */
    decision: string;
  }
> = {
  outbound: {
    facetLabel: 'We are asking them to sign',
    decision: 'Approving one of these releases it to the recipient.',
  },
  inbound: {
    facetLabel: 'They are asking us to sign',
    decision: 'Approving one of these lets the named signatory sign it.',
  },
};

export function queueFraming(direction: QueueDirection) {
  return QUEUE_FRAMING[direction];
}

/** What the facet strip calls each option. */
export const DIRECTION_FACET_LABEL: Record<QueueDirectionFacet, string> = {
  all: 'Everything',
  outbound: QUEUE_FRAMING.outbound.facetLabel,
  inbound: QUEUE_FRAMING.inbound.facetLabel,
};

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
  /** Which way this one runs. See the note above the type. */
  direction: QueueDirection;
  /**
   * The link the reviewer opens to decide. It differs by direction because
   * the two records live in different tables, and putting it ON the row is
   * what lets the list itself stay direction-blind.
   */
  href: string;
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
    direction: 'outbound',
    href: `/counsel/forms/approvals/${s.id}`,
  };
}

/**
 * One inbound signing request, as a row of the same queue.
 *
 * The mapping is deliberately narrow and lossy in one direction: the
 * authorisation NOTE is not on ApprovalRow and is not read here. The queue is
 * a client component, so everything it is handed is serialized into the page,
 * and the note is the legal team's working reasoning on a document. It is
 * read on the decision screen, by the people deciding, and nowhere else. This
 * is the same reason toApprovalRow drops `documentText`.
 *
 * The authorisation status is mapped onto the submission vocabulary rather
 * than added to it, because the queue's four views, its bulk selection and
 * its history are all defined over SubmissionStatus and a fifth value would
 * have to be taught to every one of them. The three that overlap mean the
 * same thing in both directions, and 'not_required' cannot occur on an
 * inbound row: createSigningRequestAction writes 'pending' explicitly and
 * aborts rather than fall back to the default.
 */
export function inboundAuthorizationRow(r: {
  id: string;
  documentName: string;
  counterpartyName: string | null;
  counterpartyEmail: string;
  requestedByName: string | null;
  requestedByEmail: string | null;
  authorizationStatus: unknown;
  createdAt: string;
  authorizedAt: string | null;
  ticketNumber: string | null;
}): ApprovalRow {
  return {
    id: r.id,
    ticketNumber: r.ticketNumber,
    templateName: r.documentName,
    category: null,
    submitterName: r.requestedByName,
    submitterEmail: r.requestedByEmail,
    recipientName: r.counterpartyName,
    recipientEmail: r.counterpartyEmail,
    status: inboundQueueStatus(r.authorizationStatus),
    revision: 1,
    submittedAt: r.createdAt,
    decidedAt: r.authorizedAt,
    // An inbound authorisation has no delivery to fail: nothing is sent to
    // anybody. Null keeps it out of the 'failed' view rather than putting a
    // row there that no retry could act on.
    releaseError: null,
    direction: 'inbound',
    href: `/counsel/signing/${r.id}`,
  };
}

/**
 * The authorisation, in the queue's own status vocabulary.
 *
 * 'not_required' maps to 'pending' rather than to a settled status. It cannot
 * occur on an inbound row today, and if it ever did it would mean an
 * authorisation nobody recorded, which belongs in front of a reviewer and not
 * in the history where it would read as decided.
 */
export function inboundQueueStatus(raw: unknown): SubmissionStatus {
  const status: AuthorizationStatus = readAuthorizationStatus(raw);
  if (status === 'approved') return 'approved';
  if (status === 'declined') return 'declined';
  return 'pending';
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
  /**
   * Which direction the reviewer is looking at. 'all' is the default,
   * because the job is the queue and not one half of it.
   */
  dir: QueueDirectionFacet;
};

/** Whether a row is in the facet now in force. */
export function matchesDirection(r: ApprovalRow, dir: QueueDirectionFacet): boolean {
  return dir === 'all' || r.direction === dir;
}

/**
 * The finished statuses and the unfinished ones, derived from isTerminal rather
 * than spelled again, so a seventh status added to the union lands in exactly
 * one of these two lists without anybody remembering to come here.
 */
export const SETTLED_STATUSES: SubmissionStatus[] =
  ALL_SUBMISSION_STATUSES.filter(isTerminal);

export const UNSETTLED_STATUSES: SubmissionStatus[] =
  ALL_SUBMISSION_STATUSES.filter((s) => !isTerminal(s));

/**
 * A view, described as a set of rows rather than as a predicate over rows the
 * page happens to be holding.
 *
 * THIS EXISTS BECAUSE A VIEW HAS TO BE COUNTED IN THE DATABASE AND FILTERED IN
 * THE BROWSER, and those are two spellings of one definition. The queue reads a
 * bounded page of rows, so the number beside a view name cannot come from that
 * page: `listFirmTemplateSubmissionsAction` turns each of these into an exact
 * `count` query with no row cap, and `queueFilterTest` turns the same value
 * into the predicate the client filters with. Neither side gets to write the
 * rule for itself, which is what keeps a strip count from disagreeing with the
 * list under it, and both from disagreeing with the dashboard tile that links
 * here.
 *
 * Modelled on intakeLaneFilter in lib/intake-lanes.ts, for the same reason and
 * with the same `exclude` convention: a view meaning "not finished" is the
 * complement of the finished statuses, so a status nobody has heard of yet
 * surfaces in front of a person instead of vanishing from every view.
 */
export type QueueViewFilter = {
  /** The statuses this view admits, or the ones it refuses when `exclude`. */
  statuses: SubmissionStatus[];
  exclude?: boolean;
  /** Only rows filed at or before this instant. The aging cut-off. */
  filedAtOrBefore?: string;
  /** Only rows carrying a delivery error, which '' is not. */
  failedDelivery?: boolean;
};

export function queueViewFilter(view: QueueViewKey, now = Date.now()): QueueViewFilter {
  switch (view) {
    case 'aging':
      return {
        statuses: ['pending'],
        filedAtOrBefore: new Date(now - AGING_DAYS * 86_400_000).toISOString(),
      };
    case 'failed':
      return { statuses: ['approved'], failedDelivery: true };
    case 'open':
      return { statuses: SETTLED_STATUSES, exclude: true };
    default:
      return { statuses: ['pending'] };
  }
}

/** The same filter, as a predicate over a row the page is holding. */
export function queueFilterTest(f: QueueViewFilter): (r: ApprovalRow) => boolean {
  const cutoff = f.filedAtOrBefore ? Date.parse(f.filedAtOrBefore) : null;
  return (r) => {
    const named = f.statuses.includes(r.status);
    if (f.exclude ? named : !named) return false;
    if (f.failedDelivery && !r.releaseError) return false;
    if (cutoff !== null) {
      const at = Date.parse(r.submittedAt);
      // A date that will not parse has waited no time at all, so it is not
      // aging. Excluding it also matches the database side, where a null
      // submitted_at cannot satisfy `<=` either.
      if (Number.isNaN(at) || at > cutoff) return false;
    }
    return true;
  };
}

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
  return queueFilterTest(queueViewFilter(view, now));
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
  const rawDir = one(searchParams.dir) as QueueDirectionFacet;
  return {
    view: QUEUE_VIEW_KEYS.includes(rawView) ? rawView : 'waiting',
    q: one(searchParams.q),
    sort: rawSort === 'newest' ? 'newest' : 'oldest',
    dir: QUEUE_DIRECTION_FACETS.includes(rawDir) ? rawDir : 'all',
  };
}

/** The query string for `params`, omitting everything left at default. */
export function approvalQueueQuery(params: ApprovalQueueParams): string {
  const qs = new URLSearchParams();
  if (params.view !== 'waiting') qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.sort !== 'oldest') qs.set('sort', params.sort);
  if (params.dir !== 'all') qs.set('dir', params.dir);
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
    rows.filter(
      (r) => test(r) && matchesDirection(r, params.dir) && matchesQuery(r, params.q),
    ),
    params.sort,
  );
}

/**
 * How many rows each facet would show, under the view and the search now in
 * force.
 *
 * From selectQueue itself, the same call the list is built from, for the
 * reason queueViewCounts is: a facet strip built from a parallel predicate
 * agrees with the list until the day it does not, and this repo has shipped
 * that exact defect on four surfaces.
 */
export function directionFacetCounts(
  rows: ApprovalRow[],
  params: ApprovalQueueParams,
  now = Date.now(),
): Record<QueueDirectionFacet, number> {
  const counts = {} as Record<QueueDirectionFacet, number>;
  for (const dir of QUEUE_DIRECTION_FACETS) {
    counts[dir] = selectQueue(rows, { ...params, dir }, now).length;
  }
  return counts;
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
  return rows.filter(
    (r) => isSettled(r) && matchesDirection(r, params.dir) && matchesQuery(r, params.q),
  );
}

/**
 * How many records are in each view, and in the history, across the whole
 * firm rather than across the page of rows the queue was handed.
 *
 * A null is "the database did not answer", not zero. The tally helpers below
 * fall back to what is on the page for a null, because a figure that is short
 * is still better than a figure that is invented.
 */
export type QueueCounts = { [K in QueueViewKey]: number | null } & {
  settled: number | null;
};

/**
 * What a section states, and whether the list under it is the whole of it.
 *
 * THE POINT OF THE `bounded` FLAG. The queue renders a bounded page of rows,
 * and a bounded page under a heading that states a total is the shape this
 * whole file exists to prevent: /counsel/forms/approvals used to read the 200
 * most recent submissions of every status and take its "Awaiting decision"
 * figure from that, so a firm past its 200th document read a FLOOR labelled as
 * a count, and pending documents older than the cap appeared nowhere and were
 * announced nowhere. The dashboard's own "Awaiting approval" tile counts the
 * same set exactly, in the database, so the tile legitimately read a bigger
 * number than the page it opened.
 *
 * So the number is the count and the list says when it is showing less than
 * the number. Following app/counsel/billing/page.tsx, which draws Outstanding
 * from its own uncapped query and tells the reader the invoice table beneath
 * it is the 100 most recent.
 */
export type QueueTally = {
  /** Rows in this section that the page is actually holding. */
  loaded: number;
  /** Records in it across the firm. What the heading states. */
  total: number;
  /** True when the list is short of the total and must say so. */
  bounded: boolean;
};

function tally(loaded: number, counted: number | null): QueueTally {
  const total = counted ?? loaded;
  // A count below what we are already holding is not a reason to state a
  // number smaller than the rows on the page. It can happen honestly: the
  // count and the rows are separate round trips and a colleague can decide
  // something between them.
  return { loaded, total: Math.max(total, loaded), bounded: total > loaded };
}

/**
 * A view's tally. The ONE way this queue turns a view into a number: the
 * component must not filter and count for itself, because then the number
 * beside a view name is the length of a page again.
 */
export function viewTally(
  view: QueueViewKey,
  rows: ApprovalRow[],
  counts: QueueCounts | null,
  now = Date.now(),
): QueueTally {
  return tally(rows.filter(queueViewTest(view, now)).length, counts?.[view] ?? null);
}

/** The same, for the decision history, which is its own bounded read. */
export function settledTally(
  rows: ApprovalRow[],
  counts: QueueCounts | null,
  dir: QueueDirectionFacet = 'all',
): QueueTally {
  // Same rule as searchedViewTally. The server's settled count is over the
  // outbound table only, so once the facet narrows it is describing a
  // different set and the page's own rows are the honest answer.
  const shown = rows.filter((r) => isSettled(r) && matchesDirection(r, dir));
  if (dir !== 'all') return { loaded: shown.length, total: shown.length, bounded: false };
  return tally(shown.length, counts?.settled ?? null);
}

/**
 * A view's tally WITH the reviewer's search applied. The one the screen uses.
 *
 * Two separate defects met here and each fix would have undone the other, so
 * neither viewTally nor a plain filter is correct on its own.
 *
 * viewTally states the view's size in the DATABASE, which is what fixed a
 * heading that reported the size of its own page. But it does not know about
 * the search box, and a tab that ignores the search while the card beneath it
 * obeys it is exactly the "3 items waiting" over an empty card that was
 * reported from the live app.
 *
 * So the server's count is used only where it is actually describing what is
 * on screen: the unsearched view. The moment a reviewer types, the count has
 * to come from the same expression that produces the list, because the
 * server counted a set the reviewer is no longer looking at.
 *
 * `bounded` still tells the truth while searching. If the unsearched view is
 * larger than the rows this page holds, then the page was capped, and a search
 * over a capped page can only find what was fetched. Saying so is the
 * difference between "no results" and "no results in what we loaded".
 */
export function searchedViewTally(
  view: QueueViewKey,
  rows: ApprovalRow[],
  params: ApprovalQueueParams,
  counts: QueueCounts | null,
  now = Date.now(),
): QueueTally {
  const shown = selectQueue(rows, { ...params, view }, now).length;
  // A narrowed DIRECTION is treated exactly like a search, and for the same
  // reason spelled out above: the server counted a set the reviewer is no
  // longer looking at. Its count query is over firm_template_submissions
  // alone, so it does not know about inbound rows at all and it cannot be
  // asked to describe one half of a mixed queue. The moment the facet
  // narrows, the number has to come from the same expression that produces
  // the list.
  if (!params.q?.trim() && params.dir === 'all') {
    return viewTally(view, rows, counts, now);
  }
  const onPage = rows.filter(queueViewTest(view, now)).length;
  const inDatabase = counts?.[view] ?? onPage;
  return { loaded: shown, total: shown, bounded: inDatabase > onPage };
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
