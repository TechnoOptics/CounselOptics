import { checkReleasable, type ReleaseCandidate } from './template-approval';
import { isUnknownColumnError } from './signer-view';

/**
 * Which of the two deliveries an approved template submission takes, as pure
 * rules.
 *
 * Two halves of one workflow existed side by side and nothing joined them. A
 * template submission was approved and mailed as a read-only encrypted share,
 * and it never collected a signature; /sign/[token] collected a signature and
 * it never passed through review. A template now says which of the two its
 * output takes, and this module is the whole of that decision.
 *
 * It does NOT re-implement the release gate. checkReleasable
 * (lib/template-approval.ts) is still the one rule that decides whether an
 * approved document may leave the building, and checkDispatchable calls it and
 * adds exactly one clause on top. A second copy of the status, approver,
 * recipient and document checks would be a second gate, and the copy that ran
 * first would quietly become the real one.
 */

export type DeliveryMode =
  /** A read-only encrypted share. What every template does today. */
  | 'share'
  /** Sent for signature through the existing /sign/[token] ceremony. */
  | 'signature';

/**
 * Read the stored column.
 *
 * Anything unrecognised becomes 'share'. That is the fail-safe direction and
 * it is the same one sanitizeFields (lib/firm-templates.ts) takes for an
 * unknown field type. It also carries the whole of the unmigrated case: until
 * the owner applies 20260807_flow_join.sql the column is absent, every read of
 * it is undefined, and every template behaves exactly as it does today.
 *
 * Deliberately not case-folded and not trimmed. The values are written by this
 * codebase against a CHECK constraint, so a differently-spelled value did not
 * come from us, and guessing what it meant is how a document goes out down a
 * path the firm never chose.
 */
export function parseDeliveryMode(value: unknown): DeliveryMode {
  return value === 'signature' ? 'signature' : 'share';
}

/** Everything the release gate reads, plus what the mode decision needs. */
export type DispatchCandidate = ReleaseCandidate & {
  /** The template's delivery_mode, straight off the row. */
  deliveryMode: unknown;
  /** The rendered PDF, once it has been filed. */
  documentId: string | null;
  /** The signature request this approval dispatched, once it exists. */
  signingRequestId: string | null;
};

export type DispatchDecision =
  | { ok: true; mode: DeliveryMode }
  | { ok: false; reason: string };

/**
 * The gate in front of both deliveries.
 *
 * The shared refusals are checkReleasable's, returned with its own wording so
 * an approver reads one vocabulary whichever mode their template is in. On top
 * of them sits one clause the signature mode has alone: a submission that
 * already carries a signing request has been dispatched, and dispatching it
 * again would produce a second executed PDF and a second audit chain for a
 * single instrument.
 *
 * A document id is deliberately NOT a refusal. The PDF is filed before the
 * signing request is created, so a run that stored the document and then lost
 * the network must stay retryable; materializeSubmissionDocument is idempotent
 * for exactly that reason and hands the same document back.
 */
export function checkDispatchable(record: DispatchCandidate): DispatchDecision {
  const gate = checkReleasable(record);
  if (!gate.ok) return gate;
  const mode = parseDeliveryMode(record.deliveryMode);
  if (mode === 'signature' && record.signingRequestId) {
    return { ok: false, reason: 'This document has already been sent for signature.' };
  }
  return { ok: true, mode };
}

export type DeliveryModeColumnFallback =
  /** Save without the column. Only when the author chose 'share'. */
  | 'retry-without-column'
  /** Do not save. The author chose 'signature' and it cannot be recorded. */
  | 'abort-mode-unsaved'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/** The wording for the abort, kept beside the decision that causes it. */
export const DELIVERY_MODE_UNSAVED_ERROR =
  'This template was not saved. Sending for signature needs a database ' +
  'update that has not been applied yet, so saving now would leave the ' +
  'template sending a read-only link instead. Ask your administrator to ' +
  'apply the pending update, or save it as a secure link for now.';

/**
 * What to do when a template write carrying `delivery_mode` fails.
 *
 * The column arrives with a migration the owner applies, so between merge and
 * apply, and in the window right after it runs while PostgREST still holds a
 * stale schema cache, the write comes back with the column unknown. This is
 * the same shape as resolveDownloadColumnFallback (lib/signer-view.ts) and for
 * the same reason: retrying without the column is right in one direction only.
 *
 * 'share' is what an absent column reads as, so the retry lands on exactly the
 * behaviour the author chose and nothing is lost.
 *
 * 'signature' is not. Dropping it would store a template that reads as a
 * read-only share while the legal team believes it asks for a signature, and
 * they would find that out when a counterparty received a document with
 * nowhere to sign. Nothing about that is recoverable after the fact, so this
 * refuses and says why.
 */
export function resolveDeliveryModeColumnFallback(input: {
  deliveryMode: DeliveryMode;
  error: { code?: string | null; message?: string | null } | null | undefined;
}): DeliveryModeColumnFallback {
  if (!isUnknownColumnError(input.error, 'delivery_mode')) return 'surface-error';
  return input.deliveryMode === 'signature' ? 'abort-mode-unsaved' : 'retry-without-column';
}
