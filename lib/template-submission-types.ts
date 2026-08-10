/**
 * Shapes shared by the approval server actions, the release helper, and both
 * UIs. Kept free of any server import so a client component can hold a
 * submission without dragging the service-role code path into the bundle.
 *
 * THE STATUS VOCABULARY LIVES HERE, NOT IN lib/template-approval.ts, AND THAT
 * IS LOAD-BEARING. The gate module is pure in the sense that matters to it, no
 * I/O, but it reads its role list from lib/firm-authz.ts, which begins with
 * `import 'server-only'`. Anything a client component reaches for therefore
 * drags that in and the page fails to build. The union and the three
 * predicates over it carry no role and no I/O at all, so they belong on this
 * side of the line; template-approval re-exports them, and every call site
 * that had them from there still does.
 */

// Type-only, so nothing of lib/signing-activity.ts survives compilation into a
// client bundle. That module has no server import today, and this keeps the
// guarantee above from depending on it never gaining one.
import type { SubmitterOpenActivity } from './signing-activity';

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

/** True while the legal team still owes a decision. */
export function isAwaitingReview(status: SubmissionStatus): boolean {
  return status === 'pending';
}

/** The employee may edit their own submission only after it comes back. */
export function isEditableBySubmitter(status: SubmissionStatus): boolean {
  return status === 'changes_requested';
}

/** A decision has been taken and nothing further will happen on its own. */
export function isTerminal(status: SubmissionStatus): boolean {
  return status === 'sent' || status === 'withdrawn' || status === 'declined';
}

/** The row as stored in firm_template_submissions. */
export type SubmissionRow = {
  id: string;
  firm_id: string;
  template_id: string | null;
  template_name: string;
  submitted_by: string;
  submitter_name: string | null;
  submitter_email: string | null;
  recipient_name: string | null;
  recipient_email: string;
  recipient_note: string | null;
  field_values: Record<string, string> | null;
  signature_name: string;
  document_text: string;
  status: SubmissionStatus;
  revision: number;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  /** The employee's own text, kept from the first reviewer edit onwards. */
  original_document_text: string | null;
  edited_by: string | null;
  edited_at: string | null;
  edit_note: string | null;
  released_at: string | null;
  release_token: string | null;
  release_error: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  /**
   * The signer's mark and the record around it. All nullable and all absent on
   * submissions filed before signature capture shipped, which carry a typed
   * name and nothing else. A typed name is a valid signature, so those rows are
   * not defective and must stay releasable.
   *
   * Optional rather than merely nullable, and that is not a convenience: the
   * migration that adds these columns is unapplied, so until it runs PostgREST
   * returns rows without the keys at all. rowToSubmission coalesces, so an
   * absent key and a null column read the same way.
   */
  signature_image_path?: string | null;
  signature_mode?: 'typed' | 'drawn' | 'uploaded' | null;
  signature_captured_at?: string | null;
  signature_intent_at?: string | null;
  signature_ip?: string | null;
  signature_user_agent?: string | null;
  signed_document_sha256?: string | null;
  /**
   * The kind of document this is, copied from the template when it was filed,
   * and the firm's reference for it. Both arrive with
   * 20260807_flow_join.sql, and both are optional for the same reason the
   * signature columns above are: until the owner applies it, PostgREST
   * returns these rows without the keys at all.
   *
   * Neither is ever backfilled. A submission filed before the allocator
   * existed keeps no number and shows the derived reference instead, because
   * numbering old rows in whatever order they happen to be read would put a
   * sequence on the record that never happened.
   */
  category?: string | null;
  ticket_number?: string | null;
  /**
   * The delivery mode document_text was MERGED under, recorded in the same
   * write as the text itself.
   *
   * Not a copy of the template's current mode for convenience: the text either
   * carries a signature block for the other side or it does not, and a
   * template flipped while this row waited in the queue would otherwise send
   * the words down the wrong path. resolveDispatchMode
   * (lib/submission-dispatch.ts) is the whole rule, and an absent value there
   * means "ask the template", which is what dispatch did before this column
   * existed.
   *
   * Optional for the same reason the two above are: until the owner applies
   * 20260807_flow_join.sql, PostgREST returns these rows without the key.
   */
  delivery_mode?: string | null;
};

