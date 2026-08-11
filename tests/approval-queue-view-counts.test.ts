/**
 * The strip's counts and the list under them are one expression.
 *
 * The defect this pins: /counsel/forms/approvals rendered its view strip from
 * `rows.filter(queueViewTest(key))` while the card underneath rendered
 * `selectQueue(rows, params)`. selectQueue applies the search as well as the
 * view, so the moment a reviewer typed anything the strip went on stating a
 * number the list did not have. "Awaiting decision · 3" over "Nothing matches
 * that search." was the reported symptom, and neither number was a bug on its
 * own: they were two expressions that agreed only while the search box was
 * empty.
 *
 * tests/approval-queue.test.ts already asserted the two agree, but it passed
 * `q: ''` to selectQueue and filtered with the bare predicate, so it compared
 * the two expressions only on the input where they cannot differ. That is why
 * it was green. Every case below carries a live search.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  QUEUE_VIEW_KEYS,
  queueViewCounts,
  selectQueue,
  type ApprovalQueueParams,
  type ApprovalRow,
} from '@/lib/approval-queue';

const NOW = Date.parse('2026-03-10T12:00:00.000Z');
const DAY = 86_400_000;

const row = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: 'sub-1',
  ticketNumber: null,
  templateName: 'Mutual NDA',
  category: 'nda',
  submitterName: 'Dana Reed',
  submitterEmail: 'dana@firm.test',
  recipientName: 'Acme Legal',
  recipientEmail: 'legal@acme.test',
  status: 'pending',
  revision: 1,
  submittedAt: new Date(NOW - DAY).toISOString(),
  decidedAt: null,
  releaseError: null,
  ...over,
});

const rows: ApprovalRow[] = [
  row({ id: 'fresh', status: 'pending' }),
  row({ id: 'old', status: 'pending', submittedAt: new Date(NOW - 5 * DAY).toISOString() }),
  row({ id: 'stuck', status: 'approved', releaseError: 'The email bounced.' }),
  row({ id: 'clean', status: 'approved', releaseError: null }),
  row({ id: 'back', status: 'changes_requested' }),
  row({ id: 'gone', status: 'sent' }),
];

const params = (over: Partial<ApprovalQueueParams> = {}): ApprovalQueueParams => ({
  view: 'waiting',
  q: '',
  sort: 'oldest',
  ...over,
});

describe('the count on a view is the length of the list that view renders', () => {
  it('holds when nothing is searched for', () => {
    const counts = queueViewCounts(rows, params(), NOW);
    for (const view of QUEUE_VIEW_KEYS) {
      expect(counts[view]).toBe(selectQueue(rows, params({ view }), NOW).length);
    }
  });

  it('holds when the search matches nothing, which is where it used to break', () => {
    const p = params({ q: 'nothing-on-any-of-these' });
    const counts = queueViewCounts(rows, p, NOW);
    for (const view of QUEUE_VIEW_KEYS) {
      expect(counts[view]).toBe(selectQueue(rows, { ...p, view }, NOW).length);
      // The reported symptom in its exact form: a number over an empty card.
      expect(counts[view]).toBe(0);
    }
  });

  it('holds when the search matches some of them', () => {
    const p = params({ q: 'acme' });
    const narrowed = rows.map((r, i) =>
      i % 2 === 0 ? r : { ...r, recipientEmail: 'legal@other.test', recipientName: 'Other' },
    );
    const counts = queueViewCounts(narrowed, p, NOW);
    for (const view of QUEUE_VIEW_KEYS) {
      expect(counts[view]).toBe(selectQueue(narrowed, { ...p, view }, NOW).length);
    }
    // And it is actually narrowing something, so the assertion above is not
    // comparing two zeroes.
    expect(counts.open).toBeGreaterThan(0);
    expect(counts.open).toBeLessThan(
      selectQueue(narrowed, params({ view: 'open' }), NOW).length,
    );
  });

  it('reads one clock, so the aging count cannot drift from the aging list', () => {
    // queueViewCounts takes `now` rather than calling Date.now() per view, so
    // a render that straddles the three-day boundary cannot count a row into
    // aging that the list then leaves out.
    const edge = NOW;
    const counts = queueViewCounts(rows, params({ view: 'aging' }), edge);
    expect(counts.aging).toBe(selectQueue(rows, params({ view: 'aging' }), edge).length);
  });
});

describe('the queue component states no figure it works out for itself', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/counsel/ApprovalsQueue.tsx'),
    'utf8',
  );

  it('builds the strip from queueViewCounts, not from its own filter', () => {
    expect(source).toContain('queueViewCounts');
    // The shape of the defect: counting a filtered copy of `rows` in the
    // component, which is a second expression by construction.
    expect(source).not.toMatch(/rows\s*\.filter\([^)]*\)\s*\.length/);
    expect(source).not.toContain('queueViewTest');
  });
});
