/**
 * One page of a list, and the range it is showing.
 *
 * The arithmetic was written for the matter list and is wanted verbatim by the
 * request queue. Two copies of "which page am I on, clamped, and which rows
 * does that mean" is two chances for a pager to say `26-50 of 30`, so there is
 * one and both lists call it.
 */

import { describe, expect, it } from 'vitest';

import { paginate } from '@/lib/list-paging';
import { paginateMatters, PAGE_SIZE } from '@/lib/matter-list';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('paginate', () => {
  it('reports the range it is showing, one-based', () => {
    const p = paginate(rows(30), 2, 25);
    expect(p.rows).toEqual([26, 27, 28, 29, 30]);
    expect(p.total).toBe(30);
    expect(p.page).toBe(2);
    expect(p.pageCount).toBe(2);
    expect(p.from).toBe(26);
    expect(p.to).toBe(30);
  });

  it('clamps a page past the end rather than showing an empty table', () => {
    // ?page=99 on a four-row list shows the last page, not a Prev button as
    // the only way out.
    const p = paginate(rows(4), 99, 25);
    expect(p.page).toBe(1);
    expect(p.rows).toHaveLength(4);
  });

  it('clamps a page below one', () => {
    expect(paginate(rows(4), 0, 25).page).toBe(1);
    expect(paginate(rows(4), -3, 25).page).toBe(1);
  });

  it('reports a zero range for an empty set rather than 1-0', () => {
    const p = paginate<number>([], 1, 25);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
    expect(p.pageCount).toBe(1);
  });
});

describe('the matter list is one of the two callers', () => {
  it('pages matters exactly as paginate does, so there is one arithmetic', () => {
    const set = rows(60).map((n) => ({ id: String(n) }));
    for (const page of [1, 2, 3, 99]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(paginateMatters(set as any, page)).toEqual(
        paginate(set, page, PAGE_SIZE),
      );
    }
  });
});
