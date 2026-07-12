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
  mergeStickyExtracted,
  MAX_EVIDENCE_BYTES,
  type CaseContext,
} from './case-evidence';
import { fetchRemoteEvidence } from './remote-fetch';
import {
  sortTimeline,
  normalizeFolder,
  folderForEvent,
  formatOccurred,
  exhibitLabel,
  capturedAt,
  type TimelineEvent,
  type TimelineMedia,
  type AiExtracted,
  type TimelineKind,
  type OccurredPrecision,
  type EvidenceEdit,
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
  // The membership and case-ownership checks are independent, so run them in
  // one parallel wave instead of two serial round-trips. This gate fronts all
  // 15 firm evidence actions (list/upload/delete/analyze), so shaving a
  // round-trip here compounds across the whole intake.
  const [memberRes, caseRes] = await Promise.all([
    supabase.from('firm_members').select('id').eq('firm_id', firmId).eq('user_id', user.id).maybeSingle(),
    supabase.from('cases').select('id').eq('id', caseId).eq('firm_id', firmId).maybeSingle(),
  ]);
  if (!memberRes.data) return { ok: false, error: 'You do not have access to this firm.' };
  if (!caseRes.data) return { ok: false, error: 'That matter is not in this firm.' };
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

/** The highest exhibit number already used in this matter (0 when none). */
async function maxExhibitNo(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  caseId: string,
): Promise<number> {
  const { data } = await admin
    .from('case_timeline_events')
    .select('ai_extracted')
    .eq('case_id', caseId);
  let max = 0;
  for (const r of (data ?? []) as { ai_extracted: AiExtracted | null }[]) {
    const n = r.ai_extracted?.exhibit_no;
    if (typeof n === 'number' && n > max) max = n;
  }
  return max;
}

/**
 * Give every item that lacks one a stable exhibit number, assigned in creation
 * order, and persist it. Numbers are assigned exactly once and never reshuffled,
 * so a given item keeps its label as others are added or removed. New imports
 * are numbered at import time, so this only ever writes for legacy rows (or a
 * rare gap), and is a pure read once every item is numbered. Mutates `events` in
 * place so the caller returns the freshly numbered rows.
 */
async function backfillExhibitNumbers(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  caseId: string,
  events: TimelineEvent[],
): Promise<void> {
  const missing = events
    .filter((e) => typeof e.aiExtracted?.exhibit_no !== 'number')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (missing.length === 0) return;
  let next = 0;
  for (const e of events) {
    const n = e.aiExtracted?.exhibit_no;
    if (typeof n === 'number' && n > next) next = n;
  }
  for (const e of missing) {
    next += 1;
    const ext: AiExtracted = { ...(e.aiExtracted ?? {}), exhibit_no: next };
    const { error } = await admin
      .from('case_timeline_events')
      .update({ ai_extracted: ext })
      .eq('id', e.id)
      .eq('case_id', caseId);
    if (!error) e.aiExtracted = ext;
  }
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
  await backfillExhibitNumbers(admin, caseId, events);
  // Payload trim (phase 1): the forensic `metadata` array is only ever read by
  // the export (which reloads full rows through its own bundle) and is rendered
  // nowhere in the evidence route. Strip it from the list payload the client
  // downloads - a free ~30KB cut on a heavy matter with zero feature loss.
  for (const e of events) {
    if (e.aiExtracted?.metadata) {
      const { metadata: _drop, ...rest } = e.aiExtracted;
      e.aiExtracted = rest;
    }
  }
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
  opts?: { analyze?: boolean; replaceHashes?: string[] },
): Promise<{ ok: boolean; error?: string; imported?: number; failed?: number; errors?: string[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const files = formData
    .getAll('files')
    .filter((f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0);
  if (files.length === 0) return { ok: false, error: 'Choose at least one file.' };

  // "Replace" duplicates: drop the prior item(s) whose bytes match, so the fresh
  // upload takes their place rather than sitting alongside them.
  if (opts?.replaceHashes?.length) {
    await deleteEventsByHashes(admin, caseId, opts.replaceHashes);
  }

  // Inline analysis is skipped when the caller opts out (large drops import
  // fast and get scored afterwards via analyzeFirmCaseEventAction), so a
  // thousand-file intake isn't gated on a thousand sequential model calls.
  const aiEligible =
    opts?.analyze !== false && aiConfigured() && (await resolveTimelineAccess()) === 'firm';
  const caseContext: CaseContext | null = aiEligible ? await loadCaseContext(admin, caseId) : null;
  // Stable exhibit numbers continue from the matter's current high-water mark.
  let exhibitNo = await maxExhibitNo(admin, caseId);

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
      exhibitNo += 1;
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
        exhibitNo,
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
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
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
  let exhibitNo = await maxExhibitNo(admin, caseId);

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
      exhibitNo += 1;
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
        exhibitNo,
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
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  return { ok: imported > 0, imported, failed, errors: errors.slice(0, 8) };
}

/**
 * Re-run analysis on one evidence entry (admin, firm-scoped). If a person has
 * corrected this entry by hand, re-analysis would overwrite their work, so it
 * refuses unless `force` is set (the UI confirms first). A folder the user moved
 * the item into is always preserved, even on a forced re-run.
 */
export async function analyzeFirmCaseEventAction(
  firmId: string,
  caseId: string,
  eventId: string,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent; needsConfirm?: boolean }> {
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

  const prior = ev.aiExtracted ?? {};
  if (prior.edited_at && !opts?.force) {
    return {
      ok: false,
      needsConfirm: true,
      error: 'This entry was corrected by hand. Re-analysing will replace those edits.',
      event: ev,
    };
  }

  await admin.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', eventId);
  const caseContext = await loadCaseContext(admin, caseId);
  const outcome = await computeEventAnalysis({ ev, admin, caseContext });

  // Carry the exhibit number, hash, and any hand-pinned folder across the re-run
  // so re-analysis never reshuffles a stable identifier or a deliberate filing.
  if (outcome.ok && outcome.patch.ai_extracted) {
    outcome.patch.ai_extracted = mergeStickyExtracted(outcome.patch.ai_extracted as AiExtracted, prior);
  }

  const { data: updated } = await admin
    .from('case_timeline_events').update(outcome.patch).eq('id', eventId).select('*').single();

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: outcome.ok, error: outcome.error, event: updated ? toEvent(updated as EventRow) : ev };
}

function cleanList(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = [...new Set(list.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))];
  return out.slice(0, 200);
}

/**
 * Save a person's corrections to one evidence entry (admin, firm-scoped). Edits
 * the narrative (ai_summary), the suggested title and date, and the extracted
 * people / dates / locations / organizations, then stamps edited_by/edited_at so
 * a later re-analysis warns before overwriting the correction.
 */
export async function updateFirmCaseEvidenceAction(
  firmId: string,
  caseId: string,
  eventId: string,
  edit: EvidenceEdit,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: row } = await admin
    .from('case_timeline_events').select('*').eq('id', eventId).eq('case_id', caseId).maybeSingle();
  if (!row) return { ok: false, error: 'Not found.' };
  const current = toEvent(row as EventRow);

  const ext: AiExtracted = { ...(current.aiExtracted ?? {}) };
  const people = cleanList(edit.detectedPeople);
  const dates = cleanList(edit.detectedDates);
  const locations = cleanList(edit.locations);
  const orgs = cleanList(edit.organizations);
  if (people !== undefined) ext.detected_people = people;
  if (dates !== undefined) ext.detected_dates = dates;
  if (locations !== undefined) ext.locations = locations;
  if (orgs !== undefined) ext.organizations = orgs;
  if (edit.folder !== undefined) {
    const folder = normalizeFolder(edit.folder);
    if (folder) {
      ext.folder = folder;
      ext.folder_locked = true;
    }
  }
  if (edit.occurredAt !== undefined) ext.suggested_occurred_at = edit.occurredAt;
  ext.edited_by = gate.userId;
  ext.edited_at = new Date().toISOString();

  const patch: Record<string, unknown> = {
    ai_extracted: ext,
    updated_at: new Date().toISOString(),
    // A hand-curated entry is final: mark it done so the background queue / cron
    // never re-scores it and overwrites the correction, and clear any prior error.
    ai_status: 'done',
    ai_error: null,
  };
  if (edit.title !== undefined) patch.title = edit.title.trim().slice(0, 200);
  if (edit.summary !== undefined) patch.ai_summary = edit.summary.trim();
  if (edit.occurredAt !== undefined) {
    if (edit.occurredAt) {
      const d = new Date(edit.occurredAt);
      if (!Number.isNaN(d.getTime())) {
        patch.occurred_at = d.toISOString();
        patch.occurred_precision = edit.occurredPrecision ?? current.occurredPrecision ?? 'day';
      }
    } else {
      patch.occurred_at = null;
      patch.occurred_precision = 'unknown';
    }
  } else if (edit.occurredPrecision !== undefined && current.occurredAt) {
    patch.occurred_precision = edit.occurredPrecision;
  }

  const { data: updated, error } = await admin
    .from('case_timeline_events').update(patch).eq('id', eventId).eq('case_id', caseId).select('*').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, event: updated ? toEvent(updated as EventRow) : current };
}

