/**
 * The matter list's query state: what a URL means, and what it selects.
 *
 * Everything the list does to a set of matters (which view, which
 * column filters, which sort, which page) is decided here, from a
 * plain object parsed out of the query string. Two reasons it is a
 * module and not hooks inside the table:
 *
 *   1. The URL is the source of truth. The server page parses the
 *      query string with `parseMatterListParams` and hands the result
 *      down; the table builds every href with `matterListHref` off the
 *      same shape. One parser and one serializer, so a link the table
 *      writes is a link the page can read back.
 *   2. It is pure, so the whole of it is testable under the node
 *      environment this repo's vitest runs in, with no DOM.
 *
 * Filtering and sorting stay client-side over the whole set, which is
 * what keeps the view strip's counts honest: each count is the length
 * of the array that view would render. Pagination slices only the last
 * step, so the counts still describe the whole view and not the page.
 */

import { displayMatterNumber } from './ticket-numbers';
import { paginate, type Paged } from './list-paging';

export type MatterRow = {
  id: string;
  /**
   * The firm's own reference, e.g. 'MAT-0000001', or null for a matter the
   * allocator has not reached. Null renders as the leading segment of the id,
   * which is what the Ref column showed before matter numbers existed. See
   * displayMatterNumber in lib/ticket-numbers.ts.
   */
  matterNumber: string | null;
  title: string;
  subjectName: string;
  caseType: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  assignedTo: string | null;
  assigneeLabel: string | null;
  hearingAt: string | null;
  updatedAt: string;
};

export type ViewKey = 'open' | 'mine' | 'unassigned' | 'hearing' | 'all';

export type SortKey = 'title' | 'status' | 'assignee' | 'hearing' | 'updated';

export type HearingFilter = '' | 'set' | 'none' | 'soon' | 'past';

export type UpdatedFilter = '' | '24h' | '7d' | '30d' | 'older';

export type MatterListParams = {
  view: ViewKey;
  /** Global search: title, client, matter type, assignee. */
  q: string;
  /** Matter column filter: title or client. */
  matter: string;
  /** Matter id column filter. */
  ref: string;
  status: string;
  /** '', 'me', 'unassigned', or a member's user id. */
  assignee: string;
  hearing: HearingFilter;
  updated: UpdatedFilter;
  sort: SortKey;
  dir: 'asc' | 'desc';
  /** 1-based. */
  page: number;
};

/** Workflow order, so sorting by status walks the pipeline. */
export const STATUS_ORDER = [
  'draft',
  'open',
  'under_review',
  'needs_evidence',
  'export_ready',
  'closed',
  'archived',
];

const CLOSED = new Set(['closed', 'archived']);

/** A hearing this close is the one the list should surface. */
export const HEARING_SOON_DAYS = 30;

/** Rows per page. Prev and Next step by this. */
export const PAGE_SIZE = 25;

export const VIEW_KEYS: ViewKey[] = [
  'open',
  'mine',
  'unassigned',
  'hearing',
  'all',
];

const SORT_KEYS: SortKey[] = ['title', 'status', 'assignee', 'hearing', 'updated'];

export const SORT_DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  title: 'asc',
  status: 'asc',
  assignee: 'asc',
  hearing: 'asc',
  updated: 'desc',
};

const HEARING_FILTERS: HearingFilter[] = ['', 'set', 'none', 'soon', 'past'];
const UPDATED_FILTERS: UpdatedFilter[] = ['', '24h', '7d', '30d', 'older'];

export function hearingSoon(iso: string | null, now = Date.now()): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  const delta = at - now;
  return delta >= 0 && delta <= HEARING_SOON_DAYS * 86400 * 1000;
}

/**
 * The predicate behind a view.
 *
 * `mine` needs a signed-in user id. Without one it matches nothing
 * rather than everything, because a "Mine" that showed the whole firm's
 * caseload would be a lie; the caller drops the option in that case, so
 * this is the belt to that braces.
 */
export function viewTest(
  view: ViewKey,
  meId: string | null,
  now = Date.now(),
): (r: MatterRow) => boolean {
  switch (view) {
    case 'mine':
      return (r) => Boolean(meId) && r.assignedTo === meId;
    case 'unassigned':
      return (r) => !r.assignedTo;
    case 'hearing':
      return (r) => hearingSoon(r.hearingAt, now);
    case 'all':
      return () => true;
    default:
      return (r) => !CLOSED.has(r.status);
  }
}

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/**
 * Read the list's state out of a query string.
 *
 * Every field falls back to its default rather than rejecting, because
 * a hand-edited or truncated URL should land somewhere sensible instead
 * of erroring. `meId` is needed because `?view=mine` from a session with
 * no user id has no meaning and degrades to the default view.
 */
