import { describe, it, expect } from 'vitest';
import { isCounselItemActive } from '@/lib/counsel-routing';
import { DEFAULT_MENU } from '@/lib/menu-config';

/**
 * Only one rail row may be lit at a time.
 *
 * The descendant rule ("a row is active on its own path or any path
 * under it") is right for one row read alone and wrong for a menu,
 * because two rows can both be ancestors of one path. On
 * /counsel/forms/approvals both "Employee forms" and "Document
 * approvals" lit up, and the rail told the reader they were in two
 * places at once.
 *
 * These assertions are written against the REAL menu rather than
 * invented hrefs, so a future item nested under an existing one is
 * covered the day it is added rather than the day somebody remembers
 * to extend a fixture.
 */
const ALL_HREFS = DEFAULT_MENU.flatMap((s) => s.items.map((i) => i.href));

/** Every href that is a strict prefix of another href in the menu. */
function nestedPairs(): Array<{ parent: string; child: string }> {
  const pairs: Array<{ parent: string; child: string }> = [];
  for (const parent of ALL_HREFS) {
    for (const child of ALL_HREFS) {
      if (child !== parent && child.startsWith(parent + '/')) {
        pairs.push({ parent, child });
      }
    }
  }
  return pairs;
}

describe('the counsel rail lights exactly one row', () => {
  it('has at least one nested pair to protect, or this whole file is vacuous', () => {
    // If the menu ever flattens, these assertions would pass by having
    // nothing to check. Fail loudly instead of reporting a green that
    // means nothing.
    expect(
      nestedPairs().length,
      'no nested menu hrefs found: either the menu changed shape or the extraction broke',
    ).toBeGreaterThan(0);
  });

  it('gives the child page to the child row, not the parent', () => {
    for (const { parent, child } of nestedPairs()) {
      expect(
        isCounselItemActive(parent, child, ALL_HREFS),
        `${parent} should not be active on ${child}, which ${child} owns`,
      ).toBe(false);
      expect(
        isCounselItemActive(child, child, ALL_HREFS),
        `${child} should be active on its own path`,
      ).toBe(true);
    }
  });

  it('still gives the parent its own path and its unclaimed descendants', () => {
    for (const { parent } of nestedPairs()) {
      expect(isCounselItemActive(parent, parent, ALL_HREFS)).toBe(true);
      // The dashboard is the one row that deliberately does NOT own its
      // descendants: /counsel is a prefix of every other page, so the
      // descendant rule would light it everywhere. That exception
      // predates this change and is asserted on its own below. This
      // assertion caught me writing it the other way round.
      if (parent === '/counsel') continue;
      // Any other parent still owns a descendant no row claims.
      const unclaimed = `${parent}/zz-not-a-real-child`;
      expect(
        isCounselItemActive(parent, unclaimed, ALL_HREFS),
        `${parent} should still own ${unclaimed}, which nothing else claims`,
      ).toBe(true);
    }
  });

  it('never lights the dashboard on a page below it', () => {
    for (const href of ALL_HREFS.filter((h) => h !== '/counsel')) {
      expect(isCounselItemActive('/counsel', href, ALL_HREFS)).toBe(false);
    }
    expect(isCounselItemActive('/counsel', '/counsel', ALL_HREFS)).toBe(true);
    expect(isCounselItemActive('/counsel', '/counsel/', ALL_HREFS)).toBe(true);
  });

  it('never lights two rows for any real page in the menu', () => {
    for (const href of ALL_HREFS) {
      const lit = ALL_HREFS.filter((h) => isCounselItemActive(h, href, ALL_HREFS));
      expect(lit, `${href} lit ${lit.length} rows: ${lit.join(', ')}`).toHaveLength(1);
    }
  });

  it('keeps the old two-argument behaviour for a row read in isolation', () => {
    // Callers that ask about one row without a menu still get the
    // descendant rule, which is what the existing guards assert.
    expect(isCounselItemActive('/counsel/forms', '/counsel/forms/approvals')).toBe(true);
    expect(isCounselItemActive('/counsel', '/counsel/cases')).toBe(false);
  });
});
