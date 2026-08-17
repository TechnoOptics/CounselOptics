/**
 * One page of a list, and the range it is showing.
 *
 * This arithmetic was written inside lib/matter-list.ts and is wanted verbatim
 * by lib/intake-list.ts. Two copies of "which page am I on, clamped, and which
 * rows does that mean" is two chances for a pager to read `26-50 of 30`, so
 * there is one and both lists call it. `paginateMatters` stays exported under
 * its own name and delegates here, because it is what the matters table and
 * its tests already call.
 *
 * Deliberately generic over the row type: it never looks inside a row.
 */

export type Paged<T> = {
  /** The rows on this page. */
  rows: T[];
  /** Rows the view and filters select, across all pages. */
  total: number;
  /** The page actually shown, clamped into range. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown, or 0 when there are none. */
  from: number;
  /** 1-based index of the last row shown, or 0 when there are none. */
  to: number;
};

/**
 * Slice a sorted set into the requested page.
 *
 * The page is clamped rather than trusted: `?page=99` on a four-row list shows
 * the last page, not an empty table with a Prev button as the only way out.
 */
export function paginate<T>(rows: T[], page: number, pageSize: number): Paged<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    total,
    page: current,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: slice.length ? start + slice.length : 0,
  };
}
