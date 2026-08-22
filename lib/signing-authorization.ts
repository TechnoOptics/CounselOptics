/**
 * Which way a signing request runs, and whether the firm has authorised
 * putting its name on somebody else's document. Pure rules, no I/O.
 *
 * THE TWO DIRECTIONS, AND WHY THE SECOND NEEDED A GATE OF ITS OWN.
 *
 * OUTBOUND is every signing request this product has ever created. The firm's
 * own document goes out and an outside party signs it. The firm's decision
 * happens BEFORE the document leaves, on the approvals queue in
 * lib/template-approval.ts, and by the time a signer link exists the decision
 * is already made. Nothing here gates it, because gating it twice would be
 * two places to keep in step.
 *
 * INBOUND is the other one. A counterparty sends their document and asks the
 * firm to sign it. Nothing of the firm's is being released, so the outbound
 * gate never fires, and yet this is the direction where the firm actually
 * becomes bound. The link is minted as usual and must not open until somebody
 * who may bind the firm has said so.
 *
 * WHO MAY SAY SO IS NOT DECIDED HERE. It is canApproveSubmissions in
 * lib/template-approval.ts, unchanged, and this module does not import a role
 * list, does not take a role, and has no opinion about one. The people who may
 * let the firm's document out are the people who may let the firm's name onto
 * somebody else's; a second list for the second direction is how the two would
 * drift apart, and drifting apart on this question means a paralegal binding
 * the firm on paper nobody read.
 *
 * WHERE IT IS STORED. `firm_signing_requests.direction` and
 * `.authorization_status`, added by
 * supabase/migrations/20260822_signing_request_direction.sql, which is NOT
 * applied. Everything below is written for a reader that may meet the columns
 * absent, present and null, or carrying a value nobody here has heard of.
 *
 * This module is distinct from lib/intake-signature-direction.ts on purpose.
 * That one reads a QUESTION the person filing answered, on the intake, where
 * "not a signature question" is a real third answer and null must stay null.
 * This one reads a FACT about a request that exists, where there is no third
 * possibility and null is one of the two. Merging them would force one of the
 * two null readings to be wrong.
 *
 * Nothing here touches a database or React, so all of it is exercised by
 * tests/signing-authorization.test.ts.
 */

/** The columns, named once so no caller spells them. */
export const DIRECTION_COLUMN = 'direction';
export const AUTHORIZATION_STATUS_COLUMN = 'authorization_status';

export type SigningDirection = 'outbound' | 'inbound';

export type AuthorizationStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'declined';

/**
 * Which way this request runs.
 *
 * Absent, null, empty, a typo, a value some future writer invents: all of
 * them are 'outbound', which is what every row written before the migration
 * is and what the ordinary case will go on being. There is no null return,
 * because a caller holding a null would have to decide again.
 */
export function readSigningDirection(raw: unknown): SigningDirection {
  return raw === 'inbound' ? 'inbound' : 'outbound';
}

/** Whether this is the counterparty's document, waiting on the firm. */
export function isInboundRequest(raw: unknown): boolean {
  return readSigningDirection(raw) === 'inbound';
}

/**
 * The authorisation on this request.
 *
 * Anything unrecognised reads 'not_required', which sounds permissive and is
 * not, because nothing consults this value on its own. resolveSignerGate
 * below refuses an INBOUND request on anything that is not exactly
 * 'approved', 'not_required' included. So an absent column on an inbound row
 * closes the gate rather than opening it, and an absent column on an outbound
 * row says the true thing about a request that never needed one.
 *
 * That is the whole reason the column is NOT NULL with a default in the
 * migration while `direction` is nullable: the permissive reading is only
 * ever safe because the gate never trusts it alone.
 */
export function readAuthorizationStatus(raw: unknown): AuthorizationStatus {
  return raw === 'pending' || raw === 'approved' || raw === 'declined'
    ? raw
    : 'not_required';
}

export type SignerGate =
  | { ok: true }
  | { ok: false; reason: string; heading: string };

/**
 * What the copy says when a signer link is opened on a document the firm has
 * not authorised yet.
 *
 * The person reading this is the firm's own signatory, not the counterparty,
 * and they have followed a link that works. So it says the document is fine
 * and the timing is not, and it does not ask them to do anything, because
 * there is nothing they can do and inventing a step would send them chasing
 * the wrong people.
 */
export const SIGNER_AWAITING_AUTHORIZATION_HEADING = 'Not ready to sign yet';
export const SIGNER_AWAITING_AUTHORIZATION_REASON =
  'Your legal team is still reading this document. The link will work once ' +
  'they have authorised it, and there is nothing you need to do until then.';

