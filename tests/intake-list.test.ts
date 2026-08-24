/**
 * The request queue's query state: what a URL means, and what it selects.
 *
 * The counsel inbox used to be four lane groups of cards over a read capped
 * at 200 rows, with each lane heading stating the length of the slice it had
 * been handed. This module is the list pattern instead, and it is pure so the
 * whole of it is testable with no DOM.
 *
 * Every view here is a set a request can ACTUALLY be in, drawn from the
 * vocabulary the product already has: the nine workflow states, the
 * `assigned_to` column, and the four priorities. Nothing is widened. The
 * reference this list was modelled on offers VIP, SLA at risk and Escalations,
 * and none of the three has a fact behind it here.
 */

import { describe, expect, it } from 'vitest';

import {
  INTAKE_LIST_VIEW_KEYS,
  filterIntakes,
  hasActiveIntakeFilters,
  intakeListHref,
  intakeListQuery,
  intakeViewCounts,
  parseIntakeListParams,
  sortIntakes,
  type IntakeListParams,
  type IntakeListRow,
  type IntakeListViewKey,
} from '@/lib/intake-list';
import {
  DECIDED_WORKFLOW_STATES,
  INTAKE_WORKFLOW_STATES,
  type IntakeWorkflowState,
} from '@/lib/intake-workflow';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function row(over: Partial<IntakeListRow> & { id: string }): IntakeListRow {
  return {
    reference: 'REQ-0000001',
    subject: 'A request',
    matterType: 'Employment',
    jurisdiction: 'CO',
    folder: '',
    requesterName: 'Someone',
    inHouse: true,
    signatureDirection: null,
    priority: 'Normal',
    state: 'open',
    assignedTo: null,
    assigneeLabel: null,
    createdAt: '2026-08-10T09:00:00Z',
    updatedAt: '2026-08-10T09:00:00Z',
    ...over,
  };
}

const ROWS: IntakeListRow[] = [
  row({ id: 'a', subject: 'Contractor NDA for Denver', state: 'new', priority: 'Urgent' }),
  row({ id: 'b', subject: 'Vendor MSA review', state: 'open', assignedTo: ME, assigneeLabel: 'Me' }),
  row({
    id: 'c',
    subject: 'Reseller agreement',
    state: 'awaiting_external_party',
    assignedTo: OTHER,
    assigneeLabel: 'Other',
  }),
  row({ id: 'd', subject: 'Old thing', state: 'closed' }),
  row({ id: 'e', subject: 'Outside enquiry', inHouse: false, requesterName: 'Acme Corp', state: 'completed' }),
];

function params(over: Partial<IntakeListParams> = {}): IntakeListParams {
  return {
    view: 'open',
    q: '',
    ref: '',
    subject: '',
    requester: '',
    state: '',
    owner: '',
    source: '',
    priority: '',
    sort: 'priority',
    dir: 'desc',
    page: 1,
    ...over,
  };
}

const ids = (rows: IntakeListRow[]) => rows.map((r) => r.id);

describe('the views are sets a request can actually be in', () => {
  it('offers seven, the same shape as the reference and none of its words', () => {
    expect(INTAKE_LIST_VIEW_KEYS).toEqual([
      'open',
      'new',
      'mine',
      'unassigned',
      'waiting',
      'urgent',
      'all',
    ]);
  });

  it('calls a request open when the legal team is not finished with it', () => {
    // The nine, not the seven-value lane test. A queue that measured "open"
    // by the legacy status would hide a CONVERTED request that is still
    // waiting on somebody's signature, which is live work.
    const open = filterIntakes(ROWS, params({ view: 'open' }), ME);
    expect(ids(open)).toEqual(['a', 'b', 'c']);
  });

  it('places every one of the nine states on the right side of that line', () => {
    for (const state of INTAKE_WORKFLOW_STATES) {
      const only = [row({ id: state, state })];
      const shown = filterIntakes(only, params({ view: 'open' }), ME).length;
      const decided = DECIDED_WORKFLOW_STATES.includes(state);
      expect(shown, `state ${state}`).toBe(decided ? 0 : 1);
    }
  });

  it('shows only what is assigned to the signed-in member under Mine', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'mine' }), ME))).toEqual(['b']);
  });

  it('matches nothing rather than everything when there is no signed-in member', () => {
    // A "Mine" that showed the whole firm's queue would be a lie. The caller
    // drops the option in that case; this is the belt to that braces.
    expect(filterIntakes(ROWS, params({ view: 'mine' }), null)).toHaveLength(0);
  });

  /**
   * CHANGED 2026-08-24. This asserted that Unassigned counted decided requests
   * too, and it gave no reason, alone among the tests around it.
   *
   * A real workspace showed why that was wrong. The inbox offered "All open 4"
   * and "Unassigned 7" beside each other over the same seven rows, because
   * three had just been closed. Unassigned is a queue of work nobody has picked
   * up. A closed request with no owner is not waiting for an owner; it is
   * finished, and nobody is going to pick it up.
   *
   * Everything is the lane that still shows finished work, and it is named so
   * that nobody has to guess.
   */
  it('counts only live unowned requests under Unassigned', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'unassigned' }), ME))).toEqual(['a']);
  });

  it('still finds a decided unowned request under Everything', () => {
    const all = ids(filterIntakes(ROWS, params({ view: 'all' }), ME));
    expect(all).toContain('d');
    expect(all).toContain('e');
  });

  it('collects the three waiting states under Awaiting others', () => {
    const waiting = INTAKE_WORKFLOW_STATES.filter((s) => s.startsWith('awaiting_'));
    expect(waiting).toHaveLength(3);
    for (const state of waiting) {
      const only = [row({ id: state, state })];
      expect(filterIntakes(only, params({ view: 'waiting' }), ME), state).toHaveLength(1);
    }
    // And nothing else is in it, which is what stops the view from becoming a
    // second name for "open".
    expect(ids(filterIntakes(ROWS, params({ view: 'waiting' }), ME))).toEqual(['c']);
  });

  it('means exactly the top priority under Urgent, not a mood', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'urgent' }), ME))).toEqual(['a']);
    const high = [row({ id: 'h', priority: 'High' })];
    expect(filterIntakes(high, params({ view: 'urgent' }), ME)).toHaveLength(0);
  });

  it('shows everything under Everything, decided requests included', () => {
    expect(filterIntakes(ROWS, params({ view: 'all' }), ME)).toHaveLength(ROWS.length);
  });
});

