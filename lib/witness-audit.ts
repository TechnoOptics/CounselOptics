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
    const { data } = await admin
      .from('witness_submission_events')
      .select('event_hash')
      .eq('submission_id', input.submissionId)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = data?.[0] as { event_hash: string } | undefined;
    prevHash = row?.event_hash ?? null;
  } catch {
    /* fall through with prevHash null */
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
    await admin.from('witness_submission_events').insert({
      submission_id: input.submissionId,
      event_type: input.eventType,
      actor_user_id: input.actorUserId ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
      prev_event_hash: prevHash,
      event_hash: eventHash,
      created_at: ts,
    });
  } catch (err) {
    // Never block a submission on an audit-log write failure - the
    // submission row itself stays the source of truth.
    console.warn(
      '[appendWitnessEvent] insert failed; submission flow continues',
      err instanceof Error ? err.message : err,
    );
  }
}