/** What the UIs render. */
export type TemplateSubmission = {
  id: string;
  firmId: string;
  templateId: string | null;
  templateName: string;
  submittedBy: string;
  submitterName: string | null;
  submitterEmail: string | null;
  recipientName: string | null;
  recipientEmail: string;
  recipientNote: string | null;
  fieldValues: Record<string, string>;
  signatureName: string;
  /**
   * Empty when this reader may not see the wording (see
   * canReadSubmissionDocument). Redaction happens where the row is read, not in
   * the component, and rowToSubmission withholds by default, so a caller that
   * forgets to ask shows nothing rather than showing the document.
   */
  documentText: string;
  /** False when documentText and originalDocumentText have been withheld. */
  documentVisible: boolean;
  status: SubmissionStatus;
  revision: number;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /**
   * Set only when a reviewer changed the wording. documentText is then what
   * would go out, and this is what the employee submitted.
   */
  originalDocumentText: string | null;
  editedBy: string | null;
  editedByName: string | null;
  editedAt: string | null;
  editNote: string | null;
  releasedAt: string | null;
  releaseError: string | null;
  submittedAt: string;
  updatedAt: string;
  /**
   * The mark, for the surfaces that draw it. The IP and user agent are audit
   * facts rather than things a page shows, so they stay on the row and are
   * deliberately not carried here.
   */
  signatureImagePath: string | null;
  signatureMode: 'typed' | 'drawn' | 'uploaded' | null;
  signatureCapturedAt: string | null;
  signatureIntentAt: string | null;
  signedDocumentSha256: string | null;
  /**
   * What the record was filed under and what it is called. Null for a
   * category the firm never set and for a record with no number of its own;
   * the reader supplies the label and the fallback reference (see
   * lib/document-category.ts and displayTicket in lib/ticket-numbers.ts) so
   * neither is guessed twice in two places.
   *
   * Both are carried whatever the reader is allowed to see of the wording.
   * Neither is the document: a queue has to be able to say what a thing is
   * and what to call it to a colleague who may not read it.
   */
  category: string | null;
  ticketNumber: string | null;
};

/**
 * One signer on the signing request an approved submission dispatched.
 *
 * The IP and the user agent of a signature are audit facts and stay on the
 * signature row; what a page needs is who and when.
 *
 * `activity` extends that by exactly one step, and the same rule governs it.
 * The colleague who filed the document is entitled to know their document was
 * opened and whether it was downloaded, because the alternative is the silence
 * this whole record exists to end. They are not entitled to the recipient's
 * address or device: they are waiting on an outcome, not investigating a
 * person, and the firm is the party who would rely on that detail. The
 * boundary is structural rather than a filter a template has to remember:
 * SubmitterOpenActivity has no field that could carry either, and
 * projectActivityForSubmitter is the only way to build one.
 */
export type SubmissionSigner = {
  name: string | null;
  email: string;
  signedAt: string | null;
  /** Set when the events were readable. Null means "not known", not "none". */
  activity: SubmitterOpenActivity | null;
  /** firm_signatures.response, so a page can tell silence from an answer. */
  response: string | null;
};

/**
 * The signature side of a submission, for the surfaces that have to say where
 * the document has got to.
 *
 * Absent (null) for every submission that was released as a read-only share,
 * for every submission filed before the join shipped, and for every firm whose
 * database has not had 20260807_flow_join.sql applied: there is then no
 * signing_request_id to follow, and the pages render exactly as they do today.
 *
 * `executedUrl` is a short-lived signed URL minted on the server. The stored
 * path is never carried to a client.
 */
export type SubmissionSigning = {
  status: 'draft' | 'sent' | 'partial' | 'completed' | 'canceled';
  signers: SubmissionSigner[];
  executedUrl: string | null;
  /**
   * firm_signing_requests.sent_at, which is the clock every "nothing has
   * happened for N days" statement is measured against. Null on a request
   * that has not gone out, where there is nothing to be quiet about.
   */
  sentAt: string | null;
  /**
   * The viewer's OWN signing link, when this reader is one of the signers and
   * has not signed yet.
   *
   * The employee counter-signs at /sign/[token] like anybody else, and they
   * reach it from this record rather than from an email, so the page has to be
   * able to link them there. The token is minted for exactly one signature row
   * and is only ever put in this field when the reader's own address matches
   * that row, which is why the viewer's email is a parameter of the loader and
   * not something the caller filters afterwards.
   *
   * It is not a permission. Turn and identity are decided by the sign page and
   * by lib/signature-write.ts, so a token handed over early, or to somebody
   * whose session does not match, buys nothing.
   */
  yourSignToken: string | null;
};

/**
 * Where the document has got to, as one sentence's worth of fact.
 *
 * The employee is the one person in this flow who has never been told
 * anything after they pressed send, so this is the whole of what they know.
 * It is decided here, once, rather than in each page, because the same three
 * states are wanted on the portal page and in a notification body and two
 * functions answering "whose turn is it" is two answers as soon as one of
 * them is edited.
 */
export type SubmissionSigningState =
  /**
   * `waitingOn` is null when the state is genuinely waiting but nobody is
   * outstanding to name: every signature row is in and the rollup that writes
   * 'completed' has not landed yet. Naming the person who already signed
   * there would be false, and calling it complete would put "fully signed"
   * beside nothing to download.
   */
  | { kind: 'waiting'; waitingOn: string | null }
  | { kind: 'your_turn'; signedBy: string }
  | { kind: 'complete' }
  | { kind: 'halted' };

