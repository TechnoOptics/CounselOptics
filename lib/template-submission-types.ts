import type { SubmissionStatus } from './template-approval';

/**
 * Shapes shared by the approval server actions, the release helper, and both
 * UIs. Kept free of any server import so a client component can hold a
 * submission without dragging the service-role code path into the bundle.
 */

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
   */
  signature_image_path: string | null;
  signature_mode: 'typed' | 'drawn' | 'uploaded' | null;
  signature_captured_at: string | null;
  signature_intent_at: string | null;
  signature_ip: string | null;
  signature_user_agent: string | null;
  signed_document_sha256: string | null;
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
};

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
  };
}
