'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import { loadCaseContext, computeEventAnalysis, mergeStickyExtracted } from './case-evidence';
import { getFirmFaceSetting } from './face-settings';
import type { AiExtracted, TimelineMedia, TimelineKind } from './timeline-types';

/**
 * Bulk re-analysis of a whole matter's evidence: re-runs the extraction over
 * EVERY item at once, for when uploads landed before analysis was configured, a
 * case's facts changed, or a batch came in unscored. It reuses the shared
 * evidence engine (lib/case-evidence.ts) directly and is firm-scoped through the
 * admin client (firm members are not case members), mirroring
 * lib/case-evidence-actions.ts.
 *
 * The heavy work is driven in small batches from the client: it lists the event
 * ids, then calls the batch action in chunks so progress is visible and no
 * single server invocation runs long enough to hit a serverless limit. The
 * always-on cron sweep (analyzePendingEvidence) backstops anything the browser
 * doesn't get to.
 *
 * Two protections carried over from the background sweep: a hand-corrected item
 * (ai_extracted.edited_at) is left untouched unless `force` is set, and a
 * deliberately-filed folder (folder_locked) is preserved across the re-run.
 */

/** Cap on how many items one batch call will re-analyse (bounds invocation time). */
const MAX_BATCH = 12;

/** The current user is a member of `firmId` AND `caseId` belongs to that firm. */
async function assertFirmCase(
  firmId: string,
  caseId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You do not have access to this firm.' };
  const { data: kase } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'That matter is not in this firm.' };
  return { ok: true, userId: user.id };
}

/**
 * List every evidence item in a matter so the client can drive a batched
 * re-analysis. Also reports whether recurring-face detection is on, so the UI
 * can offer to rescan faces in the same pass.
 */
export async function listCaseEvidenceForReanalysisAction(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; eventIds?: string[]; total?: number; facesEnabled?: boolean }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!aiConfigured()) return { ok: false, error: 'Evidence analysis is not configured.' };
  if ((await resolveTimelineAccess()) !== 'firm') {
    return { ok: false, error: 'Evidence analysis is a firm-plan feature.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_timeline_events')
    .select('id')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  const eventIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const faces = await getFirmFaceSetting(admin, firmId);
  return { ok: true, eventIds, total: eventIds.length, facesEnabled: faces.enabled };
}

type BulkRow = {
  id: string;
  kind: TimelineKind;
  title: string | null;
  description: string | null;
  media: TimelineMedia[] | null;
  occurred_at: string | null;
  ai_extracted: AiExtracted | null;
};

/**
 * Re-analyse one client-supplied batch of a matter's items. Reprocesses items
 * whatever their current status (so already-done items are re-scored too, which
 * is what makes this a full re-analysis rather than a pending-only sweep).
 */
export async function reanalyzeCaseEvidenceBatchAction(
  firmId: string,
  caseId: string,
  eventIds: string[],
  opts?: { force?: boolean },
): Promise<{ ok: boolean; error?: string; analyzed?: number; failed?: number; skipped?: number }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!aiConfigured()) return { ok: false, error: 'Evidence analysis is not configured.' };
  if ((await resolveTimelineAccess()) !== 'firm') {
    return { ok: false, error: 'Evidence analysis is a firm-plan feature.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const ids = Array.from(new Set((eventIds ?? []).filter((s) => typeof s === 'string'))).slice(0, MAX_BATCH);
  if (!ids.length) return { ok: false, error: 'Nothing to re-analyse.' };

  const { data } = await admin
    .from('case_timeline_events')
    .select('id, kind, title, description, media, occurred_at, ai_extracted')
    .eq('case_id', caseId)
    .in('id', ids);
  const rows = (data ?? []) as BulkRow[];

  const caseContext = await loadCaseContext(admin, caseId);
  let analyzed = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows) {
    const prior = (r.ai_extracted ?? {}) as AiExtracted;
    // Respect a hand correction unless the caller explicitly forces a re-run.
    if (prior.edited_at && !opts?.force) {
      skipped++;
      continue;
    }
    try {
      await admin.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', r.id);
      const outcome = await computeEventAnalysis({
        ev: {
          id: r.id,
          media: Array.isArray(r.media) ? r.media : [],
          description: r.description,
          kind: r.kind,
          occurredAt: r.occurred_at,
          title: r.title ?? '',
        },
        admin,
        caseContext,
      });
      // Carry exhibit number, hash, and any hand-pinned folder across the re-run.
      if (outcome.ok && outcome.patch.ai_extracted) {
        outcome.patch.ai_extracted = mergeStickyExtracted(outcome.patch.ai_extracted as AiExtracted, prior);
      }
      await admin.from('case_timeline_events').update(outcome.patch).eq('id', r.id);
      if (outcome.ok) analyzed++;
      else failed++;
    } catch (err) {
      failed++;
      try {
        await admin
          .from('case_timeline_events')
          .update({ ai_status: 'error', ai_error: err instanceof Error ? err.message : 'Analysis failed.' })
          .eq('id', r.id);
      } catch {
        /* best-effort */
      }
    }
  }

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, analyzed, failed, skipped };
}