function signerLabel(signer: SubmissionSigner): string {
  return signer.name?.trim() || signer.email;
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveSubmissionSigningState(
  signing: SubmissionSigning | null | undefined,
  viewerEmail: string | null | undefined,
): SubmissionSigningState | null {
  if (!signing) return null;
  // Neither of these is out for signature: a canceled request has been
  // stopped, and a draft was never sent. There is nobody to be waiting on in
  // either case.
  if (signing.status === 'canceled' || signing.status === 'draft') return { kind: 'halted' };
  // The parent status is the authority, not the signature rows. The executed
  // copy is produced by the rollup that writes 'completed', so a page that
  // called it finished on the strength of the rows alone would say "fully
  // signed" beside nothing to download.
  if (signing.status === 'completed') return { kind: 'complete' };
  // No signers at all is not "waiting for nobody". Nothing was dispatched
  // that anyone can act on, so the page says so rather than naming a person
  // who is not there.
  if (signing.signers.length === 0) return { kind: 'halted' };

  const outstanding = signing.signers.filter((s) => !s.signedAt);
  if (outstanding.length === 0) return { kind: 'waiting', waitingOn: null };

  const viewer = viewerEmail ?? '';
  const others = outstanding.filter((s) => !sameAddress(s.email, viewer));
  if (others.length === 0) {
    // Every other signer is in and the viewer is the one who is not. Name who
    // signed, because that is the fact that changed since they last looked.
    const signed = signing.signers
      .filter((s) => s.signedAt && !sameAddress(s.email, viewer))
      .sort((a, b) => String(a.signedAt).localeCompare(String(b.signedAt)));
    const last = signed[signed.length - 1];
    return { kind: 'your_turn', signedBy: last ? signerLabel(last) : signerLabel(outstanding[0]) };
  }
  return { kind: 'waiting', waitingOn: signerLabel(others[0]) };
}

export type SubmissionInput = {
  recipientEmail: string;
  recipientName?: string;
  recipientNote?: string;
  values: Record<string, string>;
  signatureName: string;
  /**
   * The mark the employee drew, typed or uploaded, as a PNG data URL. Optional:
   * the typed name in signatureName is a signature on its own.
   */
  signatureDataUrl?: string;
  /** When the employee affirmed they intend the mark to be their signature. */
  signatureIntentAt?: string;
  signatureMode?: 'typed' | 'drawn' | 'uploaded';
  /**
   * The handoff a mark drawn on the employee's own phone came back through.
   *
   * Not proof of anything by itself, and not read as any. The server finds the
   * row under the caller's OWN session, firm and template and checks the bytes
   * being submitted against the fingerprint the bound phone left on it, which
   * is what lets 'phone' be established rather than merely claimed. See
   * guardSignatureMethod in lib/template-submissions.ts.
   */
  signatureHandoffId?: string;
};

/**
 * `nameOf` resolves a user id to a display name. It is passed in rather than
 * looked up here so this module stays free of server imports, and so the two
 * people a submission can name (the decider and the editor) are resolved by
 * the same lookup instead of one being remembered and the other forgotten.
 */
export function rowToSubmission(
  row: SubmissionRow,
  nameOf: (userId: string) => string | null = () => null,
  /**
   * True releases the document body and the preserved original; anything else
   * withholds both. The caller decides with canReadSubmissionDocument(); this
   * only carries out the decision, so there is one place the text can be
   * dropped and one shape the UIs have to handle.
   *
   * It defaults to withholding, so a future action that forgets the argument
   * returns a submission with no wording in it rather than the full document.
   * That failure is visible and harmless; the other direction is the leak this
   * whole gate exists to close.
   */
  showDocument = false,
): TemplateSubmission {
  const decidedByName = row.decided_by ? nameOf(row.decided_by) : null;
  const editedByName = row.edited_by ? nameOf(row.edited_by) : null;
  return {
    id: row.id,
    firmId: row.firm_id,
    templateId: row.template_id,
    templateName: row.template_name,
    submittedBy: row.submitted_by,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    recipientNote: row.recipient_note,
    fieldValues: (row.field_values ?? {}) as Record<string, string>,
    signatureName: row.signature_name,
    documentText: showDocument ? row.document_text : '',
    documentVisible: showDocument,
    status: row.status,
    revision: row.revision,
    decidedBy: row.decided_by,
    decidedByName,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    originalDocumentText: showDocument ? row.original_document_text : null,
    editedBy: row.edited_by,
    editedByName,
    editedAt: row.edited_at,
    editNote: row.edit_note,
    releasedAt: row.released_at,
    releaseError: row.release_error,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    // Coalesced because these columns do not exist until the signature
    // migration is applied, and a row read before then simply has no mark.
    signatureImagePath: row.signature_image_path ?? null,
    signatureMode: row.signature_mode ?? null,
    signatureCapturedAt: row.signature_captured_at ?? null,
    signatureIntentAt: row.signature_intent_at ?? null,
    signedDocumentSha256: row.signed_document_sha256 ?? null,
    // Coalesced for the same reason the mark above is: these columns do not
    // exist until 20260807_flow_join.sql is applied, and a row read before
    // then simply has no category and no number.
    category: row.category ?? null,
    ticketNumber: row.ticket_number ?? null,
  };
}
