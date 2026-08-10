import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  filterMatters,
  hasActiveFilters,
  matterListHref,
  matterListQuery,
  nextSort,
  paginateMatters,
  parseMatterListParams,
  sortMatters,
  viewTest,
  type MatterListParams,
  type MatterRow,
} from '../lib/matter-list';

/**
 * The matter list's query state.
 *
 * These pin the thing the list is FOR: a URL that means the same set of
 * matters to whoever opens it. So the round trip (parse a query string,
 * serialize it back) is tested as hard as the filtering, and the
 * clamping is tested because a hand-edited `?page=99` is a real URL a
 * colleague will be sent.
 */

const NOW = Date.parse('2026-08-08T12:00:00Z');
const ME = 'user-me';

function row(over: Partial<MatterRow> & { id: string }): MatterRow {
  return {
    matterNumber: null,
    title: 'A matter',
    subjectName: 'A client',
    caseType: 'Employment',
    status: 'open',
    statusLabel: 'Open',
    statusColor: '#000000',
    assignedTo: null,
    assigneeLabel: null,
    hearingAt: null,
    updatedAt: '2026-08-08T11:00:00Z',
    ...over,
  };
}

const ROWS: MatterRow[] = [
  row({
    id: 'aaaa1111-0000-0000-0000-000000000000',
    title: 'Zinpro v. Hohag',
    subjectName: 'Zinpro',
    assignedTo: ME,
    assigneeLabel: 'Ada Lovelace',
    hearingAt: '2026-08-20T09:00:00Z',
    updatedAt: '2026-08-08T11:30:00Z',
  }),
  row({
    id: 'bbbb2222-0000-0000-0000-000000000000',
    title: 'Acme lease dispute',
    subjectName: 'Acme',
    caseType: 'Property',
    status: 'closed',
    statusLabel: 'Closed',
    assignedTo: 'user-other',
    assigneeLabel: 'Grace Hopper',
    hearingAt: '2026-01-04T09:00:00Z',
    updatedAt: '2026-05-01T09:00:00Z',
  }),
  row({
    id: 'cccc3333-0000-0000-0000-000000000000',
    title: 'Borel intake',
    subjectName: 'Borel',
    status: 'draft',
    statusLabel: 'Draft',
    updatedAt: '2026-08-01T09:00:00Z',
  }),
  row({
    id: 'dddd4444-0000-0000-0000-000000000000',
    title: 'Delta arbitration',
    subjectName: 'Delta',
    status: 'under_review',
    statusLabel: 'Under review',
    assignedTo: 'user-other',
    assigneeLabel: 'Grace Hopper',
    hearingAt: '2026-12-01T09:00:00Z',
    updatedAt: '2026-08-07T09:00:00Z',
  }),
];

const DEFAULTS = parseMatterListParams({}, ME);

function params(over: Partial<MatterListParams> = {}): MatterListParams {
  return { ...DEFAULTS, ...over };
}

describe('parseMatterListParams', () => {
  it('defaults every field when the query string is empty', () => {
    expect(DEFAULTS).toEqual({
      view: 'open',
      q: '',
      matter: '',
      ref: '',
      status: '',
      assignee: '',
      hearing: '',
      updated: '',
      sort: 'updated',
      dir: 'desc',
      page: 1,
    });
  });

  it('reads a view, a filter, a sort and a page out of the URL', () => {
    const p = parseMatterListParams(
      {
        view: 'hearing',
        status: 'open',
        assignee: 'me',
        hearing: 'soon',
        updated: '7d',
        sort: 'title',
        dir: 'desc',
        page: '3',
      },
      ME,
    );
    expect(p.view).toBe('hearing');
    expect(p.status).toBe('open');
    expect(p.assignee).toBe('me');
    expect(p.hearing).toBe('soon');
    expect(p.updated).toBe('7d');
    expect(p.sort).toBe('title');
    expect(p.dir).toBe('desc');
    expect(p.page).toBe(3);
  });

  it('falls back rather than erroring on nonsense a hand-edited URL carries', () => {
    const p = parseMatterListParams(
      { view: 'wat', sort: 'wat', dir: 'sideways', hearing: 'wat', page: '-4' },
      ME,
    );
    expect(p.view).toBe('open');
    expect(p.sort).toBe('updated');
    expect(p.dir).toBe('desc');
    expect(p.hearing).toBe('');
    expect(p.page).toBe(1);
  });

  it('drops ?view=mine when the session has no user id', () => {
    expect(parseMatterListParams({ view: 'mine' }, ME).view).toBe('mine');
    expect(parseMatterListParams({ view: 'mine' }, null).view).toBe('open');
  });

  it('takes the first value when a param is repeated', () => {
    expect(parseMatterListParams({ view: ['mine', 'all'] }, ME).view).toBe('mine');
  });

  it('applies each sort key its own default direction', () => {
    expect(parseMatterListParams({ sort: 'title' }, ME).dir).toBe('asc');
    expect(parseMatterListParams({ sort: 'updated' }, ME).dir).toBe('desc');
  });
});

