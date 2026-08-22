import { describe, expect, it } from 'vitest';

import {
  AGING_DAYS,
  QUEUE_VIEW_KEYS,
  approvalQueueHref,
  confirmationLines,
  isBulkSelectable,
  matchesQuery,
  parseApprovalQueueParams,
  queueViewTest,
  selectHistory,
  selectQueue,
  toApprovalRow,
  type ApprovalRow,
} from '../lib/approval-queue';
import type { TemplateSubmission } from '../lib/template-submission-types';

/**
 * The approvals queue's state, as rules.
 *
 * Two things here are not ordinary list plumbing and are the reason this file
 * exists. The row the client holds must not carry the wording of a document
 * the firm has not agreed to send, and a bulk action's confirmation must name
 * every document and every outside recipient rather than count them. Both are
 * safety properties of a screen whose main verb puts confidential material
 * outside a company, so both are asserted about behaviour rather than about
 * how the component is spelled.
 */

const NOW = Date.parse('2026-08-09T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function row(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'sub-1',
    ticketNumber: 'REQ-0000001',
    templateName: 'Mutual NDA',
    category: 'NDA',
    submitterName: 'Dana Okafor',
    submitterEmail: 'dana@firm.test',
    recipientName: 'Acme Ltd',
    recipientEmail: 'legal@acme.test',
    status: 'pending',
    revision: 1,
    submittedAt: new Date(NOW - HOUR).toISOString(),
    decidedAt: null,
    releaseError: null,
    direction: 'outbound',
    href: '/counsel/forms/approvals/sub-1',
    ...over,
  };
}

describe('the row the queue hands a client component', () => {
  it('does not carry the wording of an unreleased document', () => {
    const submission = {
      id: 'sub-1',
      firmId: 'firm-1',
      templateId: 'tpl-1',
      templateName: 'Mutual NDA',
      submittedBy: 'employee-1',
      submitterName: 'Dana Okafor',
      submitterEmail: 'dana@firm.test',
      recipientName: 'Acme Ltd',
      recipientEmail: 'legal@acme.test',
      recipientNote: null,
      fieldValues: {},
      signatureName: 'Dana Okafor',
      documentText: 'Neither party may disclose the terms of this agreement.',
      documentVisible: true,
      status: 'pending',
      revision: 1,
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      decisionNote: null,
      originalDocumentText: 'the employee original',
      editedBy: null,
      editedByName: null,
      editedAt: null,
      editNote: null,
      releasedAt: null,
      releaseError: null,
      submittedAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      signatureImagePath: null,
      signatureMode: null,
      signatureCapturedAt: null,
      signatureIntentAt: null,
      signedDocumentSha256: null,
      category: 'NDA',
      ticketNumber: 'REQ-0000001',
    } satisfies TemplateSubmission;

    const narrowed = toApprovalRow(submission);
    // Not "is empty": the field must not be on the object at all, because the
    // whole point is that the shape the browser receives cannot hold it.
    const serialized = JSON.stringify(narrowed);
    expect(serialized).not.toContain('Neither party may disclose');
    expect(serialized).not.toContain('the employee original');
    expect(Object.keys(narrowed)).not.toContain('documentText');
    expect(Object.keys(narrowed)).not.toContain('originalDocumentText');
    // The facts a queue needs to say what a thing is survive the narrowing.
    expect(narrowed.templateName).toBe('Mutual NDA');
    expect(narrowed.recipientEmail).toBe('legal@acme.test');
    expect(narrowed.ticketNumber).toBe('REQ-0000001');
  });
});

describe('every view is a real subset with a real count', () => {
  const rows: ApprovalRow[] = [
    row({ id: 'fresh', status: 'pending', submittedAt: new Date(NOW - HOUR).toISOString() }),
    row({ id: 'old', status: 'pending', submittedAt: new Date(NOW - 5 * DAY).toISOString() }),
    row({ id: 'stuck', status: 'approved', releaseError: 'The email bounced.' }),
    row({ id: 'clean', status: 'approved', releaseError: null }),
    row({ id: 'back', status: 'changes_requested' }),
    row({ id: 'gone', status: 'sent' }),
    row({ id: 'dropped', status: 'declined' }),
    row({ id: 'pulled', status: 'withdrawn' }),
  ];

  it('selects exactly what its name says', () => {
    const ids = (view: (typeof QUEUE_VIEW_KEYS)[number]) =>
      rows.filter(queueViewTest(view, NOW)).map((r) => r.id);

    expect(ids('waiting')).toEqual(['fresh', 'old']);
    expect(ids('aging')).toEqual(['old']);
    expect(ids('failed')).toEqual(['stuck']);
    expect(ids('open')).toEqual(['fresh', 'old', 'stuck', 'clean', 'back']);
  });

  it('counts what the card then renders, from the same predicate', () => {
    for (const view of QUEUE_VIEW_KEYS) {
      const count = rows.filter(queueViewTest(view, NOW)).length;
      const rendered = selectQueue(rows, { view, q: '', sort: 'oldest', dir: 'all' }, NOW);
      expect(rendered).toHaveLength(count);
    }
  });

  it('calls a document aging only once it has waited the stated time', () => {
    const justUnder = row({ submittedAt: new Date(NOW - (AGING_DAYS * DAY - HOUR)).toISOString() });
    const justOver = row({ submittedAt: new Date(NOW - (AGING_DAYS * DAY + HOUR)).toISOString() });
    expect(queueViewTest('aging', NOW)(justUnder)).toBe(false);
    expect(queueViewTest('aging', NOW)(justOver)).toBe(true);
  });

  it('keeps the history card to documents that are finished', () => {
    const settled = selectHistory(rows, { view: 'waiting', q: '', sort: 'oldest', dir: 'all' }).map((r) => r.id);
    expect(settled).toEqual(['gone', 'dropped', 'pulled']);
  });
});

