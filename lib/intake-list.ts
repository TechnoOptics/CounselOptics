/**
 * The request queue's query state: what a URL means, and what it selects.
 *
 * The same module shape as lib/matter-list.ts, and for the same two reasons:
 * the URL is the source of truth, so a narrowed queue is a link a colleague
 * can be sent and the back button steps between views; and it is pure, so all
 * of it is testable with no DOM.
 *
 * WHERE THE VIEWS COME FROM. Every one is a set a request can actually be in,
 * expressed in vocabulary the product already has: the nine states in
 * `firm_matter_intakes.workflow_state`, the `assigned_to` column, and the four
 * priorities. Nothing here widens a status list. The service desk this list
 * was modelled on offers VIP, SLA at risk and Escalations; this product has no
 * client tier, no promised-by date and no escalation state, so it has none of
 * those three rather than a red word the data cannot support.
 *
 * "Open" is the NINE-state measure (not decided) and deliberately not
 * `isIntakeOpen`, which is the seven-value lane test. The two disagree in
 * exactly one case, on purpose: legacyStatusForWorkflow never overwrites
 * `converted`, so a converted request that is waiting on the other side's
 * signature reads as `accepted` to the employee while being live work to the
 * legal team. A work queue must not hide live work. The Impact KPI keeps
 * `isIntakeOpen`, and tests/ticket-workspace.test.ts pins the invariant that
 * stops the two contradicting each other: every state that means the firm is
 * finished writes a legacy status the employee also reads as finished.
 *
 * Filtering and sorting run over the set the page loaded, which is what keeps
 * a tab's count equal to the length of the list that tab renders. Pagination
 * slices last, so a count still describes the view and not the page.
 *
 * Relative imports, not '@/': lib modules are loaded by the test runner
 * without the Next.js path alias.
 */

import { paginate, type Paged } from './list-paging';
import {
  DECIDED_WORKFLOW_STATES,
  INTAKE_PRIORITIES,
  INTAKE_WORKFLOW_STATES,
  intakePriorityRank,
  type IntakePriority,
  type IntakeWorkflowState,
} from './intake-workflow';

/**
 * One row of the queue, as the page hands it down.
 *
 * `reference` is resolved on the server because the rule that produces it
 * (`refFor` in lib/intake-notify.ts, which prefers a partner's own external
 * id over REQ-XXXXXXX) lives in a `server-only` module. Carried as a string
 * for the same reason MatterRow carries `matterNumber`: one rule, one caller.
 */
