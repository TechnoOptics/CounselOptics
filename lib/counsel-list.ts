/**
 * The query state a counsel list page keeps in its URL.
 *
 * The list pattern in docs/TECHOTTIC-PARITY-SPEC.md section 3 puts the
 * view, the filters and the sort in the address bar, so a narrowed
 * queue is something a colleague can be sent and the back button steps
 * between views rather than out of the page. lib/matter-list.ts does
 * that for matters with a typed shape of its own, because the matter
 * list also paginates and has predicates only matters have.
 *
 * These are the parts that are not matter-specific: reading one param,
 * writing a link that carries the rest, flipping a sort, and ordering
 * rows by a key. Documents, contracts and signing requests all need
 * exactly these four and nothing more, so they share them rather than
 * growing three near-identical copies.
 *
 * Pure on purpose: the whole module runs under the node environment
 * this repo's vitest uses, with no DOM and no request.
 */

export type SortDir = 'asc' | 'desc';

/** One search param as a trimmed string, whichever way Next parsed it. */
export function oneParam(v: string | string[] | undefined): string {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' ? first.trim() : '';
}

/**
 * A link to `pathname` carrying `current` with `patch` applied.
 *
 * An empty value is dropped rather than written as `key=`, so a URL
 * names only what is actually narrowing the list and "no filters" is
 * the bare path.
 */
export function listHref(
  pathname: string,
  current: Record<string, string>,
  patch: Record<string, string> = {},
): string {
  const next = { ...current, ...patch };
  const qs = new URLSearchParams();
  for (const key of Object.keys(next).sort()) {
    const value = next[key];
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The sort a click on `key`'s header should produce.
 *
 * A first click on a column sorts it by that column's own default
 * direction (a date reads newest first, a name reads A to Z); a second
 * click on the column already sorted reverses it.
 */
export function nextSort(
  current: { sort: string; dir: SortDir },
  key: string,
  defaultDir: SortDir = 'desc',
): { sort: string; dir: SortDir } {
  if (current.sort !== key) return { sort: key, dir: defaultDir };
  return { sort: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * `rows` ordered by `key`, with the empties last in both directions.
 *
 * A document with no due date is not the earliest due document, and
 * flipping the sort should not park a block of blanks at the top. So
 * null and empty string are always after everything else, whichever
 * way the arrow points.
 */
export function sortRows<T>(
  rows: T[],
  key: (row: T) => string | number | null | undefined,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    const aEmpty = av == null || av === '';
    const bEmpty = bv == null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv), undefined, {
      sensitivity: 'base',
      numeric: true,
    }) * sign;
  });
}