describe('matterListQuery and matterListHref', () => {
  it('writes nothing for a list left at its defaults', () => {
    expect(matterListQuery(DEFAULTS)).toBe('');
    expect(matterListHref(DEFAULTS, {})).toBe('/counsel/cases');
  });

  it('round-trips: what it writes, the parser reads back', () => {
    const p = params({
      view: 'hearing',
      q: 'lease',
      matter: 'acme',
      ref: 'bbbb',
      status: 'closed',
      assignee: ME,
      hearing: 'past',
      updated: '30d',
      sort: 'assignee',
      dir: 'desc',
      page: 4,
    });
    const qs = Object.fromEntries(new URLSearchParams(matterListQuery(p)));
    expect(parseMatterListParams(qs, ME)).toEqual(p);
  });

  it('returns to page 1 on any change other than the page itself', () => {
    const onPage3 = params({ page: 3 });
    expect(matterListHref(onPage3, { view: 'all' })).toBe(
      '/counsel/cases?view=all',
    );
    expect(matterListHref(onPage3, { page: 4 })).toBe('/counsel/cases?page=4');
  });

  it('omits a direction that is already the sort key default', () => {
    expect(matterListHref(DEFAULTS, { sort: 'title', dir: 'asc' })).toBe(
      '/counsel/cases?sort=title',
    );
    expect(matterListHref(DEFAULTS, { sort: 'title', dir: 'desc' })).toBe(
      '/counsel/cases?sort=title&dir=desc',
    );
  });
});

describe('nextSort', () => {
  it('opens a new column at that column default direction', () => {
    expect(nextSort(DEFAULTS, 'title')).toEqual({ sort: 'title', dir: 'asc' });
    expect(nextSort(DEFAULTS, 'hearing')).toEqual({ sort: 'hearing', dir: 'asc' });
  });

  it('flips the direction when the column is already sorted', () => {
    expect(nextSort(params({ sort: 'title', dir: 'asc' }), 'title')).toEqual({
      sort: 'title',
      dir: 'desc',
    });
  });
});

describe('viewTest', () => {
  it('open work excludes closed and archived matters', () => {
    const t = viewTest('open', ME, NOW);
    expect(ROWS.filter(t).map((r) => r.title)).toEqual([
      'Zinpro v. Hohag',
      'Borel intake',
      'Delta arbitration',
    ]);
  });

  it('mine matches nothing at all when there is no signed-in user id', () => {
    expect(ROWS.filter(viewTest('mine', null, NOW))).toHaveLength(0);
    expect(ROWS.filter(viewTest('mine', ME, NOW))).toHaveLength(1);
  });

  it('hearing covers the next 30 days and not a hearing already past', () => {
    expect(ROWS.filter(viewTest('hearing', ME, NOW)).map((r) => r.title)).toEqual([
      'Zinpro v. Hohag',
    ]);
  });
});

