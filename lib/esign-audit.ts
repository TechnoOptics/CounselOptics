import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * E-signature audit trail helpers. Every signature-related action
 * (request created, sent, link viewed, signed, completed, canceled)
 * is appended to firm_signature_events with a hash that chains to
 * the previous event for that request. A reader can verify the chain
 * and detect any modification to a recorded event, and any event
 * removed from the middle or the head of it.
 *
 * What the chain does NOT establish is that it holds every event that
 * happened. See verifySignatureChain below: a hash chain is
 * tamper-evident, not gap-evident, and an event that was never written
 * leaves nothing behind to find. That distinction is the whole point
 * for a record offered as evidence, so the verifier states it in its
 * return value rather than leaving a bare ok:true to be read as more
 * than it is.
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
  | 'recalled'
  | 'rejected'
  | 'changes_requested'
  | 'reopened'
  | 'reminder_sent'
  // One-time access-code gate (#5). A code is emailed separately from
  // the sign link to external signers; entering it unlocks the token.
  | 'access_code_sent'
  | 'access_verified'
  | 'access_denied'
  // Final-render lifecycle (lib/signature-render.ts). Emitted after
  // the request flips to 'completed' so a reviewer can tell whether
  // an executed PDF was successfully produced, and how many of the
  // captured signatures actually made it onto the page.
  | 'final_pdf_rendered'
  | 'final_pdf_render_failed'
  // The signer pulled their own copy (app/api/firm/sign/copy). The
  // chain is sold as evidence of what happened to an executed
  // instrument, and retrieval of it is part of that.
  | 'copy_downloaded'
  // The recipient pulled the file itself BEFORE signing: a browser
  // pointed at /api/firm/sign/document/[token] rather than the signing
  // page's own render fetch, which is the request that ends in the
  // browser's PDF viewer with Save and Print on it. Distinct from
  // copy_downloaded, which is retrieval of an EXECUTED instrument after
  // the fact. This one is evidence that the document reached the person
  // in a form they kept, which is the strongest thing short of a
  // signature that a firm can learn about a recipient's behaviour, and
  // it is exactly what a silent request was hiding.
  | 'document_downloaded'
  // A recorded anchor did not fit on its page, so the renderer moved
  // (or shrank) the signature box to keep the whole mark on the page.
  // Relocating beats the old behaviour of letting pdf-lib drop the
  // overflow, but it leaves the executed instrument disagreeing with
  // the firm_signatures row, so the chain records the move: requested
  // vs drawn coordinates, the delta, and the page size that forced it.
  | 'signature_relocated'
  // The counterparty typed the parts of the document that are theirs to
  // supply (app/sign/[token]/counterparty-actions.ts). These values arrive
  // AFTER the firm approved the wording and after document_sha256 was taken,
  // so they are not smuggled into that hash: they get their own event
  // carrying a SHA-256 of the canonicalised values, and the claim the record
  // then supports is stronger than one hash could be. Legal approved these
  // words with these blanks, this person supplied these values at this time
  // from this address, and the executed instrument is the sum of the two.
  | 'counterparty_fields_submitted'
  // A recorded blank did not fit on its page, or the value typed into it
  // could not be drawn at a legible size, so the stamp moved or shrank it.
  // Same reasoning as signature_relocated: the executed instrument then
  // disagrees with the recorded geometry, and the chain is sold as evidence
  // about that instrument.
  | 'counterparty_field_relocated';

// A note that applies to both of the values above, which were added
// without a migration. There is no DDL for firm_signature_events in
// this repo, so the question of whether event_type carries a CHECK
// constraint enumerating its values had to be settled against the live
// database. It was, on 2026-08-06: a duplicate-primary-key insert
// carrying an invented event_type returned 23505 (unique violation)
// rather than 23514 (check violation), which means the value cleared
// every constraint on the table before the index rejected the row.
// There is no CHECK constraint. New values here need no migration.

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

/** An event another record says happened that the chain does not hold. */
export type ChainGap = {
  /** The event that is missing. */
  missing: string;
  /**
   * The row that says it happened, written by a different statement in a
   * different place, which is the only reason its absence is visible.
   */
  attestedBy: string;
};

