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
  | 'withdrawn'
  /**
   * Legal decided this document is not going out. Terminal, and distinct from
   * 'changes_requested': a returned submission is still alive and the employee
   * is expected to fix it, whereas this one is finished. Nothing reopens it,
   * nothing resubmits it, and checkReleasable refuses it like every other
   * non-approved status.
   */
  | 'declined';

export const ALL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'pending',
  'changes_requested',
  'approved',
  'sent',
  'withdrawn',
  'declined',
];

export type SubmissionAction = 'resubmit' | 'withdraw' | 'mark_sent';

/**
 * The three outcomes a reviewer has.
 *
 * 'request_changes' and 'decline' are deliberately not one action. The first
 * hands the document back to the employee with something to do; the second
 * ends it. Collapsing them would leave an employee waiting to be told what to
 * change on a document nobody intends to send.
 */
export type ReviewAction = 'approve' | 'request_changes' | 'decline';

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

/**
 * Whether this reader may see the exact wording of a submission.
 *
 * Reading is the other half of the release gate, and it was the half that was
 * open. The branded PDF route lets any firm member render free text under the
 * firm's letterhead, which is a legitimate counsel feature and not something to
 * take away from a paralegal. But a member who cannot release could read a
 * waiting document in full on the approvals screen, copy it, and post it back
 * through that route to get the same finished, branded file the gate exists to
 * withhold. Narrowing the render would have broken the studios; narrowing the
 * read closes the loop and breaks nothing.
 *
 * So: the colleague who filled it in always reads it, because it is their own
 * words and their own signature. The people who can decide on it always read
 * it, because that is the decision. Every other firm member reads it once the
 * firm has actually agreed to send it, and not before: 'pending' and
 * 'changes_requested' are still under review, and 'withdrawn' and 'declined'
 * are documents the firm decided not to send at all.
 */
export function canReadSubmissionDocument(input: {
  role: FirmRole | null | undefined;
  isSubmitter: boolean;
  status: SubmissionStatus;
}): boolean {
  if (input.isSubmitter) return true;
  if (canApproveSubmissions(input.role)) return true;
  if (input.role == null) return false;
  return input.status === 'approved' || input.status === 'sent';
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
  action: ReviewAction;
  note?: string | null;
}): TransitionResult {
  if (!canApproveSubmissions(input.role)) {
    return { ok: false, error: 'Your role cannot approve documents for release.' };
  }
  if (input.current !== 'pending') {
    return { ok: false, error: 'This submission is not awaiting review.' };
  }
  if (input.action === 'approve') return { ok: true, status: 'approved' };
  const note = (input.note ?? '').trim();
  if (input.action === 'decline') {
    // A reason is required here for the same purpose it is required on a
    // return, but with more weight: this is the last thing the employee will
    // hear about a document they filled in and expected to go out.
    if (!note) {
      return { ok: false, error: 'Add a short reason so your colleague knows where this landed.' };
    }
    return { ok: true, status: 'declined' };
  }
  if (!note) {
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

/** A decision has been taken and nothing further will happen on its own. */
export function isTerminal(status: SubmissionStatus): boolean {
  return status === 'sent' || status === 'withdrawn' || status === 'declined';
}

/**
 * The longest document the reviewer may save. Over this the edit is refused
 * rather than truncated: silently cutting the end off an agreement is a worse
 * outcome than making someone shorten it themselves.
 */
export const MAX_DOCUMENT_CHARS = 100_000;

export type EditResult =
  | {
      ok: true;
      documentText: string;
      /**
       * True on the first edit of a submission, when the employee's own text
       * has to be copied aside before it is replaced. Later edits leave that
       * copy alone, so the preserved original is always what the employee
       * actually wrote and never a previous reviewer's wording.
       */
      preserveOriginal: boolean;
    }
  | { ok: false; error: string };

/**
 * The reviewer's edit of a document that is waiting on them.
 *
 * This module used to refuse edits outright, and the reason was sound: the
 * document carries a colleague's typed signature, so counsel rewriting it in
 * place would put counsel's words out under the employee's name with nothing
 * on the record to say so. The answer is provenance, not refusal. Every edit
 * copies the employee's original aside on the way through, stamps who changed
 * it and when, and the employee is told, so the released document is
 * traceably the edited one and the submitted one is still readable next to it.
 *
 * Only from 'pending'. An approved document has already cleared the gate, so
 * editing it would put unreviewed text on the release path; a returned one is
 * with the employee and editing it would race their resubmission; the terminal
 * states are finished.
 */
export function reviewEdit(input: {
  role: FirmRole | null | undefined;
  current: SubmissionStatus;
  /**
   * The text the reviewer's own page rendered, NOT the text the server has
   * just read. Those differ for as long as the reviewer had the document open,
   * which is minutes, and comparing against the freshly read row would call an
   * edit a change when it is really an overwrite of a colleague's edit made in
   * the meantime.
   */
  currentText: string;
  nextText: string;
  /** Whether the employee's original has already been copied aside. */
  hasOriginal: boolean;
}): EditResult {
  if (!canApproveSubmissions(input.role)) {
    return { ok: false, error: 'Your role cannot change a document before it goes out.' };
  }
  if (input.current !== 'pending') {
    return { ok: false, error: 'This submission is not awaiting review.' };
  }
  const next = input.nextText ?? '';
  if (!next.trim()) {
    return { ok: false, error: 'The document cannot be left empty.' };
  }
  if (next.length > MAX_DOCUMENT_CHARS) {
    return { ok: false, error: 'This document is too long to save. Shorten it and try again.' };
  }
  if (next === input.currentText) {
    return { ok: false, error: 'Nothing has changed in this document.' };
  }
  return { ok: true, documentText: next, preserveOriginal: !input.hasOriginal };
}

/**
 * Whether a filled template may be rendered as a finished PDF for this caller.
 *
 * The approval gate is about the artifact, not about one button. A template
 * the legal team marked for review must not come back out of the PDF renderer
 * into the employee's browser either, because a file in their hands is a file
 * they can forward, and that is the send this gate exists to stop. So the same
 * rule that decides who may release a document decides who may render one.
 */
export function canRenderFilledTemplate(input: {
  requiresApproval: boolean;
  role: FirmRole | null | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.requiresApproval) return { ok: true };
  if (canApproveSubmissions(input.role)) return { ok: true };
  return {
    ok: false,
    reason:
      'This form goes to your legal team before it can be sent. Fill it in and send it for review, and they will deliver it once it is approved.',
  };
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
