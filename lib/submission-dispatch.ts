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

/**
 * The mode a submission is actually delivered under.
 *
 * THE MODE AND THE WORDS HAVE TO AGREE. document_text is merged once, at
 * submit time, and the counterparty signature block inside it is put there by
 * counterpartyLabel (lib/firm-template-placeholders.ts), which returns null
 * for any mode but 'signature'. So the text is not mode-neutral: it either
 * carries a block for the other side or it does not.
 *
 * The template's own mode is not that answer. A template can be flipped while
 * an approved submission sits in the queue, and reading the mode at dispatch
 * then delivers share-merged words down the signature path, where a
 * counterparty is asked to sign an instrument that names only the employee, or
 * signature-merged words down the share path, which is the marker leak
 * lib/template-release.ts describes.
 *
 * Re-merging at dispatch is NOT the alternative. It would change the document
 * after the reviewer approved it, and materializeSubmissionDocument renders
 * the stored text rather than re-merging for exactly that reason. So the
 * submission records the mode it was merged under and that recording wins.
 *
 * The template is the fallback and stays the fallback. A row filed before the
 * column existed carries nothing, as does every row on a database that has not
 * had 20260807_flow_join.sql applied, and the template's mode is then the only
 * answer there is, which is precisely today's behaviour.
 */
export function resolveDispatchMode(input: {
  /** firm_template_submissions.delivery_mode, straight off the row. */
  submissionMode: unknown;
  /** The template's own delivery_mode, read at dispatch. */
  templateMode: unknown;
}): DeliveryMode {
  if (input.submissionMode === 'share' || input.submissionMode === 'signature') {
    return parseDeliveryMode(input.submissionMode);
  }
  return parseDeliveryMode(input.templateMode);
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

export type SignatureMethodsColumnFallback =
  /** Write again without the column. Nothing the firm chose is lost. */
  | 'retry-without-column'
  /** Do not save. The firm restricted something and it cannot be recorded. */
  | 'abort-restriction-unsaved'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/** The wording for the abort, kept beside the decision that causes it. */
export const SIGNATURE_METHODS_UNSAVED_ERROR =
  'This template was not saved. Restricting how it may be signed needs a ' +
  'database update that has not been applied yet, so saving now would leave ' +
  'the template accepting every signature method. Ask your administrator to ' +
  'apply the pending update, or leave all four methods enabled for now.';

/**
 * What to do when a write carrying `signature_methods` fails.
 *
 * 20260814_signature_methods.sql is written and NOT applied, and there is a
 * further window after it runs while PostgREST still holds a stale schema
 * cache. Same shape as resolveDeliveryModeColumnFallback above, same reason,
 * and the same asymmetry.
 *
 * Null is "all four", which is exactly what an absent column reads as, so the
 * retry lands on the behaviour the firm chose and nothing is lost.
 *
 * A restriction is not. Dropping it would store a template the firm believes
 * forbids a method and which in fact accepts it, and they would learn that
 * from an executed instrument carrying the very mark they refused. That is not
 * recoverable after the fact, so this refuses and says why.
 */
export function resolveSignatureMethodsColumnFallback(input: {
  /** The selection on its way to the column. Null means no restriction. */
  methods: string[] | null;
  error: { code?: string | null; message?: string | null } | null | undefined;
}): SignatureMethodsColumnFallback {
  if (!isUnknownColumnError(input.error, 'signature_methods')) return 'surface-error';
  return input.methods === null ? 'retry-without-column' : 'abort-restriction-unsaved';
}

/**
 * One signer on the signature request an approved submission dispatches.
 * Structural, so this module keeps its promise of importing nothing that
 * touches a database.
 */
export type DispatchSigner = {
  email: string;
  name?: string;
  /** Position in the sequence. See lib/signer-order.ts. */
  order: number;
};

/**
 * Who signs the document this submission produced, and in what order.
 *
 * The counterparty signs first, the employee counter-signs second, and both
 * are signers on ONE signature request. Not two requests: a second request for
 * the same instrument would produce two executed PDFs, two document_sha256
 * values and two audit chains, which is the forked-chain failure this repo
 * already knows about from lib/esign-audit.ts. One instrument, one request,
 * one chain.
 *
 * WHY THE EMPLOYEE GOES SECOND
 * ----------------------------
 * They are affirming what the other side actually agreed to. An employee whose
 * signature can land first has signed an instrument that was not finished, and
 * on a document where the counterparty supplies anything at all they would
 * have signed around a blank.
 *
 * WHEN THERE IS ONLY ONE SIGNER
 * -----------------------------
 * Two cases, and both fall back to exactly today's behaviour rather than to an
 * error, because neither is the employee's fault and neither is worth refusing
 * to send an approved document over.
 *
 *   - No submitter address on the record. Submissions filed before the column
 *     was populated have none, and there is then nobody to counter-sign.
 *   - The employee IS the recipient. Two signature rows for one address on one
 *     request would mean two links, two tokens and two turns for one person,
 *     and the second would sit waiting for the first forever.
 *
 * The comparison is case and whitespace insensitive on both sides, the same
 * normalisation the signer gate and createSigningRequestAction use, because
 * "Dana@firm.test" and "dana@firm.test " are one person.
 */
export function counterSignatureParty(record: {
  recipient_email: string;
  recipient_name?: string | null;
  submitter_email?: string | null;
  submitter_name?: string | null;
}): DispatchSigner[] {
  const counterparty: DispatchSigner = {
    email: record.recipient_email,
    ...(record.recipient_name ? { name: record.recipient_name } : {}),
    order: 1,
  };
  const employee = address(record.submitter_email);
  if (!employee || employee === address(record.recipient_email)) {
    return [counterparty];
  }
  return [
    counterparty,
    {
      email: employee,
      ...(record.submitter_name ? { name: record.submitter_name } : {}),
      order: 2,
    },
  ];
}

function address(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