export type ChainVerification =
  | {
      ok: true;
      events: number;
      /** Events corroborating rows attest to that the chain does not hold. */
      gaps: ChainGap[];
      /**
       * 'intact'      nothing that could be corroborated was missing.
       * 'gap_found'   at least one corroborated event is not in the chain.
       * 'not_checked' the corroborating rows could not be read, or there
       *               is no chain here to check.
       *
       * None of the three means "these are all the events". Nothing in
       * this table can mean that.
       */
      completeness: 'intact' | 'gap_found' | 'not_checked';
      /** Plain words for what ok:true establishes, and what it does not. */
      establishes: string;
    }
  | { ok: false; brokenAt: string; reason: string; events: number };

/**
 * Verify a request's event chain. Walks the events in order and
 * recomputes each event_hash from prev_event_hash + the canonical
 * payload. Returns ok=false with the first broken event id when a
 * recorded event has been modified or removed.
 *
 * What ok=true does and does not mean, since this result is read by
 * people deciding whether to rely on the record:
 *
 * A recorded event that is ALTERED is caught, because its hash no
 * longer matches its payload. An event DELETED from the middle or the
 * head is caught too, because its successor's prev_event_hash no
 * longer matches the event now in front of it and the walk breaks.
 * Neither of those may regress.
 *
 * An event that was NEVER WRITTEN is a different thing entirely, and a
 * hash chain cannot see it by construction. The next writer read
 * whatever the tail was at the time and hashed against that, so the
 * surviving rows are a perfectly consistent chain with a hole in it.
 * The same is true of rows removed from the end: nothing in the table
 * records how many rows there should have been. So the chain is
 * tamper-evident but not gap-evident. It proves these events are
 * unmodified and in order. It does not prove they are all the events.
 *
 * A per-event sequence number was considered and rejected: a sequence
 * is allocated at insert time, so an event that was never written
 * consumes no number and leaves the sequence contiguous, while the one
 * case a sequence would catch (a row deleted from the middle) is
 * already caught by the hash walk above. It would cost a migration and
 * a backfill decision for every existing row to detect nothing new.
 *
 * What CAN be seen is narrower and real. Some events are corroborated
 * by rows written elsewhere, by a different statement: a firm_signatures
 * row carries its own signed_at, and firm_signing_requests carries its
 * own status. When one of those says an event happened and the chain
 * does not hold it, the event was dropped, and that is reported as a
 * gap rather than as a break, because nothing here was tampered with.
 * That check covers only the events that happen to have a corroborating
 * row. Events like link_viewed have none and their absence stays
 * invisible, which is why completeness is never reported as proven.
 */
export async function verifySignatureChain(
  admin: SupabaseClient,
  signingRequestId: string,
): Promise<ChainVerification> {
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

  // The walk passed: every event on record is unmodified and in order.
  // That is a statement about the rows that are here, so the only thing
  // left worth asking is whether a row that should be here is not.
  const completeness = await findChainGaps(admin, signingRequestId, rows);
  return {
    ok: true,
    events: rows.length,
    gaps: completeness.gaps,
    completeness: completeness.state,
    establishes: describeChain(rows.length, completeness),
  };
}

type CompletenessProbe = {
  state: 'intact' | 'gap_found' | 'not_checked';
  gaps: ChainGap[];
  /** Why the probe could not run, when it could not. */
  why: string | null;
};

/**
 * A signature or a completion written within this window may legitimately
 * not have its event yet: lib/signature-write.ts sets signed_at and rolls
 * the request status up before it appends the matching event, so a read
 * landing between the two would see a hole that is about to be filled.
 * A genuinely dropped event never fills, so waiting costs nothing and a
 * false gap on a record offered as evidence costs a great deal.
 */
const GAP_GRACE_MS = 60_000;

/**
 * Look for events that other rows attest to and the chain does not hold.
 *
 * This is deliberately narrow. It is not a completeness proof and cannot
 * become one: it can only see the events that happen to be corroborated
 * by a row some other statement wrote. It exists because that is exactly
 * the shape of the failure the chain is blind to, and because those two
 * writes failing together is far less likely than one of them failing
 * alone.
 */