describe('filterMatters', () => {
  it('narrows by status, and by the assignee pseudo-values', () => {
    expect(
      filterMatters(ROWS, params({ view: 'all', status: 'closed' }), ME, NOW),
    ).toHaveLength(1);
    expect(
      filterMatters(ROWS, params({ view: 'all', assignee: 'unassigned' }), ME, NOW),
    ).toHaveLength(1);
    expect(
      filterMatters(ROWS, params({ view: 'all', assignee: 'me' }), ME, NOW),
    ).toHaveLength(1);
    expect(
      filterMatters(ROWS, params({ view: 'all', assignee: 'user-other' }), ME, NOW),
    ).toHaveLength(2);
  });

  it('filters the matter column over title, client and matter type', () => {
    expect(
      filterMatters(ROWS, params({ view: 'all', matter: 'acme' }), ME, NOW).map(
        (r) => r.id,
      ),
    ).toEqual(['bbbb2222-0000-0000-0000-000000000000']);
    expect(
      filterMatters(ROWS, params({ view: 'all', matter: 'property' }), ME, NOW),
    ).toHaveLength(1);
  });

  it('filters the matter id column on a fragment of the id', () => {
    expect(
      filterMatters(ROWS, params({ view: 'all', ref: 'cccc' }), ME, NOW).map(
        (r) => r.title,
      ),
    ).toEqual(['Borel intake']);
  });

  /**
   * The Ref box has to find a matter by the reference the firm was actually
   * quoted, which is what that column now SHOWS. Matching only the id would
   * make the one filter that exists for references useless for references.
   */
  it('filters the reference column on the matter number the column shows', () => {
    const rows = [
      row({ id: 'aaaa1111-0000-0000-0000-000000000000', title: 'Numbered', matterNumber: 'MAT-0000012' }),
      row({ id: 'bbbb2222-0000-0000-0000-000000000000', title: 'Other', matterNumber: 'MAT-0000013' }),
    ];
    expect(
      filterMatters(rows, params({ view: 'all', ref: 'MAT-0000012' }), ME, NOW).map(
        (r) => r.title,
      ),
    ).toEqual(['Numbered']);
    // Case-insensitively, and on a fragment, like every other column filter.
    expect(
      filterMatters(rows, params({ view: 'all', ref: 'mat-00000' }), ME, NOW),
    ).toHaveLength(2);
  });

  /**
   * And the id still matches. It is what the column showed before references
   * existed, it is still the chip's hover title, and it is what a matter URL
   * pasted into the box contains.
   */
  it('still finds a numbered matter by its id', () => {
    const rows = [
      row({ id: 'aaaa1111-0000-0000-0000-000000000000', title: 'Numbered', matterNumber: 'MAT-0000012' }),
      row({ id: 'bbbb2222-0000-0000-0000-000000000000', title: 'Other', matterNumber: 'MAT-0000013' }),
    ];
    expect(
      filterMatters(rows, params({ view: 'all', ref: 'aaaa1111' }), ME, NOW).map(
        (r) => r.title,
      ),
    ).toEqual(['Numbered']);
  });

  /**
   * An unnumbered matter is still findable by the fragment the column shows
   * for it, so the filter matches the display in both states.
   */
  it('finds an unnumbered matter by the fragment its cell shows', () => {
    const rows = [row({ id: 'cccc3333-0000-0000-0000-000000000000', title: 'No number' })];
    expect(
      filterMatters(rows, params({ view: 'all', ref: 'cccc3333' }), ME, NOW),
    ).toHaveLength(1);
  });

  it('separates a hearing that is set, absent, imminent or past', () => {
    const at = (hearing: MatterListParams['hearing']) =>
      filterMatters(ROWS, params({ view: 'all', hearing }), ME, NOW).map(
        (r) => r.title,
      );
    expect(at('none')).toEqual(['Borel intake']);
    expect(at('set')).toEqual([
      'Zinpro v. Hohag',
      'Acme lease dispute',
      'Delta arbitration',
    ]);
    expect(at('soon')).toEqual(['Zinpro v. Hohag']);
    expect(at('past')).toEqual(['Acme lease dispute']);
  });

  it('separates recently updated matters from stale ones', () => {
    const at = (updated: MatterListParams['updated']) =>
      filterMatters(ROWS, params({ view: 'all', updated }), ME, NOW).map(
        (r) => r.title,
      );
    expect(at('24h')).toEqual(['Zinpro v. Hohag']);
    // Borel was updated 7 days and 3 hours ago, so it falls outside 7d and
    // inside 30d. The bands are exclusive upper bounds, not buckets.
    expect(at('7d')).toEqual(['Zinpro v. Hohag', 'Delta arbitration']);
    expect(at('30d')).toEqual([
      'Zinpro v. Hohag',
      'Borel intake',
      'Delta arbitration',
    ]);
    expect(at('older')).toEqual(['Acme lease dispute']);
  });

  it('searches title, client, matter type and assignee together', () => {
    const at = (q: string) =>
      filterMatters(ROWS, params({ view: 'all', q }), ME, NOW).map((r) => r.title);
    expect(at('hohag')).toEqual(['Zinpro v. Hohag']);
    expect(at('grace')).toEqual(['Acme lease dispute', 'Delta arbitration']);
    expect(at('property')).toEqual(['Acme lease dispute']);
  });

  it('composes the view with the column filters', () => {
    expect(
      filterMatters(ROWS, params({ view: 'open', status: 'closed' }), ME, NOW),
    ).toHaveLength(0);
  });
});

