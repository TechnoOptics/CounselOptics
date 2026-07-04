'use server';

import { revalidatePath } from 'next/cache';
import { getActiveFirmContext } from './firm-storage';
import { createAdminSupabase } from './supabase/admin';
import { appendSignatureEvent, sha256 } from './esign-audit';
import { createNotification } from './notifications';
import { checkRateLimit } from './rate-limit';

/**
 * Signing lifecycle actions beyond the happy-path sign flow:
 *   - recall a request (team) so its links stop working, and
 *   - reject / request changes (signer, token-scoped, unauthenticated).
 * Both notify the other side.
 */

const POSTING_ROLES = ['owner', 'admin', 'attorney', 'paralegal'];

export async function recallSigningRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveFirmContext();
  if (!ctx) return { ok: false, error: 'Sign in first.' };
  if (!POSTING_ROLES.includes(ctx.membership.role)) {
    return { ok: false, error: 'Your role cannot recall signing requests.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, status, document_id')
    .eq('id', requestId)
    .maybeSingle();
  const request = reqRow as {
    id: string;
    firm_id: string;
    status: string;
    document_id: string;
  } | null;
  if (!request || request.firm_id !== ctx.firm.id) {
    return { ok: false, error: 'Signing request not found.' };
  }
  if (request.status === 'completed') {
    return { ok: false, error: 'This request is already completed and cannot be recalled.' };
  }
  if (request.status === 'canceled') return { ok: true };

  await admin
    .from('firm_signing_requests')
    .update({ status: 'canceled' })
    .eq('id', requestId);

  // Audit + notify any signer who has an account.
  const { data: sigs } = await admin
    .from('firm_signatures')
    .select('id, signer_user_id, signer_email')
    .eq('signing_request_id', requestId);
  const rows = (sigs ?? []) as Array<{
    id: string;
    signer_user_id: string | null;
    signer_email: string;
  }>;
  await appendSignatureEvent(admin, {
    signingRequestId: requestId,
    eventType: 'recalled',
    signerEmail: null,
  }).catch(() => undefined);
  await Promise.all(
    rows
      .filter((r) => r.signer_user_id)
      .map((r) =>
        createNotification({
          userId: r.signer_user_id as string,
          type: 'signing_request_canceled',
          title: `A signing request from ${ctx.firm.name} was recalled`,
          body: 'The document is no longer available to sign. The firm will follow up if a new version is ready.',
        }).catch(() => null),
      ),
  );

  revalidatePath('/counsel/signing');
  revalidatePath(`/counsel/signing/${requestId}`);
  return { ok: true };
}

/**
 * Verify the one-time access code an external signer received in a
 * separate email (#5). Token-scoped + unauthenticated (the sign page
 * is public). On success the code is consumed - access_code_verified_at
 * is stamped - and the token is unlocked so the document renders. The
 * short code is protected two ways: a per-token rate limit and a hard
 * per-signature attempt cap that locks the code after too many misses.
 */
const MAX_ACCESS_ATTEMPTS = 8;

export async function verifyAccessCodeAction(
  token: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const cleaned = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4) {
    return { ok: false, error: 'Enter the code from your email.' };
  }

  // Blunt scripted brute force across many tokens/IPs. Fail CLOSED:
  // this guards a signing access code, so a store error must not become
  // an uncapped guessing bypass.
  const allowed = await checkRateLimit(`sign-code:${token}`, {
    limit: 10,
    windowSeconds: 600,
    failClosed: true,
  });
  if (!allowed) {
    return {
      ok: false,
      error: 'Too many attempts. Wait a few minutes and try again.',
    };
  }

  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, signer_email, signed_at, access_code_hash, access_code_verified_at, access_attempts',
    )
    .eq('token', token)
    .maybeSingle();
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signer_email: string;
    signed_at: string | null;
    access_code_hash: string | null;
    access_code_verified_at: string | null;
    access_attempts: number | null;
  } | null;
  if (!sig) return { ok: false, error: 'Sign link not found.' };
  // No gate, or already unlocked -> nothing to do.
  if (!sig.access_code_hash) return { ok: true };
  if (sig.access_code_verified_at) return { ok: true };
  if (sig.signed_at) {
    return { ok: false, error: 'This document was already signed.' };
  }
  const attempts = sig.access_attempts ?? 0;
  if (attempts >= MAX_ACCESS_ATTEMPTS) {
    return {
      ok: false,
      error:
        'This code is locked after too many tries. Ask the firm to resend the request.',
    };
  }

  if (sha256(cleaned) !== sig.access_code_hash) {
    const next = attempts + 1;
    await admin
      .from('firm_signatures')
      .update({ access_attempts: next })
      .eq('id', sig.id);
    await appendSignatureEvent(admin, {
      signingRequestId: sig.signing_request_id,
      signatureId: sig.id,
      eventType: 'access_denied',
      signerEmail: sig.signer_email,
    }).catch(() => undefined);
    const left = Math.max(0, MAX_ACCESS_ATTEMPTS - next);
    return {
      ok: false,
      error:
        left > 0
          ? `That code didn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'This code is now locked. Ask the firm to resend the request.',
    };
  }

  await admin
    .from('firm_signatures')
    .update({ access_code_verified_at: new Date().toISOString() })
    .eq('id', sig.id);
  await appendSignatureEvent(admin, {
    signingRequestId: sig.signing_request_id,
    signatureId: sig.id,
    eventType: 'access_verified',
    signerEmail: sig.signer_email,
  }).catch(() => undefined);

  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export async function respondToSignatureAction(
  token: string,
  response: 'rejected' | 'changes_requested',
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  if (response !== 'rejected' && response !== 'changes_requested') {
    return { ok: false, error: 'Invalid response.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select('id, signing_request_id, signer_email, signer_name, signed_at')
    .eq('token', token)
    .maybeSingle();
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signer_email: string;
    signer_name: string | null;
    signed_at: string | null;
  } | null;
  if (!sig) return { ok: false, error: 'Sign link not found.' };
  if (sig.signed_at) {
    return { ok: false, error: 'You already signed this document.' };
  }

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, status, requested_by, document_id')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  const request = reqRow as {
    id: string;
    firm_id: string;
    status: string;
    requested_by: string | null;
    document_id: string;
  } | null;
  if (!request) return { ok: false, error: 'Signing request not found.' };
  if (request.status === 'canceled' || request.status === 'completed') {
    return { ok: false, error: 'This request is no longer open.' };
  }

  const trimmedNote = note.trim().slice(0, 2000) || null;
  await admin
    .from('firm_signatures')
    .update({
      response,
      response_note: trimmedNote,
      responded_at: new Date().toISOString(),
    })
    .eq('id', sig.id);
  await admin
    .from('firm_signing_requests')
    .update({ status: response })
    .eq('id', request.id);

  await appendSignatureEvent(admin, {
    signingRequestId: request.id,
    signatureId: sig.id,
    eventType: response,
    signerEmail: sig.signer_email,
  }).catch(() => undefined);

  // Notify the person who sent the request.
  if (request.requested_by) {
    const who = sig.signer_name || sig.signer_email;
    const verb = response === 'rejected' ? 'declined to sign' : 'requested changes to';
    await createNotification({
      userId: request.requested_by,
      type: 'system',
      title: `${who} ${verb} a document`,
      body: trimmedNote ? `Note: ${trimmedNote}` : undefined,
      link: `/counsel/signing/${request.id}`,
    }).catch(() => null);
  }

  revalidatePath('/counsel/signing');
  revalidatePath(`/counsel/signing/${request.id}`);
  return { ok: true };
}