/**
 * Move one evidence entry into a folder (admin, firm-scoped). A pure move, so it
 * pins the folder (folder_locked) without stamping the full edited flag, meaning
 * re-analysis keeps the folder but does not otherwise treat the item as
 * hand-corrected.
 */
export async function setFirmEvidenceFolderAction(
  firmId: string,
  caseId: string,
  eventId: string,
  folder: string,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const normalized = normalizeFolder(folder);
  if (!normalized) return { ok: false, error: 'Unknown folder.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: row } = await admin
    .from('case_timeline_events').select('*').eq('id', eventId).eq('case_id', caseId).maybeSingle();
  if (!row) return { ok: false, error: 'Not found.' };
  const current = toEvent(row as EventRow);
  const ext: AiExtracted = { ...(current.aiExtracted ?? {}), folder: normalized, folder_locked: true };

  const { data: updated, error } = await admin
    .from('case_timeline_events')
    .update({ ai_extracted: ext, updated_at: new Date().toISOString() })
    .eq('id', eventId).eq('case_id', caseId).select('*').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, event: updated ? toEvent(updated as EventRow) : current };
}

/**
 * Rename a folder across this matter (admin, firm-scoped): every entry currently
 * shown under `from` (whether the reader filed it there or it fell there by its
 * kind) is pinned to `to`, so the rename sticks even for items that had no
 * explicit folder yet. `to` must be one of the controlled folder names.
 */
