'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import {
  importFileAsCaseEvidence,
  loadCaseContext,
  computeEventAnalysis,
  MAX_EVIDENCE_BYTES,
  type CaseContext,
} from './case-evidence';
import { fetchRemoteEvidence } from './remote-fetch';
import {
  sortTimeline,
  type TimelineEvent,
  type TimelineMedia,
  type AiExtracted,
  type TimelineKind,
  type OccurredPrecision,
} from './timeline-types';

/**
 * Firm-scoped evidence intake for a matter. These actions are the firm
 * counterpart of the consumer timeline actions: because case_timeline_events
 * RLS is case-membership only (which firm members are not), every read + write
 * here goes through the admin client, gated on the caller being a member of the
 * matter's firm AND the case belonging to that firm. This mirrors
 * createFirmCaseAction, which writes firm cases through admin for the same
 * reason.
 */

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

type EventRow = {
  id: string; case_id: string; created_by: string;
  occurred_at: string | null; occurred_precision: OccurredPrecision;
  kind: TimelineKind; title: string; description: string | null;
  media: TimelineMedia[] | null; source_label: string | null;
  ai_summary: string | null; ai_extracted: AiExtracted | null;
  ai_status: TimelineEvent['aiStatus']; ai_error: string | null;
  people: string[] | null; position: number;
  created_at: string; updated_at: string;
};

