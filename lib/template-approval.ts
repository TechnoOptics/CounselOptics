import type { FirmRole } from './firm-types';
import { FIRM_MANAGE_ROLES } from './firm-authz';

/**
 * The approval gate for employee template submissions, as pure rules.
 *
 * An employee fills a firm template (an NDA, a vendor form), names the outside
 * recipient, and submits. The document does NOT go to the recipient: it goes
 * to the legal team. Only after an approval by someone holding a role that may
 * release a document to an outside party does it leave the building.
 *
 * Every rule that decides "may this go out?" lives here, in one module with no
 * I/O, so the gate can be read in full and tested in full. The server actions
 * and the release helper are thin: they resolve the caller's real firm role
 * and the stored record, then ask these functions. There is no second copy of
 * the gate anywhere, and no path to release that does not run checkReleasable.
 */

export type SubmissionStatus =
  /** Waiting on the legal team. The employee cannot change it here. */
  | 'pending'
  /** Legal sent it back with a reason. The employee can fix and resubmit. */
  | 'changes_requested'
  /** Cleared for release. Nothing else clears a document for release. */
  | 'approved'
  /** Delivered to the recipient. Terminal. */
  | 'sent'
  /** The employee pulled it back before a decision. Terminal. */
  | 'withdrawn';

export const ALL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'pending',
  'changes_requested',
  'approved',
  'sent',
  'withdrawn',
];

export type SubmissionAction = 'resubmit' | 'withdraw' | 'mark_sent';

export type TransitionResult =
  | { ok: true; status: SubmissionStatus }
  | { ok: false; error: string };

/**
 * Who may release a document to an outside party: owner, admin, attorney.
 * Paralegal and staff can read a submission but cannot let it out, which is
 * why this reads FIRM_MANAGE_ROLES rather than keeping its own list.
 */
export function canApproveSubmissions(role: FirmRole | null | undefined): boolean {
  return role != null && FIRM_MANAGE_ROLES.includes(role);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The legal team's decision on a submission that is awaiting review.
 * Role and transition are checked together so a caller cannot perform one
 * without the other.
 */
export function reviewDecision(input: {
  role: FirmRole | null | undefined;
  current: SubmissionStatus;
  action: 'approve' | 'request_changes';
  note?: string | null;
}): TransitionResult {
  if (!canApproveSubmissions(input.role)) {
    return { ok: false, error: 'Your role cannot approve documents for release.' };
  }
  if (input.current !== 'pending') {
    return { ok: false, error: 'This submission is not awaiting review.' };
  }
  if (input.action === 'approve') return { ok: true, status: 'approved' };
  if (!(input.note ?? '').trim()) {
    return { ok: false, error: 'Add a short note so your colleague knows what to change.' };
  }
  return { ok: true, status: 'changes_requested' };
}

/** Transitions that are not a legal-team decision. */
export function applySubmissionAction(
  current: SubmissionStatus,
  action: SubmissionAction,
): TransitionResult {
  if (action === 'resubmit') {
    return current === 'changes_requested'
      ? { ok: true, status: 'pending' }
      : { ok: false, error: 'Only a submission that was sent back can be resubmitted.' };
  }
  if (action === 'withdraw') {
    return current === 'pending' || current === 'changes_requested'
      ? { ok: true, status: 'withdrawn' }
      : { ok: false, error: 'This submission can no longer be withdrawn.' };
  }
  // mark_sent: the record of a delivery that has just happened. Reachable
  // from 'approved' and from nothing else.
  return current === 'approved'
    ? { ok: true, status: 'sent' }
    : { ok: false, error: 'Only an approved submission can be sent to the recipient.' };
}

/** The employee may edit their own submission only after it comes back. */
export function isEditableBySubmitter(status: SubmissionStatus): boolean {
  return status === 'changes_requested';
}

/** True while the legal team still owes a decision. */
export function isAwaitingReview(status: SubmissionStatus): boolean {
  return status === 'pending';
}

export type ReleaseCandidate = {
  status: SubmissionStatus;
  /** The user id of the approver, written by the approval itself. */
  decidedBy: string | null;
  decidedAt: string | null;
  recipientEmail: string | null;
  documentText: string | null;
  releasedAt?: string | null;
};

/**
 * The last gate before a document leaves for an outside party. The release
 * helper re-reads the stored record and calls this; a record that is not
 * approved, or that is approved with no approver recorded, is refused. A
 * caller cannot pass the gate by leaving a field out: every field it needs is
 * required to be present and well-formed.
 */
export function checkReleasable(
  record: ReleaseCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (record.status !== 'approved') {
    return { ok: false, reason: 'This document has not been approved for release.' };
  }
  if (!record.decidedBy || !record.decidedAt) {
    return { ok: false, reason: 'This document carries no record of who approved it.' };
  }
  if (record.releasedAt) {
    return { ok: false, reason: 'This document has already been sent.' };
  }
  if (!record.recipientEmail || !EMAIL_RE.test(record.recipientEmail)) {
    return { ok: false, reason: 'This submission has no valid recipient address.' };
  }
  if (!(record.documentText ?? '').trim()) {
    return { ok: false, reason: 'This submission has no document to send.' };
  }
  return { ok: true };
}