export async function renameFirmEvidenceFolderAction(
  firmId: string,
  caseId: string,
  from: string,
  to: string,
): Promise<{ ok: boolean; error?: string; moved?: number }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const target = normalizeFolder(to);
  if (!target) return { ok: false, error: 'Pick a valid folder name.' };
  if (!from.trim()) return { ok: false, error: 'Nothing to rename.' };
  if (from.trim() === target) return { ok: true, moved: 0 };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('case_timeline_events').select('*').eq('case_id', caseId);
  const events = ((data ?? []) as EventRow[]).map(toEvent);
  const hits = events.filter((e) => folderForEvent(e) === from.trim());

  let moved = 0;
  for (const e of hits) {
    const ext: AiExtracted = { ...(e.aiExtracted ?? {}), folder: target, folder_locked: true };
    const { error } = await admin
      .from('case_timeline_events')
      .update({ ai_extracted: ext, updated_at: new Date().toISOString() })
      .eq('id', e.id).eq('case_id', caseId);
    if (!error) moved++;
  }
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, moved };
}

/**
 * Set aside (or restore) a set of evidence items as not part of the case
 * (admin, firm-scoped). This is a soft, reversible flag on ai_extracted, not a
 * delete: the files stay stored and recoverable, but an excluded item drops out
 * of the working evidence view, the coverage counts, and exports until it is
 * restored. Used by the intake's bulk "Exclude from case" action.
 */