describe('the column filters narrow what the view selected', () => {
  it('filters by source, which is where the old Employees and External tabs went', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'all', source: 'external' }), ME))).toEqual(['e']);
    expect(
      filterIntakes(ROWS, params({ view: 'all', source: 'inhouse' }), ME),
    ).toHaveLength(4);
  });

  it('filters by one of the nine states', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'all', state: 'new' }), ME))).toEqual(['a']);
  });

  it('filters by owner, including the two pseudo-values', () => {
    expect(ids(filterIntakes(ROWS, params({ view: 'all', owner: 'me' }), ME))).toEqual(['b']);
    expect(ids(filterIntakes(ROWS, params({ view: 'all', owner: OTHER }), ME))).toEqual(['c']);
    expect(
      filterIntakes(ROWS, params({ view: 'all', owner: 'unassigned' }), ME),
    ).toHaveLength(3);
  });

  it('searches the subject, the requester, the reference and the owner', () => {
    const hit = (q: string) => ids(filterIntakes(ROWS, params({ view: 'all', q }), ME));
    expect(hit('denver')).toEqual(['a']);
    expect(hit('acme')).toEqual(['e']);
    expect(hit('req-0000001')).toHaveLength(ROWS.length);
    expect(hit('other')).toEqual(['c']);
    expect(hit('nothing-matches-this')).toEqual([]);
  });

  it('matches the reference case-insensitively in its own column', () => {
    const rows = [row({ id: 'x', reference: 'ZIN-4471' })];
    expect(filterIntakes(rows, params({ view: 'all', ref: 'zin' }), ME)).toHaveLength(1);
  });
});

describe('sorting a queue', () => {
  it('opens with the most urgent first, which is what a triage queue is for', () => {
    const p = params({ view: 'all' });
    expect(p.sort).toBe('priority');
    const sorted = sortIntakes(filterIntakes(ROWS, p, ME), p);
    expect(sorted[0].id).toBe('a');
  });

  it('ranks the four priorities by urgency and not alphabetically', () => {
    const rows = (['Low', 'Urgent', 'Normal', 'High'] as const).map((priority) =>
      row({ id: priority, priority }),
    );
    const p = params({ view: 'all', sort: 'priority', dir: 'desc' });
    expect(ids(sortIntakes(rows, p))).toEqual(['Urgent', 'High', 'Normal', 'Low']);
  });

  it('walks the pipeline when sorting by state, in the order a request travels', () => {
    const rows = ['closed', 'new', 'awaiting_employee'].map((s) =>
      row({ id: s, state: s as IntakeWorkflowState }),
    );
    const p = params({ view: 'all', sort: 'state', dir: 'asc' });
    expect(ids(sortIntakes(rows, p))).toEqual(['new', 'awaiting_employee', 'closed']);
  });

  it('sorts an unowned request last in both directions', () => {
    // An absent value is not an early one. Flipping the column should not
    // parade the requests that have nobody on them.
    const rows = [row({ id: 'none' }), row({ id: 'has', assigneeLabel: 'Ada', assignedTo: ME })];
    for (const dir of ['asc', 'desc'] as const) {
      const p = params({ view: 'all', sort: 'owner', dir });
      expect(ids(sortIntakes(rows, p)).at(-1), dir).toBe('none');
    }
  });

  it('sorts by age from the arrival time, oldest first when ascending', () => {
    const rows = [
      row({ id: 'young', createdAt: '2026-08-16T09:00:00Z' }),
      row({ id: 'old', createdAt: '2026-01-02T09:00:00Z' }),
    ];
    const p = params({ view: 'all', sort: 'age', dir: 'asc' });
    expect(ids(sortIntakes(rows, p))).toEqual(['old', 'young']);
  });
});

