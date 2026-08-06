import { describe, expect, it } from 'vitest';

import {
  ALL_SUBMISSION_STATUSES,
  applySubmissionAction,
  canApproveSubmissions,
  canReadSubmissionDocument,
  canRenderFilledTemplate,
  checkReleasable,
  isEditableBySubmitter,
  isTerminal,
  MAX_DOCUMENT_CHARS,
  reviewDecision,
  reviewEdit,
  type ReleaseCandidate,
  type SubmissionStatus,
} from '../lib/template-approval';
import { rowToSubmission } from '../lib/template-submission-types';

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
    for (const current of ALL_SUBMISSION_STATUSES) {
      if (current === 'pending') continue;
      expect(reviewDecision({ role: 'owner', current, action: 'approve' }).ok).toBe(false);
      expect(reviewDecision({ role: 'owner', current, action: 'decline', note: 'no' }).ok).toBe(
        false,
      );
    }
  });
});

/**
 * Declining and sending back are two different things, and the difference is
 * the whole point. A returned submission is still alive and the employee is
 * expected to act; a declined one is finished and nobody is left waiting.
 */
describe('declining', () => {
  it('is a different terminal state from a return, not a flavour of one', () => {
    const declined = reviewDecision({
      role: 'attorney',
      current: 'pending',
      action: 'decline',
      note: 'We are not signing this counterparty paper.',
    });
    const returned = reviewDecision({
      role: 'attorney',
      current: 'pending',
      action: 'request_changes',
      note: 'The term should be two years.',
    });
    expect(declined).toEqual({ ok: true, status: 'declined' });
    expect(returned).toEqual({ ok: true, status: 'changes_requested' });
    expect(isTerminal('declined')).toBe(true);
    expect(isTerminal('changes_requested')).toBe(false);
  });

  it('refuses to decline without a reason, so nobody is told only "no"', () => {
    expect(
      reviewDecision({ role: 'owner', current: 'pending', action: 'decline', note: '  ' }).ok,
    ).toBe(false);
    expect(reviewDecision({ role: 'owner', current: 'pending', action: 'decline' }).ok).toBe(false);
  });

  it('refuses to decline for a role that may only read', () => {
    for (const role of ['paralegal', 'staff'] as const) {
      expect(
        reviewDecision({ role, current: 'pending', action: 'decline', note: 'no' }).ok,
      ).toBe(false);
    }
    expect(
      reviewDecision({ role: null, current: 'pending', action: 'decline', note: 'no' }).ok,
    ).toBe(false);
  });

  it('ends the submission: it cannot be resubmitted, withdrawn, edited, or sent', () => {
    expect(applySubmissionAction('declined', 'resubmit').ok).toBe(false);
    expect(applySubmissionAction('declined', 'withdraw').ok).toBe(false);
    expect(applySubmissionAction('declined', 'mark_sent').ok).toBe(false);
    expect(isEditableBySubmitter('declined')).toBe(false);
  });

  it('can never be released, however complete the rest of the record is', () => {
    // Everything else on this record is exactly what a releasable one carries:
    // a real approver, a real recipient, a real document. Only the status
    // refuses it.
    expect(checkReleasable(approved({ status: 'declined' })).ok).toBe(false);
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

/**
 * The reviewer's edit. The module used to refuse this outright because the
 * document carries a colleague's signature; it is allowed now on the condition
 * that the employee's own text survives it and the change is attributed.
 */
describe('reviewer edit', () => {
  const edit = (over: Partial<Parameters<typeof reviewEdit>[0]> = {}) =>
    reviewEdit({
      role: 'attorney',
      current: 'pending',
      currentText: 'The term of this agreement is five years.',
      nextText: 'The term of this agreement is two years.',
      hasOriginal: false,
      ...over,
    });

  it('accepts a change from a reviewer while the document is with them', () => {
    expect(edit()).toEqual({
      ok: true,
      documentText: 'The term of this agreement is two years.',
      preserveOriginal: true,
    });
  });

  it('copies the employee original aside once and never again', () => {
    // The first edit preserves what the employee wrote. A second edit must not
    // overwrite that copy with the first reviewer's wording, or the record
    // stops being able to answer what the employee actually submitted.
    const first = edit({ hasOriginal: false });
    const second = edit({ hasOriginal: true, currentText: 'two years' });
    expect(first.ok && first.preserveOriginal).toBe(true);
    expect(second.ok && second.preserveOriginal).toBe(false);
  });

  it('refuses a role that cannot release the document either', () => {
    for (const role of ['paralegal', 'staff'] as const) {
      expect(edit({ role }).ok).toBe(false);
    }
    expect(edit({ role: null }).ok).toBe(false);
    expect(edit({ role: undefined }).ok).toBe(false);
  });

  it('refuses on any status but pending', () => {
    // An approved document has already cleared the gate, so editing it would
    // put unread text on the release path. A returned one is with the employee.
    // The terminal ones are finished.
    for (const current of ALL_SUBMISSION_STATUSES) {
      if (current === 'pending') continue;
      expect(edit({ current }).ok).toBe(false);
    }
  });

  it('refuses an empty document and a change that changes nothing', () => {
    expect(edit({ nextText: '   \n ' }).ok).toBe(false);
    expect(edit({ nextText: 'The term of this agreement is five years.' }).ok).toBe(false);
  });

  it('refuses an over-long document rather than truncating an agreement', () => {
    const res = edit({ nextText: 'x'.repeat(MAX_DOCUMENT_CHARS + 1) });
    expect(res.ok).toBe(false);
    expect(edit({ nextText: 'x'.repeat(MAX_DOCUMENT_CHARS) }).ok).toBe(true);
  });
});

/**
 * The gate covers the artifact, not one button. A finished PDF of a gated
 * template must not reach the employee's browser at all, because a file in
 * their hands is a file they can forward.
 */
describe('rendering a filled template', () => {
  it('renders a template legal cleared for self-service, for anyone', () => {
    expect(canRenderFilledTemplate({ requiresApproval: false, role: null }).ok).toBe(true);
  });

  it('refuses a gated template for an employee and for a read-only role', () => {
    expect(canRenderFilledTemplate({ requiresApproval: true, role: null }).ok).toBe(false);
    expect(canRenderFilledTemplate({ requiresApproval: true, role: 'paralegal' }).ok).toBe(false);
    expect(canRenderFilledTemplate({ requiresApproval: true, role: 'staff' }).ok).toBe(false);
  });

  it('renders a gated template for the roles that could release it anyway', () => {
    for (const role of ['owner', 'admin', 'attorney'] as const) {
      expect(canRenderFilledTemplate({ requiresApproval: true, role }).ok).toBe(true);
    }
  });

  it('explains itself without blaming the person who asked', () => {
    const res = canRenderFilledTemplate({ requiresApproval: true, role: null });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('legal team');
      expect(res.reason).not.toMatch(/denied|forbidden|not allowed|cannot/i);
    }
  });
});

/**
 * Reading the wording is the other half of the gate.
 *
 * Withholding the render while leaving the read open is not a gate: a firm
 * member who cannot release a document could read it in full on the approvals
 * screen, copy it, and post it to the branded PDF route as free text, which
 * that route accepts from any member because the letter and template studios
 * legitimately need it. Narrowing the read closes that without taking free-text
 * drafting away from anybody.
 */
describe('who may read the wording of a submission', () => {
  const at = (status: SubmissionStatus) => status;

  it('always shows the colleague who filled it in their own words', () => {
    for (const status of ALL_SUBMISSION_STATUSES) {
      expect(canReadSubmissionDocument({ role: null, isSubmitter: true, status })).toBe(true);
    }
  });

  it('always shows it to the roles that decide on it', () => {
    for (const role of ['owner', 'admin', 'attorney'] as const) {
      for (const status of ALL_SUBMISSION_STATUSES) {
        expect(canReadSubmissionDocument({ role, isSubmitter: false, status })).toBe(true);
      }
    }
  });

  it('withholds a document the firm has not agreed to send from everyone else', () => {
    for (const role of ['paralegal', 'staff'] as const) {
      for (const status of ['pending', 'changes_requested', 'withdrawn', 'declined'] as const) {
        expect(canReadSubmissionDocument({ role, isSubmitter: false, status })).toBe(false);
      }
    }
  });

  it('opens it to the whole firm once the decision has been taken to send it', () => {
    for (const role of ['paralegal', 'staff'] as const) {
      expect(canReadSubmissionDocument({ role, isSubmitter: false, status: at('approved') })).toBe(
        true,
      );
      expect(canReadSubmissionDocument({ role, isSubmitter: false, status: at('sent') })).toBe(
        true,
      );
    }
  });

  it('shows nothing to someone outside the firm who did not file it', () => {
    for (const status of ALL_SUBMISSION_STATUSES) {
      expect(canReadSubmissionDocument({ role: null, isSubmitter: false, status })).toBe(false);
    }
  });
});

/**
 * The rule above decides; rowToSubmission carries the decision out. A caller
 * that forgets to ask the rule is the failure this default is for, and which
 * way it falls is the whole of the protection: withholding shows an empty panel
 * to someone who was entitled to read, which is visible and harmless, while
 * releasing hands the full document to someone who was not.
 */
describe('the shape a caller gets when it does not say', () => {
  const row = {
    id: 'sub-1',
    firm_id: 'firm-1',
    template_id: 'tpl-1',
    template_name: 'Mutual NDA',
    submitted_by: 'employee-1',
    submitter_name: null,
    submitter_email: null,
    recipient_name: null,
    recipient_email: 'other.side@example.com',
    recipient_note: null,
    field_values: null,
    signature_name: 'A Colleague',
    document_text: 'MUTUAL NON-DISCLOSURE AGREEMENT ...',
    status: 'pending' as SubmissionStatus,
    revision: 1,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    original_document_text: 'The version the employee submitted ...',
    edited_by: null,
    edited_at: null,
    edit_note: null,
    released_at: null,
    release_token: null,
    release_error: null,
    created_at: '2026-08-06T10:00:00.000Z',
    updated_at: '2026-08-06T10:00:00.000Z',
    submitted_at: '2026-08-06T10:00:00.000Z',
  };

  it('withholds the document when the caller did not say to show it', () => {
    const s = rowToSubmission(row);
    expect(s.documentVisible).toBe(false);
    expect(s.documentText).toBe('');
    expect(s.originalDocumentText).toBeNull();
    // Everything that is not the wording is still there, so a caller that
    // forgets loses the document and not the record.
    expect(s.recipientEmail).toBe('other.side@example.com');
    expect(s.status).toBe('pending');
    expect(s.revision).toBe(1);
  });

  it('shows it only when the caller asks', () => {
    const s = rowToSubmission(row, () => null, true);
    expect(s.documentVisible).toBe(true);
    expect(s.documentText).toBe(row.document_text);
    expect(s.originalDocumentText).toBe(row.original_document_text);
  });
});