export const SIGNER_AUTHORIZATION_DECLINED_HEADING = 'This one is not being signed';
export const SIGNER_AUTHORIZATION_DECLINED_REASON =
  'Your legal team is not signing this document as it is written. Nothing ' +
  'has been sent back to the other party, and your legal team can tell you ' +
  'what would need to change.';

/**
 * Whether a signer link may open.
 *
 * THE ONE DECISION, and it is enforced at app/sign/[token]/page.tsx before
 * anything is rendered, not inside a component the page draws. A page that
 * renders a gate is not a gate: the RSC payload carries what the page held
 * whether or not it drew it, and the document bytes are served by a separate
 * route that has to make the same decision for itself.
 *
 * An outbound request passes, always, whatever its authorization_status says.
 * That is deliberate rather than an oversight: an outbound request has already
 * been through the approvals queue, and consulting a second column on it would
 * mean a stray 'pending' written by some future path could silently stop
 * signatures the firm already approved.
 *
 * An inbound request passes on 'approved' and on nothing else.
 */
export function resolveSignerGate(input: {
  direction: unknown;
  authorizationStatus: unknown;
}): SignerGate {
  if (!isInboundRequest(input.direction)) return { ok: true };
  const status = readAuthorizationStatus(input.authorizationStatus);
  if (status === 'approved') return { ok: true };
  if (status === 'declined') {
    return {
      ok: false,
      heading: SIGNER_AUTHORIZATION_DECLINED_HEADING,
      reason: SIGNER_AUTHORIZATION_DECLINED_REASON,
    };
  }
  return {
    ok: false,
    heading: SIGNER_AWAITING_AUTHORIZATION_HEADING,
    reason: SIGNER_AWAITING_AUTHORIZATION_REASON,
  };
}

// ============================================================================
// The legal team's panel
// ============================================================================

/** The heading over the authorisation panel on the counsel surface. */
export const INBOUND_AUTHORIZE_HEADING = 'Authorise this signature';

/**
 * The two sentences under it.
 *
 * The first states the position: it is their paper, unchanged, and the only
 * thing this product added is a place to sign. A reviewer who does not know
 * that will read the document wondering what the firm did to it.
 *
 * The second states the two outcomes plainly and names the second one as
 * sending it back with a note, not as a rejection, because the note is the
 * part that does any good.
 *
 * A function rather than a template in the component so both sentences are
 * testable and so the two names are interpolated in one place.
 */
export function inboundAuthorizeBody(input: {
  counterparty: string | null | undefined;
  signatoryName: string | null | undefined;
}): string[] {
  const other = (input.counterparty ?? '').trim() || 'The other party';
  const who = (input.signatoryName ?? '').trim() || 'the named signatory';
  return [
    `${other} sent this and has asked us to sign it. It is their document and ` +
      'nothing in it has been changed, so the only thing added is the signature line.',
    `Approving lets ${who} sign it. If it should not be signed as it stands, ` +
      'send it back with a note saying what would need to change.',
  ];
}

// ============================================================================
// The employee's surface
// ============================================================================

/**
 * What the colleague who filed the request reads, per authorisation state.
 *
 * Worded the way components/portal/SubmissionStatusPill.tsx words the other
 * direction, and for the same reason: this is a colleague in difficulty
 * reading about a legal document, and a label is the shortest thing on the
 * page and the most often read. So 'declined' is "Not being signed as
 * written", which is about the document, and never "Rejected", which sounds
 * like it is about them.
 *
 * 'not_required' has no label at all. Every outbound request carries it and
 * an outbound request is not waiting on an authorisation, so a pill saying
 * "not required" would put a word about a gate onto every document that has
 * nothing to do with one.
 */
export const INBOUND_STATUS_LABEL: Record<
  Exclude<AuthorizationStatus, 'not_required'> | 'signed',
  string
> = {
  pending: 'With legal to review',
  approved: 'Approved to sign',
  signed: 'Signed and returned',
  declined: 'Not being signed as written',
};

/**
 * The state an employee's row is in, which is the authorisation plus the one
 * fact the authorisation cannot carry: whether it has actually been signed.
 *
 * 'signed' outranks 'approved' because an approved-and-signed document is
 * finished and a reader told "Approved to sign" would go looking for
 * something to do.
 */
export type InboundEmployeeState = keyof typeof INBOUND_STATUS_LABEL;

