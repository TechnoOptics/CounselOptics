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
  released_at: string | null;
  release_token: string | null;
  release_error: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string;
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
  documentText: string;
  status: SubmissionStatus;
  revision: number;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  releasedAt: string | null;
  releaseError: string | null;
  submittedAt: string;
  updatedAt: string;
};

export type SubmissionInput = {
  recipientEmail: string;
  recipientName?: string;
  recipientNote?: string;
  values: Record<string, string>;
  signatureName: string;
};

export function rowToSubmission(
  row: SubmissionRow,
  decidedByName: string | null = null,
): TemplateSubmission {
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
    documentText: row.document_text,
    status: row.status,
    revision: row.revision,
    decidedBy: row.decided_by,
    decidedByName,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    releasedAt: row.released_at,
    releaseError: row.release_error,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}