export function parseMatterListParams(
  searchParams: Record<string, string | string[] | undefined>,
  meId: string | null,
): MatterListParams {
  const rawView = one(searchParams.view) as ViewKey;
  const view: ViewKey =
    VIEW_KEYS.includes(rawView) && (rawView !== 'mine' || meId)
      ? rawView
      : 'open';

  const rawSort = one(searchParams.sort) as SortKey;
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'updated';
  const rawDir = one(searchParams.dir);
  const dir: 'asc' | 'desc' =
    rawDir === 'asc' || rawDir === 'desc' ? rawDir : SORT_DEFAULT_DIR[sort];

  const rawHearing = one(searchParams.hearing) as HearingFilter;
  const rawUpdated = one(searchParams.updated) as UpdatedFilter;

  const pageNum = Number.parseInt(one(searchParams.page), 10);

  return {
    view,
    q: one(searchParams.q),
    matter: one(searchParams.matter),
    ref: one(searchParams.ref),
    status: one(searchParams.status),
    assignee: one(searchParams.assignee),
    hearing: HEARING_FILTERS.includes(rawHearing) ? rawHearing : '',
    updated: UPDATED_FILTERS.includes(rawUpdated) ? rawUpdated : '',
    sort,
    dir,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

/** The query string for `params`, omitting everything left at default. */
export function matterListQuery(params: MatterListParams): string {
  const qs = new URLSearchParams();
  if (params.view !== 'open') qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.matter) qs.set('matter', params.matter);
  if (params.ref) qs.set('ref', params.ref);
  if (params.status) qs.set('status', params.status);
  if (params.assignee) qs.set('assignee', params.assignee);
  if (params.hearing) qs.set('hearing', params.hearing);
  if (params.updated) qs.set('updated', params.updated);
  if (params.sort !== 'updated') qs.set('sort', params.sort);
  if (params.dir !== SORT_DEFAULT_DIR[params.sort]) qs.set('dir', params.dir);
  if (params.page > 1) qs.set('page', String(params.page));
  return qs.toString();
}

/**
 * A link to this list with `patch` applied.
 *
 * Any change other than the page itself returns to page 1: staying on
 * page 3 of a set you just narrowed to eight rows shows an empty table
 * and reads as a bug.
 */
export function matterListHref(
  params: MatterListParams,
  patch: Partial<MatterListParams>,
  pathname = '/counsel/cases',
): string {
  const next: MatterListParams = { ...params, ...patch };
  if (patch.page == null) next.page = 1;
  const qs = matterListQuery(next);
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The sort a click on `key`'s header should produce. */
export function nextSort(
  params: MatterListParams,
  key: SortKey,
): { sort: SortKey; dir: 'asc' | 'desc' } {
  if (params.sort !== key) return { sort: key, dir: SORT_DEFAULT_DIR[key] };
  return { sort: key, dir: params.dir === 'asc' ? 'desc' : 'asc' };
}

function matchesUpdated(iso: string, filter: UpdatedFilter, now: number): boolean {
  if (!filter) return true;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  const age = now - at;
  const day = 86400 * 1000;
  switch (filter) {
    case '24h':
      return age < day;
    case '7d':
      return age < 7 * day;
    case '30d':
      return age < 30 * day;
    default:
      return age >= 30 * day;
  }
}

function matchesHearing(
  iso: string | null,
  filter: HearingFilter,
  now: number,
): boolean {
  if (!filter) return true;
  if (filter === 'none') return !iso;
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  if (filter === 'set') return true;
  if (filter === 'past') return at < now;
  return at >= now && at - now <= HEARING_SOON_DAYS * 86400 * 1000;
}

/**
 * The rows a set of params selects, in order, before pagination.
 *
 * The view predicate runs first, then the search, then every column filter.
 * This docblock used to claim that made the strip count and the table's rows
 * "one definition"; it did not, because matters-table.tsx counted the strip
 * with the bare viewTest and never came through here. matterViewCounts below
 * is what makes the claim true.
 */
export function filterMatters(
  rows: MatterRow[],
  params: MatterListParams,
  meId: string | null,
  now = Date.now(),
): MatterRow[] {
  const test = viewTest(params.view, meId, now);
  const q = params.q.toLowerCase();
  const matter = params.matter.toLowerCase();
  const ref = params.ref.toLowerCase();

  return rows.filter((r) => {
    if (!test(r)) return false;
    if (params.status && r.status !== params.status) return false;
    if (params.assignee === 'unassigned' && r.assignedTo) return false;
    if (params.assignee === 'me' && r.assignedTo !== meId) return false;
    if (
      params.assignee &&
      params.assignee !== 'me' &&
      params.assignee !== 'unassigned' &&
      r.assignedTo !== params.assignee
    ) {
      return false;
    }
    if (!matchesHearing(r.hearingAt, params.hearing, now)) return false;
    if (!matchesUpdated(r.updatedAt, params.updated, now)) return false;
    if (matter) {
      const cell = `${r.title} ${r.subjectName} ${r.caseType}`.toLowerCase();
      if (!cell.includes(matter)) return false;
    }
    // The Ref filter matches what the Ref column SHOWS, and also the raw id
    // underneath it. A firm types the reference it was quoted, so that has to
    // find the matter; the id still matches because it is what the column
    // showed before matter numbers existed, it is what the chip's hover title
    // still shows, and it is what a URL pasted into the box contains.
    if (
      ref &&
      !displayMatterNumber(r).toLowerCase().includes(ref) &&
      !r.id.toLowerCase().includes(ref)
    ) {
      return false;
    }
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) ||
      r.subjectName.toLowerCase().includes(q) ||
      r.caseType.toLowerCase().includes(q) ||
      (r.assigneeLabel ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * How many matters each view would show, under the search and the column
 * filters now in force.
 *
 * The strip used to be built in the table from `rows.filter(viewTest(key))`,
 * which is the view and nothing else, while the table below it came from
 * filterMatters, which is the view AND the search box AND six column filters.
 * The two agreed only on an untouched page: narrow to a client nobody matches
 * and "Open work 12" sat over "No matters match this view and these filters."
 *
 * So a count is the length of the list its own tab would render, from
 * filterMatters itself, and `now` is threaded through so the hearing view and
 * the updated filter read one clock across all five.
 */
export function matterViewCounts(
  rows: MatterRow[],
  params: MatterListParams,
  meId: string | null,
  now = Date.now(),
): Record<ViewKey, number> {
  const counts = {} as Record<ViewKey, number>;
  for (const view of VIEW_KEYS) {
    counts[view] = filterMatters(rows, { ...params, view }, meId, now).length;
  }
  return counts;
}

/**
 * Sort a filtered set.
 *
 * A row with no hearing and a row with no assignee sort last in BOTH
 * directions: an absent value is not an early one, and flipping the
 * column should not parade the matters that have no hearing at all.
 */
export function sortMatters(
  rows: MatterRow[],
  params: MatterListParams,
): MatterRow[] {
  const dir = params.dir === 'asc' ? 1 : -1;
  const rank = (r: MatterRow): [number, string | number] => {
    switch (params.sort) {
      case 'title':
        return [0, r.title.toLowerCase()];
      case 'status':
        return [0, STATUS_ORDER.indexOf(r.status)];
      case 'assignee':
        return [r.assigneeLabel ? 0 : 1, (r.assigneeLabel ?? '').toLowerCase()];
      case 'hearing':
        return [r.hearingAt ? 0 : 1, r.hearingAt ? Date.parse(r.hearingAt) : 0];
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

export type MatterPage = Paged<MatterRow>;

/**
 * Slice a sorted set into the requested page.
 *
 * The arithmetic itself lives in lib/list-paging.ts, because the request queue
 * wants it verbatim and two copies of it is two chances for a pager to read
 * `26-50 of 30`. This keeps the name the table and its tests already call.
 */
export function paginateMatters(
  rows: MatterRow[],
  page: number,
  pageSize = PAGE_SIZE,
): MatterPage {
  return paginate(rows, page, pageSize);
}

/** True when anything narrows the set beyond the chosen view. */
export function hasActiveFilters(params: MatterListParams): boolean {
  return Boolean(
    params.q ||
      params.matter ||
      params.ref ||
      params.status ||
      params.assignee ||
      params.hearing ||
      params.updated,
  );
}
