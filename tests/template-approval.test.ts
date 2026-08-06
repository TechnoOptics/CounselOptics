import { describe, expect, it } from 'vitest';

import {
  ALL_SUBMISSION_STATUSES,
  applySubmissionAction,
  canApproveSubmissions,
  checkReleasable,
  isEditableBySubmitter,
  reviewDecision,
  type ReleaseCandidate,
  type SubmissionStatus,
} from '../lib/template-approval';

/**
 * The employee template approval gate. An employee fills a firm template,
 * names an outside recipient, and submits: the document must reach that
 * recipient ONLY after someone on the legal team with the right role approves
 * it. These tests pin the whole state machine, and above all that no path
 * reaches release without an approval on the record.
 */

const approved = (over: Partial<ReleaseCandidate> = {}): ReleaseCandidate => ({
  status: 'approved',
  decidedBy: 'user-attorney',
  decidedAt: '2026-08-06T10:00:00.000Z',
  recipientEmail: 'counterparty@example.com',
  documentText: 'MUTUAL NON-DISCLOSURE AGREEMENT ...',
  releasedAt: null,
  ...over,
});

describe('who may approve', () => {
  it('lets owner, admin, and attorney approve', () => {
    expect(canApproveSubmissions('owner')).toBe(true);
    expect(canApproveSubmissions('admin')).toBe(true);
    expect(canApproveSubmissions('attorney')).toBe(true);
  });

  it('does not let paralegal or staff release a document to an outside party', () => {
    expect(canApproveSubmissions('paralegal')).toBe(false);
    expect(canApproveSubmissions('staff')).toBe(false);
  });

  it('denies a caller with no firm role', () => {
    expect(canApproveSubmissions(null)).toBe(false);
    expect(canApproveSubmissions(undefined)).toBe(false);
  });
});

describe('review decision', () => {
  it('approves a pending submission for an approver', () => {
    const res = reviewDecision({ role: 'attorney', current: 'pending', action: 'approve' });
    expect(res).toEqual({ ok: true, status: 'approved' });
  });

  it('refuses to approve for a role that may only read', () => {
    const res = reviewDecision({ role: 'paralegal', current: 'pending', action: 'approve' });
    expect(res.ok).toBe(false);
  });

  it('refuses to send a submission back without a reason', () => {
    const res = reviewDecision({ role: 'owner', current: 'pending', action: 'request_changes', note: '  ' });
    expect(res.ok).toBe(false);
  });

  it('sends a submission back when a reason is given', () => {
    const res = reviewDecision({
      role: 'owner',
      current: 'pending',
      action: 'request_changes',
      note: 'The term should be two years, not five.',
    });
    expect(res).toEqual({ ok: true, status: 'changes_requested' });
  });

  it('refuses a decision on anything that is not awaiting review', () => {
    for (const current of ['approved', 'sent', 'changes_requested', 'withdrawn'] as SubmissionStatus[]) {
      expect(reviewDecision({ role: 'owner', current, action: 'approve' }).ok).toBe(false);
    }
  });
});

describe('employee transitions', () => {
  it('lets a returned submission be fixed and resubmitted', () => {
    expect(isEditableBySubmitter('changes_requested')).toBe(true);
    expect(applySubmissionAction('changes_requested', 'resubmit')).toEqual({ ok: true, status: 'pending' });
  });

  it('does not let a submission under review be edited or resubmitted', () => {
    expect(isEditableBySubmitter('pending')).toBe(false);
    expect(applySubmissionAction('pending', 'resubmit').ok).toBe(false);
  });

  it('does not let an approved or sent submission be edited', () => {
    expect(isEditableBySubmitter('approved')).toBe(false);
    expect(isEditableBySubmitter('sent')).toBe(false);
    expect(applySubmissionAction('approved', 'resubmit').ok).toBe(false);
    expect(applySubmissionAction('sent', 'resubmit').ok).toBe(false);
  });

  it('lets the submitter withdraw before it is approved', () => {
    expect(applySubmissionAction('pending', 'withdraw')).toEqual({ ok: true, status: 'withdrawn' });
    expect(applySubmissionAction('changes_requested', 'withdraw')).toEqual({ ok: true, status: 'withdrawn' });
    expect(applySubmissionAction('approved', 'withdraw').ok).toBe(false);
    expect(applySubmissionAction('sent', 'withdraw').ok).toBe(false);
  });
});

describe('release to the recipient', () => {
  it('marks an approved submission as sent', () => {
    expect(applySubmissionAction('approved', 'mark_sent')).toEqual({ ok: true, status: 'sent' });
  });

  it('never reaches sent from any status other than approved', () => {
    for (const current of ALL_SUBMISSION_STATUSES) {
      if (current === 'approved') continue;
      expect(applySubmissionAction(current, 'mark_sent').ok).toBe(false);
    }
  });

  it('releases only an approved record', () => {
    for (const status of ALL_SUBMISSION_STATUSES) {
      const res = checkReleasable(approved({ status }));
      expect(res.ok).toBe(status === 'approved');
    }
  });

  it('refuses a record marked approved that carries no approver', () => {
    expect(checkReleasable(approved({ decidedBy: null })).ok).toBe(false);
    expect(checkReleasable(approved({ decidedAt: null })).ok).toBe(false);
  });

  it('refuses a record with nothing to send or nobody to send it to', () => {
    expect(checkReleasable(approved({ recipientEmail: null })).ok).toBe(false);
    expect(checkReleasable(approved({ recipientEmail: 'not-an-email' })).ok).toBe(false);
    expect(checkReleasable(approved({ documentText: '   ' })).ok).toBe(false);
  });

  it('refuses to send the same approval twice', () => {
    expect(checkReleasable(approved({ releasedAt: '2026-08-06T11:00:00.000Z' })).ok).toBe(false);
  });

  it('releases a complete approved record', () => {
    expect(checkReleasable(approved())).toEqual({ ok: true });
  });
});