function toEvent(r: EventRow): TimelineEvent {
  return {
    id: r.id, caseId: r.case_id, createdBy: r.created_by,
    occurredAt: r.occurred_at, occurredPrecision: r.occurred_precision,
    kind: r.kind, title: r.title, description: r.description,
    media: Array.isArray(r.media) ? r.media : [], sourceLabel: r.source_label,
    aiSummary: r.ai_summary, aiExtracted: r.ai_extracted ?? {},
    aiStatus: r.ai_status, aiError: r.ai_error,
    people: Array.isArray(r.people) ? r.people : [], position: r.position,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Read this matter's evidence timeline (admin, firm-scoped). */
export async function getFirmCaseTimeline(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; events?: TimelineEvent[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_timeline_events')
    .select('*')
    .eq('case_id', caseId);
  const events = sortTimeline(((data ?? []) as EventRow[]).map(toEvent));
  return { ok: true, events };
}

/**
 * Bulk import a batch of dropped files as evidence timeline entries. Accepts
 * images, video, PDFs/docs, and email files (.eml / .msg). Each file is stored
 * to the exhibits bucket and gets its own case_timeline_events row, analysed
 * inline when the firm plan includes timeline analysis. The client sends files
 * in small batches so it can show progress and stay within request limits.
 */
export async function bulkImportCaseEvidenceAction(
  firmId: string,
  caseId: string,
  formData: FormData,
  opts?: { analyze?: boolean },
): Promise<{ ok: boolean; error?: string; imported?: number; failed?: number; errors?: string[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const files = formData
    .getAll('files')
    .filter((f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0);
  if (files.length === 0) return { ok: false, error: 'Choose at least one file.' };

  // Inline analysis is skipped when the caller opts out (large drops import
  // fast and get scored afterwards via analyzeFirmCaseEventAction), so a
  // thousand-file intake isn't gated on a thousand sequential model calls.
  const aiEligible =
    opts?.analyze !== false && aiConfigured() && (await resolveTimelineAccess()) === 'firm';
  const caseContext: CaseContext | null = aiEligible ? await loadCaseContext(admin, caseId) : null;

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  // Safety cap per request; the client packs batches well under this and under
  // the 50 MB server-action body limit, so this only bounds a malformed request.
  for (const f of files.slice(0, 25)) {
    try {
      if (f.size > MAX_EVIDENCE_BYTES) {
        failed++;
        errors.push(`${f.name}: over the 50 MB limit.`);
        continue;
      }
      const buffer = Buffer.from(await f.arrayBuffer());
      const res = await importFileAsCaseEvidence({
        admin,
        caseId,
        userId: gate.userId,
        buffer,
        name: f.name,
        mime: f.type || 'application/octet-stream',
        sourceLabel: 'Bulk intake',
        analyze: aiEligible,
        caseContext,
      });
      if (res.ok) imported++;
      else {
        failed++;
        if (res.error) errors.push(`${f.name}: ${res.error}`);
      }
    } catch (err) {
      failed++;
      errors.push(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: imported > 0, imported, failed, errors: errors.slice(0, 8) };
}

/**
 * Import evidence dragged in from a *browser* (an image or link), where the
 * drop hands us URLs rather than files. The browser can't fetch those
 * cross-origin (CORS), so we download them server-side via the SSRF-guarded
 * fetchRemoteEvidence, then run each through the same import pipeline as a
 * dropped file (storage-side magic-byte validation + optional analysis).
 */
export async function importCaseEvidenceFromUrlsAction(
  firmId: string,
  caseId: string,
  urls: string[],
): Promise<{ ok: boolean; error?: string; imported?: number; failed?: number; errors?: string[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const clean = Array.from(
    new Set(
      (urls ?? [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter((u) => /^https?:\/\//i.test(u)),
    ),
  ).slice(0, 8);
  if (clean.length === 0) return { ok: false, error: 'Nothing importable was dropped.' };

  const aiEligible = aiConfigured() && (await resolveTimelineAccess()) === 'firm';
  const caseContext: CaseContext | null = aiEligible ? await loadCaseContext(admin, caseId) : null;

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const url of clean) {
    try {
      const fetched = await fetchRemoteEvidence(url, MAX_EVIDENCE_BYTES);
      if (!fetched.ok) {
        failed++;
        errors.push(`${url}: ${fetched.error}`);
        continue;
      }
      const res = await importFileAsCaseEvidence({
        admin,
        caseId,
        userId: gate.userId,
        buffer: fetched.file.buffer,
        name: fetched.file.name,
        mime: fetched.file.mime,
        sourceLabel: 'Dropped from web',
        analyze: aiEligible,
        caseContext,
      });
      if (res.ok) imported++;
      else {
        failed++;
        if (res.error) errors.push(`${url}: ${res.error}`);
      }
    } catch (err) {
      failed++;
      errors.push(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: imported > 0, imported, failed, errors: errors.slice(0, 8) };
}

/** Re-run analysis on one evidence entry (admin, firm-scoped). */
export async function analyzeFirmCaseEventAction(
  firmId: string,
  caseId: string,
  eventId: string,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!aiConfigured()) return { ok: false, error: 'AI analysis is not configured.' };
  if ((await resolveTimelineAccess()) !== 'firm') {
    return { ok: false, error: 'Timeline analysis is a firm-plan feature.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: row } = await admin
    .from('case_timeline_events').select('*').eq('id', eventId).eq('case_id', caseId).maybeSingle();
  if (!row) return { ok: false, error: 'Not found.' };
  const ev = toEvent(row as EventRow);

  await admin.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', eventId);
  const caseContext = await loadCaseContext(admin, caseId);
  const outcome = await computeEventAnalysis({ ev, admin, caseContext });
  const { data: updated } = await admin
    .from('case_timeline_events').update(outcome.patch).eq('id', eventId).select('*').single();

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: outcome.ok, error: outcome.error, event: updated ? toEvent(updated as EventRow) : ev };
}

/** Delete one evidence entry + its stored media (admin, firm-scoped). */
export async function deleteFirmCaseEventAction(
  firmId: string,
  caseId: string,
  eventId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data: row } = await admin
    .from('case_timeline_events').select('media').eq('id', eventId).eq('case_id', caseId).maybeSingle();
  const media = (row as { media: TimelineMedia[] | null } | null)?.media;
  if (Array.isArray(media) && media.length) {
    await admin.storage.from('exhibits').remove(media.map((m) => m.path)).catch(() => {});
  }
  const { error } = await admin
    .from('case_timeline_events').delete().eq('id', eventId).eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true };
}

/** Short-TTL signed URL for an evidence file (admin, firm-scoped). */
export async function getFirmEvidenceMediaUrl(
  firmId: string,
  caseId: string,
  path: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  // The path is namespaced under the case (userId/caseId/timeline/...); confirm
  // it belongs to this case before minting a URL.
  if (!path.includes(`/${caseId}/timeline/`)) return { ok: false, error: 'File not in this matter.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin.storage.from('exhibits').createSignedUrl(path, 600);
  return data?.signedUrl ? { ok: true, url: data.signedUrl } : { ok: false, error: 'Could not open.' };
}
