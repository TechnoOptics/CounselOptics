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
  | { ok: true; token: string; key: string; link: string }
  | { ok: false; error: string };

export async function releaseApprovedSubmission(
  admin: SupabaseClient,
  submissionId: string,
): Promise<ReleaseOutcome> {
  const { data, error: readError } = await admin
    .from('firm_template_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  // A failed read and a missing row both arrive as null data. Telling the
  // approver "already sent" or "not found" when the truth is "the database did
  // not answer" writes a false statement into release_error and shows it.
  if (readError) {
    return { ok: false, error: 'This submission could not be read just now. Try again shortly.' };
  }
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

  // Claim the release before doing any of the work.
  //
  // The read above and the send below are two separate moments, and between
  // them a second approver (or the same one in a second tab) can pass the very
  // same gate. Both would then send: two ciphertexts, four emails, and two
  // live share links, of which only the last would be recorded and therefore
  // only the last revocable. The conditional update is the compare-and-swap:
  // the database, not this process, decides who got there first, and a caller
  // who did not win comes back with no row and sends nothing.
  const token = newShareToken();
  const { data: claimed, error: claimError } = await admin
    .from('firm_template_submissions')
    .update({
      released_at: new Date().toISOString(),
      release_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'approved')
    .is('released_at', null)
    .select('id')
    .maybeSingle();
  // A claim that failed to write and a claim that lost the race both come back
  // without a row. Only the second one means the document is on its way.
  if (claimError) {
    return { ok: false, error: 'This document could not be sent just now. Try again shortly.' };
  }
  if (!claimed) return { ok: false, error: 'This document has already been sent.' };

  /**
   * Give the claim back so an approver can try again. Everything after the
   * claim can fail on infrastructure the firm does not control, and a
   * half-finished release must never look finished: the record stays approved
   * and unclaimed, which is the state the retry path expects. The token is
   * kept when ciphertext was already written, so an orphaned share can still
   * be traced and revoked.
   */
  const unclaim = async (error: string, keepToken: boolean): Promise<ReleaseOutcome> => {
    const { error: writeError } = await admin
      .from('firm_template_submissions')
      .update({
        released_at: null,
        release_token: keepToken ? token : null,
        release_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);
    if (writeError) {
      // The claim is still on the row and nothing else will take it off, so
      // retry will refuse. Say so plainly rather than report the original
      // failure as if the record were back in a state anyone can act on.
      return {
        ok: false,
        error:
          'The send failed and the document could not be returned to a sendable state. This record needs attention before it can go out.',
      };
    }
    return { ok: false, error };
  };

  // Everything from here can throw, not just fail: pdf-lib refuses text its
  // WinAnsi font cannot encode, storage and mail are network calls. An escaped
  // throw would leave the claim on the row with nothing to take it off, and
  // checkReleasable would then refuse the record forever. So the whole of the
  // work sits inside one try, and every exit from it goes through unclaim.
  let ciphertextStored = false;
  try {
    const firm = await getFirmByIdAdmin(row.firm_id);
    const bytes = await buildBrandedDocumentPdf({
      document: row.document_text,
      title: row.template_name,
      brandName: firm?.name ?? undefined,
      accent: firm?.accentColor ?? undefined,
      letterheadUrl: firm?.letterheadUrl ?? undefined,
      logoUrl: firm?.logoUrl ?? undefined,
    });
    if (!bytes) {
      return await unclaim('The document could not be prepared for sending.', false);
    }

    const { blob, key } = encryptDocument(Buffer.from(bytes));
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
    if (!stored) return await unclaim('Could not store the encrypted document.', false);
    ciphertextStored = true;

    const link = `${siteUrl()}/share/${token}`;
    const shownKey = formatKey(key);
    const firmName = firm?.name ?? null;
    const senderName = row.submitter_name;
    const note = row.recipient_note ?? undefined;

    // Both emails or none. The link is useless without the key and the key is
    // useless without the link, so one of the two arriving is not a delivery:
    // the recipient would be holding a document they cannot open while the
    // firm was told it had gone. A partial send is a failed send, and it is
    // retried whole.
    const undelivered =
      'The recipient could not be emailed, so nothing they can open has reached them. Send it again.';

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
    // Stop here if the link did not go. A bare "Your decryption key" email
    // with nothing to use it on is a worse thing to receive than nothing.
    if (!linkEmail.ok) return await unclaim(undelivered, true);

    const keyEmail = await sendEmail({
      to: row.recipient_email,
      fromName: firmName ?? undefined,
      subject: 'Your decryption key',
      replyTo: row.submitter_email ?? undefined,
      text: `Here is your decryption key for the secure document "${row.template_name}":\n\n${shownKey}\n\nEnter it on the secure page you received in the separate email.`,
      html: buildShareKeyEmailHtml({ caseTitle: row.template_name, firmName, key: shownKey }),
    });
    if (!keyEmail.ok) return await unclaim(undelivered, true);

    return { ok: true, token, key: shownKey, link };
  } catch {
    return await unclaim(
      'Something went wrong while preparing this document to send. It has not gone out, and it can be sent again.',
      ciphertextStored,
    );
  }
}
