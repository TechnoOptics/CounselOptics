'use server';

import { headers } from 'next/headers';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent, sha256 } from '@/lib/esign-audit';
import { loadCounterpartyIntake } from '@/lib/counterparty-intake';
import {
  COUNTERPARTY_REFUSAL_COPY,
  resolveCounterpartySubmission,
  type CounterpartyValues,
} from '@/lib/counterparty-fields';

/**
 * The counterparty typing the parts of the document that are theirs to
 * supply.
 *
 * EVERY `'use server'` EXPORT IS A PUBLIC HTTP ENDPOINT. This one is callable
 * by anyone, with any arguments, in any order, and it treats nothing as proof
 * of anything except the durable signer token, which is the credential the
 * signer legitimately holds and the only thing here that identifies them.
 * There is deliberately no signature id and no submission id in the
 * signature: an id supplied by a caller would let one signer write onto
 * another signer's row.
 *
 * The decision itself is resolveCounterpartySubmission
 * (lib/counterparty-fields.ts), which is pure and has a test for every
 * refusal it can return. This file is the adapter that reads the three rows
 * it needs and carries out the answer.
 *
 * WHAT THIS DOES NOT TOUCH. It does not write signed_at, does not roll the
 * request status, and does not re-render the document. The single writer for
 * a signature is lib/signature-write.ts and it stays that way. The values
 * land on their own column and reach the page through the geometry the
 * renderer recorded, which is the whole architecture of this slice.
 */

export type CounterpartyFieldsResult =
  | { ok: true; values: CounterpartyValues }
  | { ok: false; error: string; missing?: string[] };

export async function submitCounterpartyFieldsAction(
  signerToken: string,
  values: unknown,
): Promise<CounterpartyFieldsResult> {
  const token = typeof signerToken === 'string' ? signerToken.trim() : '';
  if (!token) return { ok: false, error: GENERIC_REFUSAL };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable. Try again shortly.' };

  const { data: sigData, error: sigError } = await admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, signer_email, signed_at, response, access_code_hash, access_code_verified_at',
    )
    .eq('token', token)
    .maybeSingle();
  // A token that does not resolve and a database that did not answer are told
  // apart here and NOT to the caller: an unauthenticated surface that
  // distinguished "no such token" from "service trouble" would answer whether
  // a guessed token exists.
  if (sigError) return { ok: false, error: 'Service unavailable. Try again shortly.' };
  if (!sigData) return { ok: false, error: GENERIC_REFUSAL };
  const signature = sigData as {
    id: string;
    signing_request_id: string;
    signer_email: string;
    signed_at: string | null;
    response: string | null;
    access_code_hash: string | null;
    access_code_verified_at: string | null;
  };

  const { data: reqData, error: reqError } = await admin
    .from('firm_signing_requests')
    .select('id, status, document_sha256')
    .eq('id', signature.signing_request_id)
    .maybeSingle();
  if (reqError) return { ok: false, error: 'Service unavailable. Try again shortly.' };
  if (!reqData) return { ok: false, error: GENERIC_REFUSAL };
  const request = reqData as {
    id: string;
    status: string;
    document_sha256: string | null;
  };

  const intake = await loadCounterpartyIntake(admin, signature.signing_request_id);
  // Null covers three states that are one answer to the caller: this document
  // asks for nothing, this request came from a plainly uploaded file, and
  // this firm has not had the migration applied. In all three there is no
  // step to complete, so a call claiming to complete one is not a call this
  // product made.
  const decision = resolveCounterpartySubmission({
    accessCodeRequired: Boolean(signature.access_code_hash),
    accessVerifiedAt: signature.access_code_verified_at,
    requestStatus: request.status,
    signedAt: signature.signed_at,
    signerResponse: signature.response,
    fields: intake?.fields ?? [],
    values,
  });
  if (!decision.ok) {
    return {
      ok: false,
      error: COUNTERPARTY_REFUSAL_COPY[decision.reason],
      missing: decision.missing,
    };
  }

  // Conditional on the signature not having landed. This action and
  // lib/signature-write.ts can be in flight at once (the signer submits the
  // form and the pad in two tabs, or finishes on a phone), and a value
  // written after the signature would change what the signature was over.
  // The database decides, not the read above.
  const { data: written, error: writeError } = await admin
    .from('firm_signatures')
    .update({ counterparty_values: decision.values })
    .eq('id', signature.id)
    .is('signed_at', null)
    .select('id')
    .maybeSingle();
  // PostgREST resolves rather than throws, so a try/catch here would catch
  // nothing. This repo lost a month of audit writes to exactly that.
  if (writeError) {
    return {
      ok: false,
      error:
        'Your details could not be saved just now. Try again, and tell the firm if it keeps happening.',
    };
  }
  if (!written) {
    return { ok: false, error: COUNTERPARTY_REFUSAL_COPY['already-signed'] };
  }

  // The audit event is best effort and never fails the step: the values are
  // on the row either way, and a signer blocked by a logging failure is a
  // signer who cannot sign.
  try {
    const h = headers();
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      signatureId: signature.id,
      signerEmail: signature.signer_email,
      eventType: 'counterparty_fields_submitted',
      ipAddress:
        h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
      userAgent: h.get('user-agent') ?? null,
      // The hash of the BYTES the firm approved, carried so the event says
      // which document these answers belong to. It is not, and must never be
      // conflated with, the hash of the answers themselves below.
      documentSha256: request.document_sha256,
      metadata: {
        // sha256(canonicalizeForHash(values)): key-sorted and JSON-encoded so
        // a later reader can reproduce it from the stored values alone.
        values_sha256: sha256(decision.canonical),
        field_keys: Object.keys(decision.values).sort(),
        field_count: Object.keys(decision.values).length,
        submission_id: intake?.submissionId ?? null,
      },
    });
  } catch {
    /* never block the signer on audit logging */
  }

  return { ok: true, values: decision.values };
}

/**
 * One sentence for every state that is not this signer's to act on.
 *
 * Deliberately the same words whether the token is unknown, the request is
 * gone or the row does not resolve. This endpoint is unauthenticated, and a
 * refusal that varied would answer whether a guessed token exists.
 */
const GENERIC_REFUSAL =
  'This link is no longer active. Ask the firm to send you a new one.';