async function findChainGaps(
  admin: SupabaseClient,
  signingRequestId: string,
  rows: Array<{
    event_type: string;
    signature_id: string | null;
    signer_email: string | null;
  }>,
): Promise<CompletenessProbe> {
  if (rows.length === 0) {
    // No chain here at all. Requests created before the audit trail
    // shipped look like this, and calling that a gap would report every
    // historical request as holed, which is worse than saying nothing.
    return { state: 'not_checked', gaps: [], why: 'no events recorded' };
  }

  const { data: sigData, error: sigErr } = await admin
    .from('firm_signatures')
    .select('id, signer_email, signed_at')
    .eq('signing_request_id', signingRequestId);
  const { data: reqData, error: reqErr } = await admin
    .from('firm_signing_requests')
    .select('status, completed_at')
    .eq('id', signingRequestId)
    .maybeSingle();
  if (sigErr || reqErr) {
    // Could not corroborate. Say so rather than reporting no gaps found,
    // which would read as a clean bill the check never actually gave.
    return {
      state: 'not_checked',
      gaps: [],
      why: sigErr?.message ?? reqErr?.message ?? 'corroborating rows unreadable',
    };
  }

  const signatures = (sigData ?? []) as Array<{
    id: string;
    signer_email: string | null;
    signed_at: string | null;
  }>;
  const request = (reqData ?? null) as {
    status: string;
    completed_at: string | null;
  } | null;

  const settled = (at: string | null): boolean => {
    if (!at) return false;
    const t = new Date(at).getTime();
    return Number.isFinite(t) && Date.now() - t > GAP_GRACE_MS;
  };

  const gaps: ChainGap[] = [];

  const signedEvents = rows.filter((e) => e.event_type === 'signed');
  for (const sig of signatures) {
    if (!settled(sig.signed_at)) continue;
    const email = sig.signer_email?.toLowerCase() ?? null;
    // Match on signature_id, falling back to the signer's address for any
    // event written before the id was carried on it. A loose match here
    // only ever suppresses a finding, never invents one.
    const present = signedEvents.some(
      (e) =>
        e.signature_id === sig.id ||
        (e.signature_id === null &&
          email !== null &&
          e.signer_email?.toLowerCase() === email),
    );
    if (!present) {
      gaps.push({
        missing: `signed event for ${sig.signer_email ?? sig.id}`,
        attestedBy: `firm_signatures.${sig.id} recorded signed_at ${sig.signed_at}`,
      });
    }
  }

  if (
    request?.status === 'completed' &&
    settled(request.completed_at) &&
    !rows.some((e) => e.event_type === 'completed')
  ) {
    gaps.push({
      missing: 'completed event',
      attestedBy: `firm_signing_requests.${signingRequestId} recorded completed_at ${request.completed_at}`,
    });
  }

  return {
    state: gaps.length > 0 ? 'gap_found' : 'intact',
    gaps,
    why: null,
  };
}

/** What a passing verification establishes, in words a reader can rely on. */
function describeChain(events: number, probe: CompletenessProbe): string {
  const base = `The ${events} event${events === 1 ? '' : 's'} on record ${
    events === 1 ? 'is' : 'are'
  } unmodified and in recorded order.`;
  const caveat =
    'A hash chain cannot establish that no further event is missing, because an event that was never written leaves no trace.';
  if (probe.state === 'gap_found') {
    return `${base} ${probe.gaps.length} event${
      probe.gaps.length === 1 ? '' : 's'
    } that other records attest to ${
      probe.gaps.length === 1 ? 'is' : 'are'
    } NOT in the chain. ${caveat}`;
  }
  if (probe.state === 'not_checked') {
    return `${base} Corroborating records were not checked (${probe.why ?? 'reason not recorded'}). ${caveat}`;
  }
  return `${base} Every event corroborated by another record is present. ${caveat}`;
}

/**
 * Compute SHA-256 (hex) of a Buffer or string. Used for
 * document_sha256 and for hashing signer access codes (#5).
 */
export function sha256(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