export function inboundEmployeeState(input: {
  authorizationStatus: unknown;
  signedAt: string | null | undefined;
}): InboundEmployeeState {
  if (input.signedAt) return 'signed';
  const status = readAuthorizationStatus(input.authorizationStatus);
  return status === 'not_required' ? 'pending' : status;
}

/** The label for that state. */
export function inboundEmployeeLabel(state: InboundEmployeeState): string {
  return INBOUND_STATUS_LABEL[state];
}

/**
 * The sentence under the label.
 *
 * Each one says what has happened, what has not, and whether anything is
 * being asked of the reader. The waiting one and the declined one both end by
 * saying nothing has been sent back to the other party, because the fear a
 * person has while a document they handed over sits with legal is that
 * something went out in their name.
 *
 * NOTE, AND IT IS THE POINT OF THIS WHOLE MODULE'S EMPLOYEE HALF: none of
 * these carries `authorization_note`. That note is the legal team's working
 * reasoning on a document, written for colleagues who may bind the firm, and
 * it is not the employee's to read. Only the decision is. The boundary is
 * enforced at the query rather than here, in the SELECT list on
 * app/portal/[id]/page.tsx, and held there by
 * tests/employee-payload-scope.test.ts, because a value the page holds is a
 * value the browser was handed whether or not the page drew it.
 */
export function inboundEmployeeMessage(
  state: InboundEmployeeState,
  counterparty: string | null | undefined,
): string {
  const other = (counterparty ?? '').trim() || 'the other party';
  if (state === 'signed') {
    return (
      'Your legal team has signed this. The signed copy is below, and the ' +
      `version ${other} sent is kept beside it.`
    );
  }
  if (state === 'declined') {
    return (
      'Your legal team is not signing this as it is written. There is a note ' +
      'below on what would need to change first. Nothing has been sent back.'
    );
  }
  if (state === 'approved') {
    return (
      'Your legal team has authorised this and it is ready to be signed. ' +
      'Nothing has been sent back to ' +
      `${other} yet.`
    );
  }
  return (
    `Your legal team is reading the document ${other} sent. Nothing has been ` +
    'signed, and there is nothing you need to do while it is with them.'
  );
}

// ============================================================================
// The unapplied-column fallback
// ============================================================================

export type SigningDirectionColumnFallback =
  /**
   * Write again without the direction columns. Only for an outbound
   * request, which never names them in the first place, so this is the
   * branch that exists for the window right after the migration runs while
   * PostgREST still holds a stale schema cache.
   */
  | 'retry-without-columns'
  /** Do not write. An inbound request cannot be recorded as gated. */
  | 'abort-authorization-unsaved'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/** The wording for the abort, kept beside the decision that causes it. */
export const INBOUND_AUTHORIZATION_UNSAVED_ERROR =
  'This document was not sent for signature. Holding it for your legal ' +
  'team to authorise needs a database update that has not been applied yet, ' +
  'and sending it now would create a working signing link on the other ' +
  'party document with nobody having authorised it. Ask your administrator ' +
  'to apply the pending update, then try again.';

/**
 * What to do when a write carrying the direction columns fails.
 *
 * The same shape as resolveDeliveryModeColumnFallback in
 * lib/submission-dispatch.ts and resolveSignatureMethodsColumnFallback beside
 * it, with the same narrow scope: only a missing column is handled, so a
 * permission or constraint failure still surfaces untouched.
 *
 * The asymmetry is the ordinary one this time. 'outbound' is exactly what an
 * absent column reads as, so a retry lands on the behaviour the caller chose
 * and nothing is lost. 'inbound' is not: dropping it would create a request
 * that reads as outbound and is therefore ungated, with a live signer link,
 * on a counterparty's document, and the firm would find out when it was
 * already bound. That is the gate deleting itself in order to get a row
 * written, so it refuses and says why.
 */
export function resolveSigningDirectionColumnFallback(input: {
  direction: SigningDirection;
  error: { code?: string | null; message?: string | null } | null | undefined;
  /**
   * The repo's predicate, passed in rather than imported so this module
   * imports nothing. The caller passes isUnknownColumnError from
   * lib/signer-view.ts.
   */
  isUnknownColumn: (
    error: { code?: string | null; message?: string | null } | null | undefined,
    column: string,
  ) => boolean;
}): SigningDirectionColumnFallback {
  const missing =
    input.isUnknownColumn(input.error, DIRECTION_COLUMN) ||
    input.isUnknownColumn(input.error, AUTHORIZATION_STATUS_COLUMN);
  if (!missing) return 'surface-error';
  return input.direction === 'inbound'
    ? 'abort-authorization-unsaved'
    : 'retry-without-columns';
}