export type IntakeListRow = {
  id: string;
  reference: string;
  /** What the request IS, from intakeTitle. Never the requester's name. */
  subject: string;
  matterType: string | null;
  jurisdiction: string | null;
  /** The request folder's name, or '' when it is in none. */
  folder: string;
  requesterName: string;
  /** Filed by one of the client's own people, from the Hub or a partner app. */
  inHouse: boolean;
  priority: IntakePriority;
  state: IntakeWorkflowState;
  assignedTo: string | null;
  assigneeLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntakeListViewKey =
  | 'open'
  | 'new'
  | 'mine'
  | 'unassigned'
  | 'waiting'
  | 'urgent'
  | 'all';

export const INTAKE_LIST_VIEW_KEYS: IntakeListViewKey[] = [
  'open',
  'new',
  'mine',
  'unassigned',
  'waiting',
  'urgent',
  'all',
];

/**
 * What each tab is called.
 *
 * Sentence case, and each one names the condition rather than borrowing a
 * service desk's word for it. "Awaiting others" is the three `awaiting_*`
 * states, which is this product's real blocked condition: somebody outside
 * this team owes us something.
 */
export const INTAKE_LIST_VIEW_LABEL: Record<IntakeListViewKey, string> = {
  open: 'All open',
  new: 'New',
  mine: 'Mine',
  unassigned: 'Unassigned',
  waiting: 'Awaiting others',
  urgent: 'Urgent',
  all: 'Everything',
};

/** The three states that mean somebody outside the legal team owes us something. */
export const AWAITING_WORKFLOW_STATES: readonly IntakeWorkflowState[] =
  INTAKE_WORKFLOW_STATES.filter((s) => s.startsWith('awaiting_'));

/** Where a request is from. The two views this list used to have, as a filter. */
export type IntakeSourceFilter = '' | 'inhouse' | 'external';

export type IntakeSortKey =
  | 'priority'
  | 'subject'
  | 'requester'
  | 'state'
  | 'owner'
  | 'age'
  | 'updated';

const SORT_KEYS: IntakeSortKey[] = [
  'priority',
  'subject',
  'requester',
  'state',
  'owner',
  'age',
  'updated',
];

/**
 * Which way a column sorts when it is first clicked.
 *
 * `priority` descending and `age` ascending are the two that matter: the queue
 * should open with the most urgent request at the top, and the age column
 * should first show whatever has been waiting longest.
 */
export const INTAKE_SORT_DEFAULT_DIR: Record<IntakeSortKey, 'asc' | 'desc'> = {
  priority: 'desc',
  subject: 'asc',
  requester: 'asc',
  state: 'asc',
  owner: 'asc',
  age: 'asc',
  updated: 'desc',
};

export type IntakeListParams = {
  view: IntakeListViewKey;
  /** Global search: subject, requester, reference, owner. */
  q: string;
  /** Reference column filter. */
  ref: string;
  /** Subject column filter: subject, matter type, jurisdiction, folder. */
  subject: string;
  requester: string;
  /** '' or one of the nine workflow states. */
  state: string;
  /** '', 'me', 'unassigned', or a member's user id. */
  owner: string;
  source: IntakeSourceFilter;
  /** '' or one of the four priorities. */
  priority: string;
  sort: IntakeSortKey;
  dir: 'asc' | 'desc';
  /** 1-based. */
  page: number;
};

/** Rows per page. Prev and Next step by this. */
export const INTAKE_PAGE_SIZE = 25;

/**
 * How many requests the queue reads to draw, sort and filter over.
 *
 * A bound, because `intake_answers` is a jsonb blob per row and a firm with
 * years of history behind it should not pay for all of it to render page one.
 * It is generous enough that the honest sentence the page shows when it is
 * reached ("sorting and filtering cover the N most recent") is a rare
 * sentence rather than the normal state of the screen.
 *
 * The figure the page states as the firm's TOTAL never comes from here. That
 * is a separate uncapped `count: 'exact'` query, because a tally over a page
 * of rows is a floor and this repo has shipped one labelled as a total four
 * times.
 */
export const INTAKE_LIST_READ_LIMIT = 500;

/**
 * The predicate behind a view.
 *
 * `mine` needs a signed-in user id. Without one it matches nothing rather
 * than everything, because a "Mine" showing the whole firm's queue would be a
 * lie; the caller drops the option in that case, so this is the belt to that
 * braces.
 */
export function intakeViewTest(
  view: IntakeListViewKey,
  meId: string | null,
): (r: IntakeListRow) => boolean {
  switch (view) {
    case 'new':
      return (r) => r.state === 'new';
    case 'mine':
      return (r) => Boolean(meId) && r.assignedTo === meId;
    case 'unassigned':
      return (r) => !r.assignedTo;
    case 'waiting':
      return (r) => AWAITING_WORKFLOW_STATES.includes(r.state);
    case 'urgent':
      return (r) => r.priority === 'Urgent';
    case 'all':
      return () => true;
    default:
      return (r) => !DECIDED_WORKFLOW_STATES.includes(r.state);
  }
}

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/**
 * Read the list's state out of a query string.
 *
 * Every field falls back to its default rather than rejecting, so a
 * hand-edited or truncated URL lands somewhere sensible instead of erroring.
 *
 * `?view=internal` and `?view=external` are honoured as the SOURCE filter they
 * used to be. Those are links colleagues have already been sent, and letting
 * them fall through to the default would quietly drop the narrowing the link
 * was sent for.
 */
export function parseIntakeListParams(
  searchParams: Record<string, string | string[] | undefined>,
  meId: string | null,
): IntakeListParams {
  const rawView = one(searchParams.view);
  const legacySource: IntakeSourceFilter =
    rawView === 'external' ? 'external' : rawView === 'internal' ? 'inhouse' : '';

  const view: IntakeListViewKey =
    INTAKE_LIST_VIEW_KEYS.includes(rawView as IntakeListViewKey) &&
    (rawView !== 'mine' || meId)
      ? (rawView as IntakeListViewKey)
      : 'open';

  const rawSort = one(searchParams.sort) as IntakeSortKey;
  const sort: IntakeSortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'priority';
  const rawDir = one(searchParams.dir);
  const dir: 'asc' | 'desc' =
    rawDir === 'asc' || rawDir === 'desc'
      ? rawDir
      : INTAKE_SORT_DEFAULT_DIR[sort];

  const rawState = one(searchParams.state);
  const rawPriority = one(searchParams.priority);
  const rawSource = one(searchParams.source);
  const pageNum = Number.parseInt(one(searchParams.page), 10);

  return {
    view,
    q: one(searchParams.q),
    ref: one(searchParams.ref),
    subject: one(searchParams.subject),
    requester: one(searchParams.requester),
    state: INTAKE_WORKFLOW_STATES.includes(rawState as IntakeWorkflowState)
      ? rawState
      : '',
    owner: one(searchParams.owner),
    source:
      rawSource === 'inhouse' || rawSource === 'external'
        ? rawSource
        : legacySource,
    priority: (INTAKE_PRIORITIES as readonly string[]).includes(rawPriority)
      ? rawPriority
      : '',
    sort,
    dir,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

/** The query string for `params`, omitting everything left at default. */
export function intakeListQuery(params: IntakeListParams): string {
  const qs = new URLSearchParams();
  if (params.view !== 'open') qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.ref) qs.set('ref', params.ref);
  if (params.subject) qs.set('subject', params.subject);
  if (params.requester) qs.set('requester', params.requester);
  if (params.state) qs.set('state', params.state);
  if (params.owner) qs.set('owner', params.owner);
  if (params.source) qs.set('source', params.source);
  if (params.priority) qs.set('priority', params.priority);
  if (params.sort !== 'priority') qs.set('sort', params.sort);
  if (params.dir !== INTAKE_SORT_DEFAULT_DIR[params.sort]) {
    qs.set('dir', params.dir);
  }
  if (params.page > 1) qs.set('page', String(params.page));
  return qs.toString();
}

/**
 * A link to this list with `patch` applied.
 *
 * Any change other than the page itself returns to page 1: staying on page 3
 * of a set you just narrowed to eight rows shows an empty table and reads as
 * a bug.
 */
export function intakeListHref(
  params: IntakeListParams,
  patch: Partial<IntakeListParams>,
  pathname = '/counsel/inbox',
): string {
  const next: IntakeListParams = { ...params, ...patch };
  if (patch.page == null) next.page = 1;
  const qs = intakeListQuery(next);
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The sort a click on `key`'s header should produce. */
export function nextIntakeSort(
  params: IntakeListParams,
  key: IntakeSortKey,
): { sort: IntakeSortKey; dir: 'asc' | 'desc' } {
  if (params.sort !== key) {
    return { sort: key, dir: INTAKE_SORT_DEFAULT_DIR[key] };
  }
  return { sort: key, dir: params.dir === 'asc' ? 'desc' : 'asc' };
}

/** The rows a set of params selects, in order, before pagination. */
export function filterIntakes(
  rows: IntakeListRow[],
  params: IntakeListParams,
  meId: string | null,
): IntakeListRow[] {
  const test = intakeViewTest(params.view, meId);
  const q = params.q.toLowerCase();
  const ref = params.ref.toLowerCase();
  const subject = params.subject.toLowerCase();
  const requester = params.requester.toLowerCase();

  return rows.filter((r) => {
    if (!test(r)) return false;
    if (params.state && r.state !== params.state) return false;
    if (params.priority && r.priority !== params.priority) return false;
    if (params.source === 'inhouse' && !r.inHouse) return false;
    if (params.source === 'external' && r.inHouse) return false;
    if (params.owner === 'unassigned' && r.assignedTo) return false;
    if (params.owner === 'me' && r.assignedTo !== meId) return false;
    if (
      params.owner &&
      params.owner !== 'me' &&
      params.owner !== 'unassigned' &&
      r.assignedTo !== params.owner
    ) {
      return false;
    }
    if (ref && !r.reference.toLowerCase().includes(ref)) return false;
    if (requester && !r.requesterName.toLowerCase().includes(requester)) {
      return false;
    }
    if (subject) {
      const cell = `${r.subject} ${r.matterType ?? ''} ${r.jurisdiction ?? ''} ${r.folder}`;
      if (!cell.toLowerCase().includes(subject)) return false;
    }
    if (!q) return true;
    return (
      r.subject.toLowerCase().includes(q) ||
      r.requesterName.toLowerCase().includes(q) ||
      r.reference.toLowerCase().includes(q) ||
      (r.assigneeLabel ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * How many requests each tab would show, under the search and the column
 * filters now in force.
 *
 * A count is the length of the list its own tab would render, from
 * filterIntakes itself. Counting the view alone is what left the matters strip
 * claiming "Open work 12" over "No matters match this view and these filters",
 * and the lane headings on the list this replaced stated the length of a slice
 * of a capped read.
 */
export function intakeViewCounts(
  rows: IntakeListRow[],
  params: IntakeListParams,
  meId: string | null,
): Record<IntakeListViewKey, number> {
  const counts = {} as Record<IntakeListViewKey, number>;
  for (const view of INTAKE_LIST_VIEW_KEYS) {
    counts[view] = filterIntakes(rows, { ...params, view }, meId).length;
  }
  return counts;
}

/**
 * Sort a filtered set.
 *
 * A request with nobody on it sorts last in BOTH directions: an absent value
 * is not an early one, and flipping the column should not parade the requests
 * that have no owner at all.
 */
export function sortIntakes(
  rows: IntakeListRow[],
  params: IntakeListParams,
): IntakeListRow[] {
  const dir = params.dir === 'asc' ? 1 : -1;
  const rank = (r: IntakeListRow): [number, string | number] => {
    switch (params.sort) {
      case 'priority':
        return [0, intakePriorityRank(r.priority)];
      case 'subject':
        return [0, r.subject.toLowerCase()];
      case 'requester':
        return [0, r.requesterName.toLowerCase()];
      case 'state':
        // The nine are declared in the order a request travels, so the index
        // walks the pipeline rather than the alphabet.
        return [0, INTAKE_WORKFLOW_STATES.indexOf(r.state)];
      case 'owner':
        return [
          r.assigneeLabel ? 0 : 1,
          (r.assigneeLabel ?? '').toLowerCase(),
        ];
      case 'age':
        return [0, Date.parse(r.createdAt) || 0];
      default:
        return [0, Date.parse(r.updatedAt) || 0];
    }
  };
  return [...rows].sort((a, b) => {
    const [aNull, aVal] = rank(a);
    const [bNull, bVal] = rank(b);
    if (aNull !== bNull) return aNull - bNull;
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });
}

export type IntakePage = Paged<IntakeListRow>;

/** Slice a sorted set into the requested page. */
export function paginateIntakes(
  rows: IntakeListRow[],
  page: number,
  pageSize = INTAKE_PAGE_SIZE,
): IntakePage {
  return paginate(rows, page, pageSize);
}

/**
 * True when anything narrows the set beyond the chosen view.
 *
 * The view is not counted. It is what the tabs are for, and offering to clear
 * it would offer to clear the tab the reader is standing on.
 */
export function hasActiveIntakeFilters(params: IntakeListParams): boolean {
  return Boolean(
    params.q ||
      params.ref ||
      params.subject ||
      params.requester ||
      params.state ||
      params.owner ||
      params.source ||
      params.priority,
  );
}
