/**
 * The Matters strip states the size of the list it would show.
 *
 * The same defect as the approvals queue, in the same shape: the strip was
 * built in the component from `rows.filter(viewTest(key, meId))` while the
 * table was built from `filterMatters(rows, params, meId)`, which also applies
 * the search box and the six column filters. Search for a client nobody
 * matches and "Open work 12" sat over "No matters match this view and these
 * filters."
 *
 * A count and the list it labels are one expression, so matterViewCounts calls
 * filterMatters itself, once per view, on one clock.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  VIEW_KEYS,
  filterMatters,
  matterViewCounts,
  type MatterListParams,
  type MatterRow,
} from '@/lib/matter-list';

const NOW = Date.parse('2026-08-10T12:00:00Z');
const ME = '11111111-1111-1111-1111-111111111111';

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
  row({ id: 'aaaa1111-0000-0000-0000-000000000000', title: 'Zinpro v. Hohag', assignedTo: ME }),
  row({ id: 'bbbb2222-0000-0000-0000-000000000000', title: 'Acme lease', subjectName: 'Acme' }),
  row({ id: 'cccc3333-0000-0000-0000-000000000000', title: 'Closed thing', status: 'closed' }),
  row({
    id: 'dddd4444-0000-0000-0000-000000000000',
    title: 'Hearing soon',
    hearingAt: '2026-08-20T09:00:00Z',
  }),
];

function params(over: Partial<MatterListParams> = {}): MatterListParams {
  return {
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
    ...over,
  };
}

describe('every Matters view count is the size of the list that view renders', () => {
  it('holds with no search and no filters', () => {
    const counts = matterViewCounts(ROWS, params(), ME, NOW);
    for (const view of VIEW_KEYS) {
      expect(counts[view]).toBe(filterMatters(ROWS, params({ view }), ME, NOW).length);
    }
  });

  it('holds when the search matches nothing, which is where it used to break', () => {
    const p = params({ q: 'no-client-called-this' });
    const counts = matterViewCounts(ROWS, p, ME, NOW);
    for (const view of VIEW_KEYS) {
      expect(counts[view]).toBe(filterMatters(ROWS, { ...p, view }, ME, NOW).length);
      expect(counts[view]).toBe(0);
    }
  });

  it('holds under a column filter, not only the search box', () => {
    const p = params({ status: 'closed' });
    const counts = matterViewCounts(ROWS, p, ME, NOW);
    for (const view of VIEW_KEYS) {
      expect(counts[view]).toBe(filterMatters(ROWS, { ...p, view }, ME, NOW).length);
    }
    // Real narrowing, so the assertion above is not comparing two zeroes: one
    // closed matter exists and the default view excludes it.
    expect(counts.all).toBe(1);
    expect(counts.open).toBe(0);
  });

  it('holds when the search matches some of them', () => {
    const p = params({ view: 'all', q: 'acme' });
    const counts = matterViewCounts(ROWS, p, ME, NOW);
    expect(counts.all).toBe(1);
    expect(counts.all).toBe(filterMatters(ROWS, p, ME, NOW).length);
  });
});

describe('the matters table states no figure it works out for itself', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/counsel/cases/matters-table.tsx'),
    'utf8',
  );

  it('builds the strip from matterViewCounts, not from its own filter', () => {
    expect(source).toContain('matterViewCounts');
    expect(source).not.toMatch(/rows\s*\.filter\([^)]*\)\s*\.length/);
    expect(source).not.toContain('viewTest');
  });
});
