'use server';

import { revalidatePath } from 'next/cache';
import { getActiveFirmContext } from './firm-storage';
import { createAdminSupabase } from './supabase/admin';
import { appendSignatureEvent, sha256 } from './esign-audit';
import { createNotification } from './notifications';
import { checkRateLimit } from './rate-limit';
import { requireActiveFirm } from './firm-authz';
import { getRealCurrentUser } from './supabase/server';
import { loadSignerOrder } from './signature-write';
import { SIGNER_NOT_YET_YOUR_TURN, resolveSignerTurn } from './signer-order';
import {
  INTERNAL_SIGNER_GATE_COPY,
  accessCodeStillRequired,
  maskSignerEmail,
  resolveInternalSignerGate,
} from './signer-view';

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
  // createSigningRequestAction is gated, so without this the lifecycle simply
  // keeps running for an organization whose access has ended: it cannot start
  // a signing request but can still drive the ones it has, and each step
  // notifies signers outside the firm.
  //
  // On the INVITING firm, resolved from the request row and already checked
  // against the caller's active firm above, never on a caller-supplied id.
  await requireActiveFirm(request.firm_id);

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
 * Reopen a request that a signer put on hold (rejected / changes
 * requested), instead of forcing the firm to rebuild it from scratch.
 *
 * Signatures already captured are NEVER discarded - a signer's
 * signed_at is untouched - so in a multi-party request the people who
 * already signed stay signed. We only clear the RESPONSE fields on the
 * signers who objected, so their link works again for the revised
 * document, then recompute the rollup status (partial if anyone has
 * signed, else sent). Team-only; appends a 'reopened' audit event.
 */