export async function setFirmEvidenceExcludedAction(
  firmId: string,
  caseId: string,
  eventIds: string[],
  excluded: boolean,
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const ids = Array.from(new Set((eventIds ?? []).filter((s) => typeof s === 'string'))).slice(0, 500);
  if (ids.length === 0) return { ok: false, error: 'Select at least one item.' };

  const { data } = await admin
    .from('case_timeline_events')
    .select('id, ai_extracted')
    .eq('case_id', caseId)
    .in('id', ids);
  const rows = (data ?? []) as { id: string; ai_extracted: AiExtracted | null }[];

  let updated = 0;
  for (const r of rows) {
    const ext: AiExtracted = { ...(r.ai_extracted ?? {}) };
    if (excluded) ext.excluded = true;
    else delete ext.excluded;
    const { error } = await admin
      .from('case_timeline_events')
      .update({ ai_extracted: ext, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('case_id', caseId);
    if (!error) updated++;
  }
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  return { ok: true, updated };
}

/**
 * Add (or remove) a set of evidence items to the case TIMELINE (admin,
 * firm-scoped). Evidence always lives in the intake; the timeline shows only
 * items the firm explicitly placed there. This flips the on_timeline flag on
 * ai_extracted (zero-migration) and revalidates both surfaces so the chronology,
 * calendar, and map reflect the change. Used by the intake's per-item toggle and
 * the bulk bar.
 */
export async function setFirmEvidenceOnTimelineAction(
  firmId: string,
  caseId: string,
  eventIds: string[],
  onTimeline: boolean,
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const ids = Array.from(new Set((eventIds ?? []).filter((s) => typeof s === 'string'))).slice(0, 500);
  if (ids.length === 0) return { ok: false, error: 'Select at least one item.' };

  const { data } = await admin
    .from('case_timeline_events')
    .select('id, ai_extracted')
    .eq('case_id', caseId)
    .in('id', ids);
  const rows = (data ?? []) as { id: string; ai_extracted: AiExtracted | null }[];

  let updated = 0;
  for (const r of rows) {
    const ext: AiExtracted = { ...(r.ai_extracted ?? {}), on_timeline: onTimeline };
    const { error } = await admin
      .from('case_timeline_events')
      .update({ ai_extracted: ext, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('case_id', caseId);
    if (!error) updated++;
  }
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  return { ok: true, updated };
}

/**
 * Delete one evidence entry + its stored media (admin, firm-scoped). A full row
 * delete: because evidence and the timeline share case_timeline_events rows,
 * removing the row drops the item from the timeline chronology, the calendar,
 * the case map, and every selection/exhibit list at once. Both surfaces are
 * revalidated so no stale copy survives in any view (e.g. deleting a duplicate).
 */
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
  // Revalidate every surface the row could appear on: the evidence intake, the
  // firm timeline builder, AND the matter overview (which shows evidence /
  // timeline counts + a preview). Missing the overview is what left a deleted
  // duplicate visible there until a hard refresh.
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

/**
 * Delete every event in this matter whose stored bytes hash to one of `hashes`,
 * removing its media too. Used by the "Replace" duplicate action so a re-upload
 * supersedes the prior copy. Internal, admin, already gated by the caller.
 */
async function deleteEventsByHashes(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  caseId: string,
  hashes: string[],
): Promise<number> {
  const set = new Set(hashes.filter((h) => typeof h === 'string' && h));
  if (set.size === 0) return 0;
  // Same JSONB-path filter as the duplicate check: pull only the rows that
  // actually match a replace hash, not the whole matter.
  const { data } = await admin
    .from('case_timeline_events')
    .select('id, media, ai_extracted')
    .eq('case_id', caseId)
    .in('ai_extracted->>sha256', [...set]);
  const rows = (data ?? []) as { id: string; media: TimelineMedia[] | null; ai_extracted: AiExtracted | null }[];
  const hits = rows.filter((r) => r.ai_extracted?.sha256 && set.has(r.ai_extracted.sha256));
  if (hits.length === 0) return 0;
  const paths = hits.flatMap((r) => (Array.isArray(r.media) ? r.media.map((m) => m.path) : []));
  if (paths.length) await admin.storage.from('exhibits').remove(paths).catch(() => {});
  const { error } = await admin
    .from('case_timeline_events')
    .delete()
    .eq('case_id', caseId)
    .in('id', hits.map((r) => r.id));
  return error ? 0 : hits.length;
}

/**
 * Given a set of content hashes the client computed for files it is about to
 * upload, report which already exist in this matter, so the UI can prompt to
 * Rename / Replace / Skip before anything is sent. The server stores every
 * import's hash (ai_extracted.sha256), making it the source of truth for dupes.
 */
export async function checkEvidenceDuplicatesAction(
  firmId: string,
  caseId: string,
  hashes: string[],
): Promise<{
  ok: boolean;
  error?: string;
  duplicates?: Record<string, { id: string; title: string; exhibit: string | null }>;
}> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const wanted = new Set((hashes ?? []).filter((h) => typeof h === 'string' && h));
  if (wanted.size === 0) return { ok: true, duplicates: {} };

  // Filter to only rows whose stored hash is one we're asking about, server-side,
  // via a JSONB path filter - so a duplicate check on a big matter doesn't drag
  // back every item's (large) ai_extracted blob just to compare hashes.
  const { data } = await admin
    .from('case_timeline_events')
    .select('id, title, ai_extracted')
    .eq('case_id', caseId)
    .in('ai_extracted->>sha256', [...wanted]);
  const rows = (data ?? []) as { id: string; title: string | null; ai_extracted: AiExtracted | null }[];
  const duplicates: Record<string, { id: string; title: string; exhibit: string | null }> = {};
  for (const r of rows) {
    const h = r.ai_extracted?.sha256;
    // First stored copy of a given hash wins as the "existing" item.
    if (h && wanted.has(h) && !duplicates[h]) {
      duplicates[h] = {
        id: r.id,
        title: (r.title ?? '').trim() || 'Untitled item',
        exhibit: exhibitLabel(r.ai_extracted?.exhibit_no),
      };
    }
  }
  return { ok: true, duplicates };
}

/**
 * The set of file names already stored in this matter (lower-cased), so an
 * upload can auto-skip a file whose name already exists - a name-based
 * duplicate guard that runs before the content-hash prompt. Names are small,
 * so we pull just the first media entry's name off every row. Trimmed +
 * lower-cased for a case-insensitive, whitespace-insensitive comparison.
 */
export async function listCaseEvidenceNamesAction(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; names?: string[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_timeline_events')
    .select('media')
    .eq('case_id', caseId);
  const names = new Set<string>();
  for (const r of (data ?? []) as { media: TimelineMedia[] | null }[]) {
    const name = Array.isArray(r.media) ? r.media[0]?.name : undefined;
    const norm = (name ?? '').trim().toLowerCase();
    if (norm) names.add(norm);
  }
  return { ok: true, names: [...names] };
}

/** One item's row in a selected-evidence export manifest. */
export type EvidenceExportItem = {
  exhibit: string | null;
  id: string;
  name: string;
  kind: TimelineKind;
  folder: string;
  documentType: string | null;
  captured: string;
  summary: string;
  people: string[];
  organizations: string[];
  locations: string[];
  dates: string[];
  relevance: number | null;
  url: string | null;
};

/**
 * Build a self-contained export manifest for a hand-picked set of items: their
 * exhibit numbers, filing, mined facts, and a short-TTL signed link to each
 * file. This is the firm-native "Share": it produces an evidence index the firm
 * can hand to a collaborator or the represented client, entirely in-app, sending
 * nothing externally. The client turns it into a downloadable index after an
 * explicit confirm.
 */
export async function exportSelectedEvidenceAction(
  firmId: string,
  caseId: string,
  eventIds: string[],
): Promise<{ ok: boolean; error?: string; matter?: string; items?: EvidenceExportItem[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const ids = Array.from(new Set((eventIds ?? []).filter((s) => typeof s === 'string'))).slice(0, 200);
  if (ids.length === 0) return { ok: false, error: 'Select at least one item to share.' };

  const { data: caseRow } = await admin.from('cases').select('title').eq('id', caseId).maybeSingle();
  const matter = (caseRow as { title: string } | null)?.title ?? 'Matter';

  const { data } = await admin
    .from('case_timeline_events')
    .select('*')
    .eq('case_id', caseId)
    .in('id', ids);
  const events = sortTimeline(((data ?? []) as EventRow[]).map(toEvent));

  const items: EvidenceExportItem[] = [];
  for (const e of events) {
    const ext = e.aiExtracted ?? {};
    const media = e.media[0];
    let url: string | null = null;
    if (media) {
      const signed = await admin.storage.from('exhibits').createSignedUrl(media.path, 600);
      url = signed.data?.signedUrl ?? null;
    }
    const cap = capturedAt(e);
    items.push({
      exhibit: exhibitLabel(ext.exhibit_no),
      id: e.id,
      name: (e.title ?? '').trim() || media?.name || 'Untitled item',
      kind: e.kind,
      folder: folderForEvent(e),
      documentType: ext.document_type ?? null,
      captured: cap ? formatOccurred(cap, e.occurredAt ? e.occurredPrecision : 'day') : 'Undated',
      summary: e.aiSummary ?? '',
      people: ext.detected_people ?? [],
      organizations: ext.organizations ?? [],
      locations: ext.locations ?? [],
      dates: ext.detected_dates ?? [],
      relevance: typeof ext.relevance_score === 'number' ? ext.relevance_score : null,
      url,
    });
  }
  return { ok: true, matter, items };
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