describe('the URL is the list', () => {
  it('omits everything left at its default', () => {
    expect(intakeListQuery(params())).toBe('');
  });

  it('round-trips every field it writes', () => {
    const p = params({
      view: 'waiting',
      q: 'nda',
      ref: 'REQ-1',
      subject: 'vendor',
      requester: 'ada',
      state: 'signed',
      owner: 'me',
      source: 'external',
      priority: 'High',
      sort: 'age',
      dir: 'asc',
      page: 3,
    });
    const qs = intakeListQuery(p);
    const back = parseIntakeListParams(Object.fromEntries(new URLSearchParams(qs)), ME);
    expect(back).toEqual(p);
  });

  it('falls back rather than erroring on a hand-edited URL', () => {
    const p = parseIntakeListParams(
      { view: 'nope', state: 'not_a_state', priority: 'SUPER', sort: 'colour', page: '-4' },
      ME,
    );
    expect(p.view).toBe('open');
    expect(p.state).toBe('');
    expect(p.priority).toBe('');
    expect(p.sort).toBe('priority');
    expect(p.page).toBe(1);
  });

  it('degrades ?view=mine to the default view with no signed-in member', () => {
    expect(parseIntakeListParams({ view: 'mine' }, null).view).toBe('open');
    expect(parseIntakeListParams({ view: 'mine' }, ME).view).toBe('mine');
  });

  it('honours the two views this list used to have as a source filter', () => {
    // /counsel/inbox?view=external is a link a colleague may already have
    // been sent. It meant "outside traffic only", which is now a column
    // filter, so it keeps meaning that rather than silently resetting.
    const ext = parseIntakeListParams({ view: 'external' }, ME);
    expect(ext.source).toBe('external');
    expect(ext.view).toBe('open');
    const int = parseIntakeListParams({ view: 'internal' }, ME);
    expect(int.source).toBe('inhouse');
    expect(int.view).toBe('open');
  });

  it('returns to page one on any change other than the page itself', () => {
    const p = params({ page: 4 });
    expect(intakeListHref(p, { state: 'signed' })).not.toContain('page=');
    expect(intakeListHref(p, { page: 5 })).toContain('page=5');
  });

  it('writes links back to the route it was given', () => {
    expect(intakeListHref(params(), { view: 'all' }, '/counsel/inbox')).toBe(
      '/counsel/inbox?view=all',
    );
  });

  it('knows when something narrows the set beyond the chosen view', () => {
    expect(hasActiveIntakeFilters(params())).toBe(false);
    expect(hasActiveIntakeFilters(params({ source: 'external' }))).toBe(true);
    expect(hasActiveIntakeFilters(params({ q: 'nda' }))).toBe(true);
    // The view is not a filter: it is what the tabs are for, and offering to
    // "clear" it would offer to clear the tab you are standing on.
    expect(hasActiveIntakeFilters(params({ view: 'urgent' }))).toBe(false);
  });
});

describe('every tab states the size of the list that tab would render', () => {
  const check = (p: IntakeListParams, meId: string | null) => {
    const counts = intakeViewCounts(ROWS, p, meId);
    for (const view of INTAKE_LIST_VIEW_KEYS) {
      expect(counts[view], view).toBe(filterIntakes(ROWS, { ...p, view }, meId).length);
    }
    return counts;
  };

  it('holds with no search and no filters', () => {
    const counts = check(params(), ME);
    // Real numbers, so the assertion above is not comparing zeroes.
    expect(counts.all).toBe(5);
    expect(counts.open).toBe(3);
  });

  it('holds when the search matches nothing, which is where this always breaks', () => {
    const counts = check(params({ q: 'no-such-request' }), ME);
    for (const view of INTAKE_LIST_VIEW_KEYS) expect(counts[view]).toBe(0);
  });

  it('holds under a column filter, not only the search box', () => {
    const counts = check(params({ source: 'external' }), ME);
    expect(counts.all).toBe(1);
    expect(counts.open).toBe(0);
  });

  it('holds with no signed-in member, when Mine selects nothing', () => {
    expect(check(params(), null).mine).toBe(0);
  });
});

describe('the view keys and the labels cannot drift apart', () => {
  it('has a label for every key and no label for a key that does not exist', async () => {
    const { INTAKE_LIST_VIEW_LABEL } = await import('@/lib/intake-list');
    const labelled = Object.keys(INTAKE_LIST_VIEW_LABEL) as IntakeListViewKey[];
    expect(labelled.sort()).toEqual([...INTAKE_LIST_VIEW_KEYS].sort());
  });
});
