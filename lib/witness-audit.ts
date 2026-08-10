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
 * Surface a dropped witness audit write.
 *
 * Two things have to be true at once here, and only one of them was.
 *
 * The first is the intent already stated at the call sites: never block a
 * submission on an audit-log write failure. The witness_submissions row is
 * the source of truth, a witness handing over evidence is often doing it
 * once and under pressure, and turning them away because an event log
 * refused a row would lose the thing that actually matters to save the
 * record of it. That stays.
 *
 * The second is that a failure has to be loud. An audit trail that can fail
 * invisibly is worse than no audit trail, because it is trusted. `warn` is
 * the channel this codebase uses for things that are merely unusual, and a
 * dropped audit event is not unusual, it is a hole in a record offered as
 * evidence.
 *
 * This is the established mechanism, not a new one: `reportAuditFailure` in
 * lib/security-audit.ts does exactly this, for exactly this reason, for
 * security_events. That helper is private to a `server-only` module and its
 * signature is keyed to SecurityEventKind, so this follows the pattern
 * rather than importing it.
 *
 * What this deliberately does NOT do is write the failure to the
 * security_events table as a durable row. That would need a new
 * SecurityEventKind, and lib/security-audit.ts records that whether the live
 * `kind` column accepts a new value is unconfirmed and needs a probe against
 * the running database. A durable record of dropped audit writes is worth
 * having and is left as an owner's call.
 */
function reportWitnessAuditFailure(
  eventType: WitnessEventType,
  reason: string,
): void {
  console.error(
    `[appendWitnessEvent] failed to record witness event "${eventType}": ${reason}`,
  );
}
