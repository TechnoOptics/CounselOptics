/**
 * The category a document is filed under, as pure rules.
 *
 * The legal team asked for the awaiting-approval queue to be grouped under
 * the kind of document each submission is, NDA and so on, on their side and
 * on the employee's. Two pages doing that independently is two sort callbacks
 * that agree until one of them is edited, so the agreement lives here: what
 * counts as one category, what an absent one is called, and where it goes.
 *
 * The category is COPIED onto the submission when it is filed, not joined
 * from the template when the queue is read. A template can be recategorised
 * or archived months later and the submission has to keep the category it was
 * actually filed under, because that is the fact the record is asserting.
 *
 * Nothing here reads the database, so all of it is tested. The column it
 * describes arrives with 20260807_flow_join.sql and until the owner applies
 * that, every row reaches these functions with no category at all: the last
 * test in tests/document-category.test.ts pins that both queues then look
 * exactly as they do today.
 */

/** What a document with no category of its own is called in a heading. */
export const UNFILED_CATEGORY = 'Unfiled';

const CATEGORY_MAX = 60;

/**
 * What goes on the record: the firm's own words, trimmed and capped, or null.
 *
 * Never the word Unfiled. That is a label a reader supplies for a record that
 * says nothing, and writing it into the column would put a word the firm
 * never typed onto their document and make a real category of the same name
 * indistinguishable from an absent one.
 */
export function categoryForRecord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim().slice(0, CATEGORY_MAX) || null;
}

/** What a reader shows: the firm's words, or the label for having none. */
export function normalizeCategory(raw: unknown): string {
  return categoryForRecord(raw) ?? UNFILED_CATEGORY;
}

export type CategoryGroup<T> = { category: string; rows: T[] };

/**
 * Group rows under their category, categories in alphabetical order and
 * Unfiled last.
 *
 * Matching is case-insensitive: a firm that typed "NDA" on one template and
 * "nda" on another means one kind of document, and a queue that shows those
 * as two sections is a queue somebody stops reading. The heading keeps the
 * first spelling seen, so it is the firm's own words rather than a
 * normalisation of them.
 *
 * Rows keep the order they arrived in. Both callers hand these lists over
 * already sorted newest first and the grouping must not quietly resort them.
 */
export function groupByCategory<T>(
  rows: readonly T[],
  of: (row: T) => unknown,
): Array<CategoryGroup<T>> {
  const unfiledKey = UNFILED_CATEGORY.toUpperCase();
  const groups = new Map<string, CategoryGroup<T>>();
  for (const row of rows) {
    const label = normalizeCategory(of(row));
    const key = label.toUpperCase();
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    // The one heading that is not the firm's words: a firm that names a real
    // category "unfiled" shares the section with the records that have none,
    // so the section is spelled the one way rather than taking whichever
    // casing happened to arrive first.
    else groups.set(key, { category: key === unfiledKey ? UNFILED_CATEGORY : label, rows: [row] });
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      // Unfiled is not a category, it is the absence of one, so it sits under
      // everything the firm actually named rather than alphabetically among
      // them.
      if (a === unfiledKey) return b === unfiledKey ? 0 : 1;
      if (b === unfiledKey) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([, group]) => group);
}