describe('search', () => {
  const r = row();

  it('matches everything printed on the row and the reference beside it', () => {
    for (const needle of ['nda', 'Dana', 'dana@firm.test', 'acme', 'REQ-0000001', 'Acme Ltd']) {
      expect(matchesQuery(r, needle)).toBe(true);
    }
  });

  it('does not match something the row does not say', () => {
    expect(matchesQuery(r, 'zzz-not-here')).toBe(false);
  });

  it('reaches the history card as well as the queue', () => {
    const rows = [row({ id: 'a', status: 'sent' }), row({ id: 'b', status: 'sent', templateName: 'Vendor form', category: null, recipientName: null, recipientEmail: 'ops@other.test', submitterName: 'Sam' })];
    const found = selectHistory(rows, { view: 'waiting', q: 'vendor', sort: 'oldest', dir: 'all' });
    expect(found.map((x) => x.id)).toEqual(['b']);
  });
});

describe('order', () => {
  it('puts whatever has waited longest at the top by default', () => {
    const rows = [
      row({ id: 'new', submittedAt: new Date(NOW - HOUR).toISOString() }),
      row({ id: 'old', submittedAt: new Date(NOW - 6 * DAY).toISOString() }),
      row({ id: 'mid', submittedAt: new Date(NOW - 2 * DAY).toISOString() }),
    ];
    expect(selectQueue(rows, { view: 'waiting', q: '', sort: 'oldest', dir: 'all' }, NOW).map((r) => r.id)).toEqual([
      'old',
      'mid',
      'new',
    ]);
    expect(selectQueue(rows, { view: 'waiting', q: '', sort: 'newest', dir: 'all' }, NOW).map((r) => r.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });
});

describe('the query string', () => {
  it('reads back what it writes', () => {
    const params = parseApprovalQueueParams({ view: 'failed', q: 'acme', sort: 'newest', dir: 'all' });
    expect(params).toEqual({ view: 'failed', q: 'acme', sort: 'newest', dir: 'all' });
    expect(approvalQueueHref(params, {})).toBe(
      '/counsel/forms/approvals?view=failed&q=acme&sort=newest',
    );
  });

  it('lands on the waiting queue for anything it does not recognise', () => {
    expect(
      parseApprovalQueueParams({ view: 'nonsense', sort: 'sideways', dir: 'crabwise' }),
    ).toEqual({
      view: 'waiting',
      q: '',
      sort: 'oldest',
      dir: 'all',
    });
    expect(approvalQueueHref({ view: 'waiting', q: '', sort: 'oldest', dir: 'all' }, {})).toBe(
      '/counsel/forms/approvals',
    );
  });
});

describe('what a bulk action may touch', () => {
  it('is only a document that is still awaiting a decision', () => {
    expect(isBulkSelectable(row({ status: 'pending' }))).toBe(true);
    for (const status of ['approved', 'changes_requested', 'sent', 'withdrawn', 'declined'] as const) {
      expect(isBulkSelectable(row({ status }))).toBe(false);
    }
  });
});

describe("a bulk action's confirmation", () => {
  const rows = [
    row({ id: 'a', ticketNumber: 'REQ-0000001', templateName: 'Mutual NDA', recipientName: 'Acme Ltd', recipientEmail: 'legal@acme.test' }),
    row({ id: 'b', ticketNumber: 'REQ-0000002', templateName: 'Vendor form', recipientName: null, recipientEmail: 'ops@beta.test' }),
    row({ id: 'c', ticketNumber: null, templateName: 'Referral letter', recipientName: 'Gamma GmbH', recipientEmail: 'kanzlei@gamma.test' }),
  ];

  it('names every recipient, not a count', () => {
    const lines = confirmationLines(rows);
    expect(lines).toHaveLength(rows.length);
    // Every outside address the selection covers appears in the confirmation.
    for (const r of rows) {
      expect(lines.join('\n')).toContain(r.recipientEmail);
    }
  });

  it('names the document beside each recipient, so a line can be checked', () => {
    const lines = confirmationLines(rows);
    expect(lines[0]).toContain('REQ-0000001');
    expect(lines[0]).toContain('Mutual NDA');
    expect(lines[0]).toContain('Acme Ltd (legal@acme.test)');
    expect(lines[1]).toContain('ops@beta.test');
    // A record with no number of its own still has something to be called.
    expect(lines[2]).toContain('Referral letter');
    expect(lines[2]).toContain('kanzlei@gamma.test');
  });

  it('grows with the selection rather than summarising it', () => {
    expect(confirmationLines(rows.slice(0, 1))).toHaveLength(1);
    expect(confirmationLines([...rows, ...rows])).toHaveLength(6);
  });
});
