import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  desktopConsentForHandoff,
  handoffStateForCookie,
  hashHandoffToken,
  mintHandoffToken,
  HANDOFF_TTL_MINUTES,
  type DesktopDisclosureConsent,
  type HandoffRow,
  type HandoffState,
} from '@/lib/signing-handoff';

/**
 * The only module that reads or writes firm_signature_handoffs.
 *
 * server-only, because every export here bypasses RLS through the
 * admin client by design: the table has RLS on and no policy, so it is
 * closed to every client and reachable only from here.
 *
 * There is no decision logic in this file. Whether a handoff may be
 * claimed, refreshed or refused is decided by lib/signing-handoff.ts,
 * which is pure and unit tested. This module fetches rows, hands them
 * to that decision, and writes the result.
 */

export const HANDOFF_COOKIE = 'adv_sign_handoff';

export type ClaimResult =
  | { ok: true; signatureId: string; sessionSecret: string }
  | { ok: false; state: Exclude<HandoffState, 'claimable' | 'bound'> };

/**
 * `desktopConsent` is the disclosure the signer already affirmed on the
 * laptop. It is stored on the handoff so the phone's submit can record
 * it, and so the evidence sits on the same row as the scan time, IP and
 * user agent of the device that used it.
 */
export async function createHandoff(
  signatureId: string,
  desktopConsent: DesktopDisclosureConsent | null = null,
): Promise<{ ok: true; rawToken: string } | { ok: false }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false };

  const rawToken = mintHandoffToken();
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000);

  const { error } = await admin.from('firm_signature_handoffs').insert({
    signature_id: signatureId,
    token_hash: hashHandoffToken(rawToken),
    expires_at: expiresAt.toISOString(),
    desktop_consent: desktopConsent,
  });
  // PostgREST resolves with { error } rather than throwing, so this
  // check is the only thing standing between a failed insert and a QR
  // that encodes a token no row will ever match.
  if (error) return { ok: false };

  return { ok: true, rawToken };
}

/** Read the handoff joined to the one fact about the signature we need. */
async function readRow(rawToken: string) {
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data } = await admin
    .from('firm_signature_handoffs')
    .select(
      'id, signature_id, token_hash, session_hash, created_at, expires_at, consumed_at, desktop_consent, firm_signatures!inner(signed_at)',
    )
    .eq('token_hash', hashHandoffToken(rawToken))
    .maybeSingle();

  if (!data) return null;

  const raw = data as unknown as {
    id: string;
    signature_id: string;
    token_hash: string;
    session_hash: string | null;
    created_at: string;
    expires_at: string;
    consumed_at: string | null;
    desktop_consent: unknown;
    firm_signatures: { signed_at: string | null };
  };

  // Timestamps stay as the ISO strings PostgREST returned. HandoffRow
  // accepts either form and lib/signing-handoff.ts normalises them,
  // refusing anything unparseable rather than comparing an Invalid Date
  // that would read as never expired.
  const row: HandoffRow = {
    tokenHash: raw.token_hash,
    sessionHash: raw.session_hash,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at,
    consumedAt: raw.consumed_at,
    signatureSignedAt: raw.firm_signatures.signed_at,
  };

  // Re-validated on the way out through the same function that
  // validated it on the way in, so a blob that was hand-edited, written
  // by an older build, or left null cannot become evidence by sitting
  // in a column.
  const desktopConsent = desktopConsentForHandoff(
    raw.desktop_consent as Parameters<typeof desktopConsentForHandoff>[0],
  );

  return { id: raw.id, signatureId: raw.signature_id, row, desktopConsent };
}

/**
 * First GET consumes the token and binds it to this device.
 *
 * The update is conditional on consumed_at still being null, so two
 * phones scanning the same screen in the same instant cannot both
 * claim it. The loser sees the same wording as any other dead code.
 */
export async function claimHandoff(
  rawToken: string,
  ip: string | null,
  userAgent: string | null,
): Promise<ClaimResult> {
  const admin = createAdminSupabase();
  const found = admin ? await readRow(rawToken) : null;
  if (!admin || !found) return { ok: false, state: 'consumed' };

  // No cookie is presented on a claim by definition: this is the first
  // time this device has been seen.
  const state = handoffStateForCookie(found.row, new Date(), null);
  if (state === 'bound') {
    // Cannot happen with no cookie presented, but fail closed.
    return { ok: false, state: 'consumed' };
  }
  if (state !== 'claimable') return { ok: false, state };

  // Same generator as the token itself: a url-safe random secret with
  // 256 bits behind it. Only its hash is stored, for the same reason
  // only the token's hash is.
  const sessionSecret = mintHandoffToken();

  const { data: updated } = await admin
    .from('firm_signature_handoffs')
    .update({
      consumed_at: new Date().toISOString(),
      session_hash: hashHandoffToken(sessionSecret),
      consumed_ip: ip,
      consumed_user_agent: userAgent,
    })
    .eq('id', found.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  // No row came back, so the .is('consumed_at', null) filter matched
  // nothing: another device claimed it between the read and the write.
  if (!updated) return { ok: false, state: 'consumed' };

  return { ok: true, signatureId: found.signatureId, sessionSecret };
}

/**
 * Every request after the claim.
 *
 * The raw cookie goes in and is hashed inside handoffStateForCookie, so
 * no caller here compares a value it hashed itself or forgot to hash.
 */
export async function loadBoundHandoff(
  rawToken: string,
  presentedSessionSecret: string | null,
): Promise<
  | {
      ok: true;
      signatureId: string;
      handoffId: string;
      /** The disclosure the laptop affirmed before minting this code. */
      desktopConsent: DesktopDisclosureConsent | null;
    }
  | { ok: false; state: HandoffState }
> {
  const found = await readRow(rawToken);
  if (!found) return { ok: false, state: 'consumed' };

  const state = handoffStateForCookie(
    found.row,
    new Date(),
    presentedSessionSecret,
  );
  if (state !== 'bound') return { ok: false, state };

  return {
    ok: true,
    signatureId: found.signatureId,
    handoffId: found.id,
    desktopConsent: found.desktopConsent,
  };
}

/** The two names the phone pad puts on screen. */
export type HandoffPadContext = {
  signerLabel: string;
  documentName: string;
};

/**
 * What the pad may know about the signature it is about to write.
 *
 * The column list is explicit, and firm_signatures.token is deliberately
 * not in it. That token is the durable signing credential, and for an
 * internal signer it is on its own sufficient to sign as that person, so
 * it must never travel to a page reached by scanning a code off a
 * screen. The handoff exists precisely so that it does not have to.
 */
export async function loadHandoffPadContext(
  signatureId: string,
): Promise<HandoffPadContext | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select('signer_name, signer_email, signing_request_id')
    .eq('id', signatureId)
    .maybeSingle();
  if (!sigRow) return null;
  const sig = sigRow as {
    signer_name: string | null;
    signer_email: string;
    signing_request_id: string;
  };

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('document_id')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  const documentId = (reqRow as { document_id?: string } | null)?.document_id;

  let documentName = 'this document';
  if (documentId) {
    const { data: docRow } = await admin
      .from('firm_documents')
      .select('name')
      .eq('id', documentId)
      .maybeSingle();
    documentName = (docRow as { name?: string } | null)?.name || documentName;
  }

  return {
    signerLabel: sig.signer_name?.trim() || sig.signer_email,
    documentName,
  };
}
