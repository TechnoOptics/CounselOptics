import { describe, expect, it } from 'vitest';
import {
  listHref,
  nextSort,
  oneParam,
  sortRows,
} from '@/lib/counsel-list';

/**
 * The query helpers the documents, contracts and signing lists share.
 *
 * These are worth pinning rather than eyeballing because the whole
 * claim those three subtitles make ("the view, the filters and the sort
 * are in the address bar, so a narrowed list can be sent to a
 * colleague") is exactly this module being right. A link that drops a
 * filter, or a sort that never reverses, makes that copy a lie.
 */

describe('oneParam', () => {
  it('takes the first value when Next parsed a repeated key as an array', () => {
    expect(oneParam(['open', 'signed'])).toBe('open');
  });

  it('trims, so a pasted URL with a stray space still selects', () => {
    expect(oneParam(' open ')).toBe('open');
  });

  it('is the empty string for anything absent', () => {
    expect(oneParam(undefined)).toBe('');
    expect(oneParam([])).toBe('');
  });
});

describe('listHref', () => {
  it('carries the params it was not asked to change', () => {
    const href = listHref(
      '/counsel/documents',
      { view: 'overdue', status: 'sent' },
      { sort: 'name' },
    );
    expect(href).toContain('view=overdue');
    expect(href).toContain('status=sent');
    expect(href).toContain('sort=name');
  });

  it('drops a param cleared to the empty string rather than writing key=', () => {
    expect(
      listHref('/counsel/documents', { status: 'sent' }, { status: '' }),
    ).toBe('/counsel/documents');
  });

  it('is the bare path when nothing narrows the list', () => {
    expect(listHref('/counsel/signing', {}, {})).toBe('/counsel/signing');
  });

  it('orders keys, so the same state is always the same URL', () => {
    const a = listHref('/x', { status: 's', view: 'v' });
    const b = listHref('/x', { view: 'v', status: 's' });
    expect(a).toBe(b);
  });
});

describe('nextSort', () => {
  it('sorts a new column by that column’s own default direction', () => {
    expect(nextSort({ sort: 'updated', dir: 'desc' }, 'name', 'asc')).toEqual({
      sort: 'name',
      dir: 'asc',
    });
  });

  it('reverses the column that is already sorted', () => {
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'name', 'asc')).toEqual({
      sort: 'name',
      dir: 'desc',
    });
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 'b', due: '2026-03-01' },
    { id: 'a', due: null },
    { id: 'c', due: '2026-01-01' },
  ];

  it('orders by the key it is given', () => {
    expect(sortRows(rows, (r) => r.due, 'asc').map((r) => r.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('keeps the empties last in BOTH directions', () => {
    // A document with no due date is not the earliest due document, and
    // flipping the arrow should not park a block of blanks at the top.
    expect(sortRows(rows, (r) => r.due, 'desc').map((r) => r.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('compares numbers as numbers, not as text', () => {
    const scores = [{ n: 9 }, { n: 100 }, { n: 20 }];
    expect(sortRows(scores, (r) => r.n, 'desc').map((r) => r.n)).toEqual([
      100, 20, 9,
    ]);
  });

  it('does not mutate the array it was handed', () => {
    const original = [...rows];
    sortRows(rows, (r) => r.id, 'desc');
    expect(rows).toEqual(original);
  });
});
