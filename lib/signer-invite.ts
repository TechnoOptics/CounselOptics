import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, buildSigningRequestEmailHtml } from './email';
import { SIGNER_COPY_RETENTION_DAYS } from './signer-retention';

/**
 * The branded sign-link email, and the one thing that sends it late.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The composer (createSigningRequestAction) and the resend path both
 * lived in lib/firm-actions.ts and shared a private helper, which was
 * fine while everything that mailed a signing link was in that file.
 * Sequential signers broke that: a signer numbered second is not emailed
 * when the request is created, they are emailed when the person ahead of
 * them signs, and that happens in lib/signature-write.ts, which is not
 * and must not become a server-action module.
 *
 * So the composer moved here rather than being copied there. A resend
 * has always been promised to be byte-for-byte the message the signer
 * was originally sent, and a late invitation has to be the same message
 * too, or a signer who compares the two has reason to doubt both.
 *
 * `import 'server-only'` and NOT `'use server'`. Nothing here is an HTTP
 * endpoint, for the same reason lib/template-release.ts and
 * lib/submission-completion.ts are not: an exported action is a public
 * endpoint, and "email this address a live signing link" is not
 * something a stranger gets to call.
 */

type Admin = SupabaseClient;

/**
 * The branded sign-link email. Shared by createSigningRequestAction,
 * resendSigningEmailsAction and the late invitation below, so a resend
 * and a turn-based invitation are byte-for-byte the message the signer
 * was originally promised.
 */
export async function sendSigningLinkEmail(input: {
  to: string;
  firmName: string;
  firmLogo: string | null;
  senderName: string;
  docName: string;
  message: string | null;
  url: string;
  isExternal: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await sendEmail({
    to: input.to,
    fromName: input.firmName,
    subject: `${input.firmName}: signature requested for ${input.docName}`,
    html: buildSigningRequestEmailHtml({
      firmName: input.firmName,
      logoUrl: input.firmLogo,
      senderName: input.senderName,
      documentName: input.docName,
      message: input.message,
      link: input.url,
      codeSeparately: input.isExternal,
    }),
    text:
      `${input.senderName} at ${input.firmName} requested your signature on "${input.docName}".\n\n` +
      `Review and sign (the document stays inside Advottic):\n${input.url}\n\n` +
      (input.isExternal
        ? 'For your security, a one-time access code was sent to this address in a separate email. Enter it to open the document.\n'
        : // The plain-text twin of the sentence in
          // buildSigningRequestEmailHtml. "Single-use" described the
          // URL and the URL is not consumed: it keeps resolving after
          // signing, because it is the signer's route back to the
          // record that binds them. What is used once is the act.
          `You can use this link to sign once. Afterwards it stays available to you for ${SIGNER_COPY_RETENTION_DAYS} days so you can download your copy.\n`),
  }).catch((err: unknown) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : 'unknown email error',
  }));
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Invite the signer whose turn has just come.
 *
 * Called from lib/signature-write.ts after a signature lands and the
 * parent request rolls forward. Best effort: a signature that has been
 * recorded must not be undone because a mail provider was unreachable,
 * and the firm can resend from the signing surface.
 *
 * NOTHING IS MINTED HERE. The signature row and its durable token were
 * created with the request; this only sends a message about them. An
 * external signer's one-time access code was likewise generated and
 * emailed when the request was created, even though their link was held
 * back, because a code on its own opens nothing and re-issuing one now
 * would invalidate the code they already hold. So there is no
 * access_code_sent event to append here: that fact was recorded at the
 * moment it happened, which is the only moment it may be recorded at.
 *
 * Returns whether the message left, for the caller's audit metadata.
 */
export async function sendNextSignerInvite(
  admin: Admin,
  signatureId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sigRow, error: sigErr } = await admin
    .from('firm_signatures')
    .select('id, signing_request_id, signer_email, token, access_code_hash, signed_at')
    .eq('id', signatureId)
    .maybeSingle();
  if (sigErr) return { ok: false, error: sigErr.message };
  const sig = sigRow as {
    signing_request_id: string;
    signer_email: string;
    token: string | null;
    access_code_hash: string | null;
    signed_at: string | null;
  } | null;
  if (!sig || !sig.token) return { ok: false, error: 'No signing link for this signer.' };
  // Somebody signed between the caller's read and this send. Inviting
  // them to do what they have already done is noise, not a failure.
  if (sig.signed_at) return { ok: true };

  const { data: reqRow, error: reqErr } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, document_id, message, requested_by, status')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  if (reqErr) return { ok: false, error: reqErr.message };
  const request = reqRow as {
    firm_id: string;
    document_id: string;
    message: string | null;
    requested_by: string | null;
    status: string | null;
  } | null;
  if (!request) return { ok: false, error: 'Signing request not found.' };
  // A recalled or halted request does not get to keep inviting people.
  if (
    request.status === 'canceled' ||
    request.status === 'rejected' ||
    request.status === 'changes_requested'
  ) {
    return { ok: false, error: 'This signing request is no longer out for signature.' };
  }

  const { data: docRow } = await admin
    .from('firm_documents')
    .select('name')
    .eq('id', request.document_id)
    .maybeSingle();
  const docName = (docRow as { name?: string } | null)?.name ?? 'Document';

  const { data: firmRow } = await admin
    .from('firms')
    .select('name, logo_url')
    .eq('id', request.firm_id)
    .maybeSingle();
  const firmName =
    ((firmRow as { name?: string } | null)?.name ?? 'Advottic').trim() || 'Advottic';
  const firmLogo = (firmRow as { logo_url?: string | null } | null)?.logo_url ?? null;

  let senderName = 'A team member';
  if (request.requested_by) {
    const { data: member } = await admin
      .from('firm_members')
      .select('display_name')
      .eq('firm_id', request.firm_id)
      .eq('user_id', request.requested_by)
      .maybeSingle();
    senderName =
      ((member as { display_name?: string | null } | null)?.display_name || '').trim() ||
      senderName;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
  return sendSigningLinkEmail({
    to: sig.signer_email,
    firmName,
    firmLogo,
    senderName,
    docName,
    message: request.message,
    url: `${baseUrl}/sign/${sig.token}`,
    // Whether a code was issued for them, which is the only thing the
    // wording of the email turns on. Held to the row rather than
    // recomputed from firm membership, because the row is what the
    // access-code gate itself reads.
    isExternal: Boolean(sig.access_code_hash),
  });
}
