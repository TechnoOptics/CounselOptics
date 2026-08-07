import { describe, expect, it } from 'vitest';
import {
  UNFILED_CATEGORY,
  categoryForRecord,
  groupByCategory,
  normalizeCategory,
} from '../lib/document-category';

/**
 * The category a document is filed under, as pure rules.
 *
 * Both queues group by this: the legal team's approvals queue and the
 * employee's list of what they have sent. They have to agree about what
 * counts as one category and about where the ones with no category go, so the
 * agreement is a function rather than two sort callbacks written twice.
 */

describe('categoryForRecord', () => {
  /**
   * What goes on the row, and it is never the word Unfiled. A record with no
   * category holds null and the reader supplies the label. Writing 'Unfiled'
   * into the column would make a firm that later creates a real category
   * called Unfiled unable to tell the two apart, and would put a word the
   * firm never typed onto their record.
   */
  it('keeps the firm words and nothing else', () => {
    expect(categoryForRecord('NDA')).toBe('NDA');
    expect(categoryForRecord('  Vendor agreements  ')).toBe('Vendor agreements');
  });

  it('is null for anything absent, so the record says nothing rather than guessing', () => {
    expect(categoryForRecord(null)).toBeNull();
    expect(categoryForRecord(undefined)).toBeNull();
    expect(categoryForRecord('')).toBeNull();
    expect(categoryForRecord('   ')).toBeNull();
    expect(categoryForRecord(42)).toBeNull();
  });

  it('caps at sixty characters, the same cap the reader uses', () => {
    const long = 'x'.repeat(200);
    expect(categoryForRecord(long)).toHaveLength(60);
    expect(normalizeCategory(long)).toHaveLength(60);
  });
});

describe('normalizeCategory', () => {
  it('labels an absent category rather than leaving a blank heading', () => {
    expect(UNFILED_CATEGORY).toBe('Unfiled');
    expect(normalizeCategory(null)).toBe(UNFILED_CATEGORY);
    expect(normalizeCategory('')).toBe(UNFILED_CATEGORY);
    expect(normalizeCategory('   ')).toBe(UNFILED_CATEGORY);
    expect(normalizeCategory(7)).toBe(UNFILED_CATEGORY);
  });

  it('passes a real category through, trimmed', () => {
    expect(normalizeCategory(' NDA ')).toBe('NDA');
  });
});

describe('groupByCategory', () => {
  type Row = { id: string; category: string | null };
  const of = (r: Row) => r.category;

  it('sorts the categories alphabetically and puts Unfiled last', () => {
    const rows: Row[] = [
      { id: 'a', category: null },
      { id: 'b', category: 'Vendor' },
      { id: 'c', category: 'NDA' },
      { id: 'd', category: 'employment' },
    ];
    expect(groupByCategory(rows, of).map((g) => g.category)).toEqual([
      'employment',
      'NDA',
      'Vendor',
      UNFILED_CATEGORY,
    ]);
  });

  /**
   * Case-insensitive, because a firm that typed "NDA" on one template and
   * "nda" on another means one category, and a queue that shows them as two
   * sections is a queue somebody stops trusting. The first spelling seen wins
   * the heading, so the label is the firm's own words rather than a
   * normalisation of them.
   */
  it('treats one category spelled two ways as one section', () => {
    const rows: Row[] = [
      { id: 'a', category: 'NDA' },
      { id: 'b', category: 'nda' },
      { id: 'c', category: ' Nda ' },
    ];
    const groups = groupByCategory(rows, of);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('NDA');
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  /**
   * Stable within a group. The callers hand these lists over already sorted
   * newest first, and grouping must not quietly reorder them: a reviewer
   * working down a queue relies on the order being the one the page promised.
   */
  it('keeps the input order inside each category', () => {
    const rows: Row[] = [
      { id: '1', category: 'NDA' },
      { id: '2', category: 'Vendor' },
      { id: '3', category: 'NDA' },
      { id: '4', category: 'Vendor' },
      { id: '5', category: 'NDA' },
    ];
    const groups = groupByCategory(rows, of);
    expect(groups.map((g) => g.category)).toEqual(['NDA', 'Vendor']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['1', '3', '5']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['2', '4']);
  });

  /**
   * A firm that names a real category Unfiled gets one section, not two, and
   * it sits where every other Unfiled sits. Splitting them would show two
   * headings with the same word on them.
   */
  it('folds a firm category literally named Unfiled into the same section', () => {
    const rows: Row[] = [
      { id: 'a', category: 'unfiled' },
      { id: 'b', category: null },
      { id: 'c', category: 'NDA' },
    ];
    const groups = groupByCategory(rows, of);
    expect(groups.map((g) => g.category)).toEqual(['NDA', UNFILED_CATEGORY]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('is empty for an empty list rather than showing a lone empty section', () => {
    expect(groupByCategory([] as Row[], of)).toEqual([]);
  });

  /**
   * The unmigrated case. Until the owner applies 20260807_flow_join.sql the
   * category column is not there, so every row arrives with the key missing
   * and both queues have to look exactly as they do today: one list, under
   * one heading, in the order they were already in.
   */
  it('degrades to a single section when no row carries a category at all', () => {
    const rows: Array<{ id: string }> = [{ id: '1' }, { id: '2' }];
    const groups = groupByCategory(rows, (r) => (r as { category?: string }).category);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe(UNFILED_CATEGORY);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['1', '2']);
  });
});