export async function reopenSigningRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveFirmContext();
  if (!ctx) return { ok: false, error: 'Sign in first.' };
  if (!POSTING_ROLES.includes(ctx.membership.role)) {
    return { ok: false, error: 'Your role cannot reopen signing requests.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, status')
    .eq('id', requestId)
    .maybeSingle();
  const request = reqRow as {
    id: string;
    firm_id: string;
    status: string;
  } | null;
  if (!request || request.firm_id !== ctx.firm.id) {
    return { ok: false, error: 'Signing request not found.' };
  }
  if (request.status !== 'rejected' && request.status !== 'changes_requested') {
    return {
      ok: false,
      error: 'Only a request a signer put on hold can be reopened.',
    };
  }
  // Same reason as the recall above: reopening puts a document back in front
  // of a signer, which is the organization continuing to work.
  await requireActiveFirm(request.firm_id);

  const { data: sigs } = await admin
    .from('firm_signatures')
    .select('id, signed_at, response, signer_user_id, signer_email')
    .eq('signing_request_id', requestId);
  const rows = (sigs ?? []) as Array<{
    id: string;
    signed_at: string | null;
    response: string | null;
    signer_user_id: string | null;
    signer_email: string;
  }>;

  // Clear the objecting signers' response so their link is live again.
  const toClear = rows.filter((r) => r.response && !r.signed_at).map((r) => r.id);
  if (toClear.length > 0) {
    await admin
      .from('firm_signatures')
      .update({ response: null, response_note: null, responded_at: null })
      .in('id', toClear);
  }

  const anySigned = rows.some((r) => r.signed_at);
  await admin
    .from('firm_signing_requests')
    .update({ status: anySigned ? 'partial' : 'sent' })
    .eq('id', requestId);

  await appendSignatureEvent(admin, {
    signingRequestId: requestId,
    eventType: 'reopened',
    signerEmail: null,
  }).catch(() => undefined);

  // Nudge the signers who still need to act.
  await Promise.all(
    rows
      .filter((r) => r.signer_user_id && !r.signed_at)
      .map((r) =>
        createNotification({
          userId: r.signer_user_id as string,
          type: 'system',
          title: `${ctx.firm.name} reopened a document for your signature`,
          body: 'A revised version is ready. Your signing link is active again.',
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
    // Atomic increment: a single UPDATE ... RETURNING so K parallel wrong
    // guesses advance the counter by K (not ~1), closing the lockout
    // race. Fall back to the read value + 1 only if the RPC is missing.
    const { data: bumped } = await admin.rpc('bump_signature_access_attempt', {
      p_id: sig.id,
    });
    const next = typeof bumped === 'number' ? bumped : attempts + 1;
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

/**
 * Decline to sign, or ask the firm for changes.
 *
 * This is the OTHER thing a signing token can do, and what it does is not
 * small: it puts the whole instrument on hold, stops every other signer's
 * link working, and writes an event into the tamper-evident chain
 * attributed by name and address to the person the signature row names.
 * That chain is offered as evidence, so an event in it must never be
 * attributable to somebody who did not perform it.
 *
 * The gates below are lib/signature-write.ts's gates, in that file's own
 * order, deliberately and not by coincidence. That path had them and this
 * one did not, so a token that was forwarded, leaked out of an inbox or
 * copied from a notification could reject another firm's instrument in an
 * employee's name: the external signer's access code was never asked for,
 * and the internal signer's session was never checked. /sign/[token]
 * refuses all of this before it renders the buttons, but the page is not
 * the gate, because every 'use server' export is a public HTTP endpoint
 * that takes its arguments from the caller.
 *
 * Two things it deliberately does NOT take from that file, both because
 * they are about MAKING a mark rather than about who is asking:
 *
 *   - The conditional claim on signed_at. There is no race to lose here;
 *     a response is not a signature and does not fork the chain.
 *   - requireActiveFirm. The recall and reopen actions above call it,
 *     because those are the firm continuing to work. A signer declining
 *     is the signer, and trapping them in a request they want out of
 *     because the firm's access lapsed would be the wrong direction.
 */
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

  // access_code_hash, access_code_verified_at and response are on this
  // list because the gates below are the only things enforcing them on
  // this path. Dropping one from the select passes its gate silently.
  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, signer_email, signer_name, signed_at, access_code_hash, access_code_verified_at, response',
    )
    .eq('token', token)
    .maybeSingle();
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signer_email: string;
    signer_name: string | null;
    signed_at: string | null;
    access_code_hash: string | null;
    access_code_verified_at: string | null;
    response: 'rejected' | 'changes_requested' | null;
  } | null;
  if (!sig) return { ok: false, error: 'Sign link not found.' };
  if (sig.signed_at) {
    return { ok: false, error: 'You already signed this document.' };
  }
  // An external signer's proof of identity, asked here for the same
  // reason the write asks it: a link forwarded without its code must not
  // be able to act on the request behind it. Same predicate, so the two
  // cannot come to disagree about it.
  if (
    accessCodeStillRequired({
      accessCodeHash: sig.access_code_hash,
      accessCodeVerifiedAt: sig.access_code_verified_at,
    })
  ) {
    return {
      ok: false,
      error: 'Enter the access code from your email before you respond.',
    };
  }
  // Already on hold. The signer page shows a terminal screen in this
  // state rather than the response buttons, and the write refuses a
  // signature on it, so a second response can only arrive from something
  // that is not the page.
  if (sig.response) {
    return {
      ok: false,
      error: 'This signing link is on hold. Ask the firm for a new request.',
    };
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

  // Is this really the person the row names?
  //
  // An internal signer is issued no access code on purpose, so for them
  // the durable /sign/[token] URL was the only credential in play, and
  // that URL is emailed, forwarded, copied out of a notification and kept
  // alive for the whole retention window. Without this, anyone who came
  // into possession of one could decline in that employee's name and the
  // chain would carry a 'rejected' event bearing their address with
  // nothing anywhere saying it was not them.
  //
  // getRealCurrentUser, not getCurrentUser, for the same reason the write
  // uses it: the HQ "act as" overlay resolves to the target user, and an
  // operator viewing as an employee must not thereby be able to answer
  // for them.
  const sessionEmail = await getRealCurrentUser()
    .then((u) => u?.email ?? null)
    .catch(() => null);
  const gate = resolveInternalSignerGate({
    accessCodeRequired: Boolean(sig.access_code_hash),
    signerEmail: sig.signer_email,
    sessionEmail,
  });
  if (gate !== 'allow') {
    return {
      ok: false,
      error:
        gate === 'sign-in-required'
          ? INTERNAL_SIGNER_GATE_COPY['sign-in-required']
          : INTERNAL_SIGNER_GATE_COPY['wrong-account'](
              maskSignerEmail(sig.signer_email),
            ),
    };
  }

  // Whose turn it is.
  //
  // Read through the same loader the write uses, over the same rows, so
  // the page, the signature and the response cannot disagree about
  // whether this signer may act at all. A signer whose turn has not come
  // has not been invited yet: the page refuses to render anything for
  // them, and letting a link that is not live yet put the whole
  // instrument on hold would be the same defect one door along.
  //
  // Unreadable fails closed and retryably, exactly as it does on the
  // write. Not knowing whose turn it is, is not the same as it being
  // theirs, and nothing has been written at this point.
  const order = await loadSignerOrder(admin, request.id);
  if (order.kind === 'unreadable') {
    return {
      ok: false,
      error: 'This could not be recorded just now. Please try again shortly.',
    };
  }
  const selfIndex = order.rows.findIndex((r) => r.id === sig.id);
  if (resolveSignerTurn(order.rows, selfIndex) === 'waiting') {
    return { ok: false, error: SIGNER_NOT_YET_YOUR_TURN };
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
