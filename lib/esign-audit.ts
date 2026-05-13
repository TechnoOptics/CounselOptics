import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * E-signature audit trail helpers. Every signature-related action
 * (request created, sent, link viewed, signed, completed, canceled)
 * is appended to firm_signature_events with a hash that chains to
 * the previous event for that request. A reader can verify the chain
 * and detect any tampering.
 *
 * UETA-aligned. The technical capture covers the requirements at
 * 15 USC 7001 + UETA Section 7-13: separate electronic-records
 * disclosure consent, hardware/software confirmation, intent-to-sign
 * affirmation, document hash captured at request creation,
 * tamper-evident hash chain, IP + user-agent provenance per event.
 * Whether the resulting signature is binding for a specific document
 * class in a specific jurisdiction (real estate conveyances, wills,
 * UCC instruments etc. are carved out under various state laws) is
 * a question for the relying party's counsel - this module just
 * ships the technical layer.
 */

export type SignatureEventType =
  | 'request_created'
  | 'request_sent'
  | 'link_viewed'
  | 'signed'
  | 'completed'
  | 'canceled'
  | 'reminder_sent';

type EventInput = {
  signingRequestId: string;
  signatureId?: string | null;
  eventType: SignatureEventType;
  userId?: string | null;
  signerEmail?: string | null;
  signerName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  documentSha256?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append a signature event with a hash chain. Reads the most recent
 * event_hash for the same signing_request_id, computes
 * sha256(prev_event_hash || canonical_payload), and inserts. Returns
 * the inserted row id + event_hash for callers that want to surface
 * the hash to the user.
 *
 * The function is intentionally permissive on errors - the firm's
 * actual signature row stays the source of truth, and a missed
 * event log entry must never block a signing flow. We log + return
 * a synthetic hash on failure.
 */
export async function appendSignatureEvent(
  admin: SupabaseClient,
  input: EventInput,
): Promise<{ id: string | null; eventHash: string }> {
  // Pull the latest event for this request to chain off.
  let prevHash: string | null = null;
  try {
    const { data } = await admin
      .from('firm_signature_events')
      .select('event_hash')
      .eq('signing_request_id', input.signingRequestId)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = data?.[0] as { event_hash: string } | undefined;
    prevHash = row?.event_hash ?? null;
  } catch {
    /* fall through with prevHash null */
  }

  const ts = new Date().toISOString();
  const payload = JSON.stringify({
    request: input.signingRequestId,
    signature: input.signatureId ?? null,
    type: input.eventType,
    user: input.userId ?? null,
    email: input.signerEmail?.toLowerCase() ?? null,
    name: input.signerName ?? null,
    ip: input.ipAddress ?? null,
    ua: input.userAgent ?? null,
    doc: input.documentSha256 ?? null,
    ts,
  });
  const eventHash = crypto
    .createHash('sha256')
    .update((prevHash ?? '') + '|' + payload)
    .digest('hex');

  try {
    const { data, error } = await admin
      .from('firm_signature_events')
      .insert({
        signing_request_id: input.signingRequestId,
        signature_id: input.signatureId ?? null,
        event_type: input.eventType,
        user_id: input.userId ?? null,
        signer_email: input.signerEmail?.toLowerCase() ?? null,
        signer_name: input.signerName ?? null,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        document_sha256: input.documentSha256 ?? null,
        prev_event_hash: prevHash,
        event_hash: eventHash,
        metadata: input.metadata ?? {},
        created_at: ts,
      })
      .select('id')
      .single();
    if (error) {
      console.warn(
        '[appendSignatureEvent] insert failed; signing flow continues',
        error.message,
      );
      return { id: null, eventHash };
    }
    return { id: (data as { id: string }).id, eventHash };
  } catch (err) {
    console.warn(
      '[appendSignatureEvent] threw; signing flow continues',
      err instanceof Error ? err.message : err,
    );
    return { id: null, eventHash };
  }
}

/**
 * Verify a request's event chain. Walks the events in order and
 * recomputes each event_hash from prev_event_hash + the canonical
 * payload. Returns ok=true with the count of events when the chain
 * is intact; ok=false with the first broken event id otherwise.
 *
 * Used by the audit-trail viewer to surface "Chain verified" or
 * "Chain BROKEN at event X" to operators.
 */
export async function verifySignatureChain(
  admin: SupabaseClient,
  signingRequestId: string,
): Promise<
  | { ok: true; events: number }
  | { ok: false; brokenAt: string; reason: string; events: number }
> {
  const { data, error } = await admin
    .from('firm_signature_events')
    .select(
      'id, signing_request_id, signature_id, event_type, user_id, signer_email, signer_name, ip_address, user_agent, document_sha256, prev_event_hash, event_hash, created_at',
    )
    .eq('signing_request_id', signingRequestId)
    .order('created_at', { ascending: true });
  if (error || !data) {
    return {
      ok: false,
      brokenAt: '',
      reason: error?.message ?? 'Could not load events.',
      events: 0,
    };
  }
  const rows = data as Array<{
    id: string;
    signing_request_id: string;
    signature_id: string | null;
    event_type: string;
    user_id: string | null;
    signer_email: string | null;
    signer_name: string | null;
    ip_address: string | null;
    user_agent: string | null;
    document_sha256: string | null;
    prev_event_hash: string | null;
    event_hash: string;
    created_at: string;
  }>;
  let lastHash: string | null = null;
  for (const e of rows) {
    if ((e.prev_event_hash ?? null) !== lastHash) {
      return {
        ok: false,
        brokenAt: e.id,
        reason: 'prev_event_hash does not match the previous event.',
        events: rows.length,
      };
    }
    // Audit 2026-05-12 (V2) P0-2 fix: the inserter hashes
    // `ts = new Date().toISOString()` which produces the canonical
    // `2026-05-05T15:22:53.135Z` form. PostgREST returns the same
    // timestamptz back as `2026-05-05T15:22:53.135+00:00` (with
    // `+00:00` offset, no `Z`). Feeding `e.created_at` directly into
    // the hash compares the right bytes to the wrong string and
    // raises a false-positive chain break. Round-tripping through
    // `new Date(...).toISOString()` normalizes back to the form the
    // inserter used.
    const normalizedTs = (() => {
      try {
        return new Date(e.created_at).toISOString();
      } catch {
        return e.created_at;
      }
    })();
    const payload = JSON.stringify({
      request: e.signing_request_id,
      signature: e.signature_id,
      type: e.event_type,
      user: e.user_id,
      email: e.signer_email?.toLowerCase() ?? null,
      name: e.signer_name,
      ip: e.ip_address,
      ua: e.user_agent,
      doc: e.document_sha256,
      ts: normalizedTs,
    });
    const recomputed: string = crypto
      .createHash('sha256')
      .update((lastHash ?? '') + '|' + payload)
      .digest('hex');
    if (recomputed !== e.event_hash) {
      return {
        ok: false,
        brokenAt: e.id,
        reason: 'event_hash does not match the canonical payload.',
        events: rows.length,
      };
    }
    lastHash = e.event_hash;
  }
  return { ok: true, events: rows.length };
}

/** Compute SHA-256 of a Buffer. Used for document_sha256. */
export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
