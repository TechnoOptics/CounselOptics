import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getFirmByIdAdmin } from './firm-storage';
import { buildBrandedDocumentPdf } from './branded-document-pdf';
import { sendEmail, buildShareLinkEmailHtml, buildShareKeyEmailHtml } from './email';
import { siteUrl } from './intake-notify';
import {
  encryptDocument,
  storeShare,
  newShareToken,
  formatKey,
  type ShareMeta,
} from './secure-share';
import { checkReleasable } from './template-approval';
import type { SubmissionRow } from './template-submission-types';

/**
 * Delivery of an APPROVED template submission to its outside recipient.
 *
 * This module is the only code in the product that sends an employee's filled
 * template out of the building, and it is deliberately not a server action:
 * nothing here is an HTTP endpoint. The only caller is the approval path in
 * lib/template-submissions.ts, and even that caller cannot skip the gate,
 * because this function re-reads the stored row itself and runs
 * checkReleasable() against it before anything is encrypted or emailed. A row
 * that is not 'approved', or that is approved with no approver recorded, is
 * refused here regardless of what the caller passed in.
 *
 * Mechanism is unchanged from the secure share the Hub already used: the
 * document is encrypted with a one-time AES-256-GCM key, stored as ciphertext,
 * and the recipient gets the link in one email and the key in a second.
 */

const SHARE_TTL_DAYS = 14;

export type ReleaseOutcome =
  | { ok: true; emailSent: boolean; token: string; key: string; link: string }
  | { ok: false; error: string };

export async function releaseApprovedSubmission(
  admin: SupabaseClient,
  submissionId: string,
): Promise<ReleaseOutcome> {
  const { data } = await admin
    .from('firm_template_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  // The gate. Nothing below runs for a record that has not been approved.
  const gate = checkReleasable({
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    recipientEmail: row.recipient_email,
    documentText: row.document_text,
    releasedAt: row.released_at,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const firm = await getFirmByIdAdmin(row.firm_id);
  const bytes = await buildBrandedDocumentPdf({
    document: row.document_text,
    title: row.template_name,
    brandName: firm?.name ?? undefined,
    accent: firm?.accentColor ?? undefined,
    letterheadUrl: firm?.letterheadUrl ?? undefined,
    logoUrl: firm?.logoUrl ?? undefined,
  });
  if (!bytes) return { ok: false, error: 'The document could not be prepared for sending.' };

  const { blob, key } = encryptDocument(Buffer.from(bytes));
  const token = newShareToken();
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 3600 * 1000);
  const meta: ShareMeta = {
    caseId: 'portal',
    firmId: row.firm_id,
    createdBy: row.submitted_by,
    createdByName: row.submitter_name,
    recipientEmail: row.recipient_email,
    filename: `${row.template_name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'document'}.pdf`,
    mime: 'application/pdf',
    caseTitle: row.template_name,
    scopeLabel: 'Approved by legal',
    sizeBytes: bytes.length,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const stored = await storeShare(admin, token, blob, meta);
  if (!stored) return { ok: false, error: 'Could not store the encrypted document.' };

  const link = `${siteUrl()}/share/${token}`;
  const shownKey = formatKey(key);
  const firmName = firm?.name ?? null;
  const senderName = row.submitter_name;
  const note = row.recipient_note ?? undefined;

  const linkEmail = await sendEmail({
    to: row.recipient_email,
    fromName: firmName ?? undefined,
    subject: `${row.template_name}: secure document`,
    replyTo: row.submitter_email ?? undefined,
    text: [
      `${senderName || 'A colleague'} has securely shared a document with you: ${row.template_name}.`,
      note ? `\nNote: ${note}` : '',
      `\nOpen it here:\n${link}`,
      `\nThe document is encrypted. Your decryption key arrives in a separate email. You will need it to open the document.`,
      `\nThis link expires in ${SHARE_TTL_DAYS} days. Confidential: please do not forward.`,
    ]
      .filter(Boolean)
      .join('\n'),
    html: buildShareLinkEmailHtml({
      caseTitle: row.template_name,
      senderName,
      firmName,
      link,
      expiresAt,
      note,
    }),
  });
  const keyEmail = await sendEmail({
    to: row.recipient_email,
    fromName: firmName ?? undefined,
    subject: 'Your decryption key',
    replyTo: row.submitter_email ?? undefined,
    text: `Here is your decryption key for the secure document "${row.template_name}":\n\n${shownKey}\n\nEnter it on the secure page you received in the separate email.`,
    html: buildShareKeyEmailHtml({ caseTitle: row.template_name, firmName, key: shownKey }),
  });
  const emailSent = linkEmail.ok && keyEmail.ok;

  return { ok: true, emailSent, token, key: shownKey, link };
}