describe('sortMatters', () => {
  const all = (p: Partial<MatterListParams>) =>
    sortMatters(ROWS, params({ view: 'all', ...p })).map((r) => r.title);

  it('sorts the status column along the workflow, not the alphabet', () => {
    expect(all({ sort: 'status', dir: 'asc' })).toEqual([
      'Borel intake',
      'Zinpro v. Hohag',
      'Delta arbitration',
      'Acme lease dispute',
    ]);
  });

  it('keeps rows with no hearing last in both directions', () => {
    expect(all({ sort: 'hearing', dir: 'asc' }).at(-1)).toBe('Borel intake');
    expect(all({ sort: 'hearing', dir: 'desc' }).at(-1)).toBe('Borel intake');
  });

  it('keeps unassigned rows last in both directions', () => {
    expect(all({ sort: 'assignee', dir: 'asc' }).at(-1)).toBe('Borel intake');
    expect(all({ sort: 'assignee', dir: 'desc' }).at(-1)).toBe('Borel intake');
  });

  it('does not mutate the array it was given', () => {
    const before = ROWS.map((r) => r.id);
    sortMatters(ROWS, params({ sort: 'title', dir: 'asc' }));
    expect(ROWS.map((r) => r.id)).toEqual(before);
  });
});

describe('paginateMatters', () => {
  const many: MatterRow[] = Array.from({ length: 7 }, (_, i) =>
    row({ id: `row-${i}` }),
  );

  it('reports the range it is showing, 1-based', () => {
    const p = paginateMatters(many, 2, 3);
    expect(p.rows.map((r) => r.id)).toEqual(['row-3', 'row-4', 'row-5']);
    expect(p).toMatchObject({ total: 7, page: 2, pageCount: 3, from: 4, to: 6 });
  });

  it('clamps a page past the end onto the last page', () => {
    expect(paginateMatters(many, 99, 3)).toMatchObject({ page: 3, from: 7, to: 7 });
  });

  it('reports an empty set as one page showing nothing', () => {
    expect(paginateMatters([], 1, 3)).toMatchObject({
      total: 0,
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
    });
  });
});

describe('the list ships no control without an action behind it', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app', 'counsel', 'cases', 'matters-table.tsx'),
    'utf8',
  );

  /**
   * This product has shipped controls with nothing behind them more
   * than once (a "Revoked" badge with no revoke action, comments
   * describing behaviour that was never wired). The checkbox column is
   * the same shape of risk: it is only defensible while something can
   * act on a selection. So the two are pinned together here. If the
   * bulk reassignment is ever removed, this fails, and the right fix is
   * to remove the checkbox column rather than to delete the test.
   */
  it('keeps the checkbox column and the bulk action together', () => {
    const hasCheckboxes = source.includes("type=\"checkbox\"");
    const hasBulkAction =
      source.includes('Reassign the selected matters to') &&
      source.includes('setCaseAssigneeAction');
    expect(hasCheckboxes).toBe(hasBulkAction);
  });

  /**
   * setCaseStatusAction (lib/actions.ts) writes through the USER-scoped
   * Supabase client, so RLS decides, and `cases_update_own` is
   * `auth.uid() = user_id` while `cases` SELECT is membership-wide. A
   * firm attorney who is not the case row's owner updated zero rows,
   * was told it worked, and had the transition written into the audit
   * chain.
   *
   * There IS an inline status control now, and this is the line it must
   * not cross: it goes through setFirmCaseStatusAction, which authorizes
   * on the firm, writes through the service-role client, and confirms
   * the row before reporting or logging anything. Nothing on the firm
   * side may reach for the consumer mutation instead.
   *
   * The name appears in the module's own comment explaining why, so
   * this looks for a CALL and for the module it would be imported
   * from, not for the word.
   */
  it('does not reach for the consumer status mutation', () => {
    expect(source).not.toMatch(/setCaseStatusAction\s*\(/);
    expect(source).not.toContain("from '@/lib/actions'");
  });
});

describe('hasActiveFilters', () => {
  it('is false for a view on its own and true once anything narrows it', () => {
    expect(hasActiveFilters(params({ view: 'mine' }))).toBe(false);
    expect(hasActiveFilters(params({ ref: 'aaaa' }))).toBe(true);
    expect(hasActiveFilters(params({ hearing: 'soon' }))).toBe(true);
  });
});
