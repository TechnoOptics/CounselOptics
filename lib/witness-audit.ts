import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Audit trail for witness_submissions, mirroring the hash-chain pattern
 * in lib/esign-audit.ts (appendSignatureEvent) but scoped to Community
 * Case submissions rather than firm signing requests. Kept as its own
 * small module rather than generalizing esign-audit.ts, since the two
 * event tables have different columns/lifecycles and forcing a shared
 * abstraction over both would obscure more than it'd save.
 */

export type WitnessEventType =
  | 'submitted'
  | 'viewed_by_organizer'
  | 'exported'
  | 'flagged'
  | 'purge_scheduled'
  | 'purged';

type EventInput = {
  submissionId: string;
  eventType: WitnessEventType;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function appendWitnessEvent(
  admin: SupabaseClient,
  input: EventInput,
): Promise<void> {
  let prevHash: string | null = null;
  try {
    const { data, error } = await admin
      .from('witness_submission_events')
      .select('event_hash')
      .eq('submission_id', input.submissionId)
      .order('created_at', { ascending: false })
      .limit(1);
    // Same postgrest-js contract as the insert below: a failed read
    // resolves with `{ error }` and a null `data`. Left uninspected it
    // is indistinguishable from "this submission has no events yet",
    // so the event that follows would chain off null and start a
    // second chain behind the first, silently, in a table sold as a
    // record of what happened. Report it and carry on.
    if (error) {
      reportWitnessAuditFailure(
        input.eventType,
        `could not read the previous event: ${error.message}`,
      );
    }
    const row = data?.[0] as { event_hash: string } | undefined;
    prevHash = row?.event_hash ?? null;
  } catch (err) {
    reportWitnessAuditFailure(
      input.eventType,
      `previous-event read threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const ts = new Date().toISOString();
  const payload = JSON.stringify({
    submission: input.submissionId,
    type: input.eventType,
    actor: input.actorUserId ?? null,
    ip: input.ipAddress ?? null,
    ua: input.userAgent ?? null,
    ts,
  });
  const eventHash = crypto
    .createHash('sha256')
    .update((prevHash ?? '') + '|' + payload)
    .digest('hex');

  try {
    // NOTE: postgrest-js resolves with `{ error }` instead of throwing, so
    // this result MUST be inspected. The `try/catch` around it never saw a
    // rejected insert, which meant a dropped audit event looked exactly
    // like a written one. `.select('id').single()` asks the database which
    // row was actually written, the same way appendSignatureEvent in
    // lib/esign-audit.ts does.
    const { error } = await admin
      .from('witness_submission_events')
      .insert({
        submission_id: input.submissionId,
        event_type: input.eventType,
        actor_user_id: input.actorUserId ?? null,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        metadata: input.metadata ?? {},
        prev_event_hash: prevHash,
        event_hash: eventHash,
        created_at: ts,
      })
      .select('id')
      .single();
    if (error) {
      // Never block a submission on an audit-log write failure - the
      // submission row itself stays the source of truth.
      reportWitnessAuditFailure(
        input.eventType,
        `${error.message}${error.code ? ` (${error.code})` : ''}`,
      );
    }
  } catch (err) {
    reportWitnessAuditFailure(
      input.eventType,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Surface a dropped witness audit write. Kept non-throwing on purpose: a
 * witness submitting evidence must not be turned away because the event
 * log refused a row. Loud rather than silent, though, because the whole
 * value of this table is that it is believed.
 */
function reportWitnessAuditFailure(
  eventType: WitnessEventType,
  reason: string,
): void {
  console.warn(
    `[appendWitnessEvent] failed to record witness event "${eventType}": ${reason}`,
  );
}
