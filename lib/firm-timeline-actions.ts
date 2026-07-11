'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { safeStorageUpload } from './upload-safety';
import { buildNarrative, aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import {
  kindFromMime,
  sortTimeline,
  formatOccurred,
  isOnTimeline,
  type TimelineEvent,
  type TimelineMedia,
  type CasePerson,
  type TimelineBundle,
  type TimelineKind,
  type OccurredPrecision,
  type PersonRole,
  type AiExtracted,
} from './timeline-types';

/**
 * FIRM-native timeline actions - the firm counterpart of lib/timeline-actions.ts.
 *
 * The consumer timeline actions gate on `assertCaseMember` (RLS: case OWNER or
 * collaborator). Firm members are NOT case members of a firm matter, so those
 * actions return "no access" for anyone but the matter's creator. Every action
 * here instead gates on firm membership + `case.firm_id === firmId` and goes
 * through the ADMIN client, exactly like lib/case-evidence-actions.ts. That is
 * what lets ANY firm member build a matter's timeline, and it is why the firm
 * timeline lives at a firm-native route (/counsel/cases/[id]/timeline) rather
 * than sending firm users into the consumer /cases/[id]/timeline surface.
 *
 * Read/analyse/delete/edit of individual evidence events already have firm
 * equivalents in lib/case-evidence-actions.ts (getFirmCaseTimeline,
 * analyzeFirmCaseEventAction, deleteFirmCaseEventAction,
 * updateFirmCaseEvidenceAction, getFirmEvidenceMediaUrl). This module adds the
 * pieces the full builder additionally needs: the whole bundle (events +
 * people + narrative), manual event creation, people management, and narrative
 * generation.
 */

const BUCKET = 'exhibits';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB / item (video-friendly)

// ── row mappers (mirrors lib/timeline-actions.ts) ─────────────────────────
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

type PersonRow = {
  id: string; case_id: string; display_name: string; role: PersonRole;
  aliases: string[] | null; notes: string | null; avatar_path: string | null;
  created_at: string;
};
function toPerson(r: PersonRow): CasePerson {
  return {
    id: r.id, caseId: r.case_id, displayName: r.display_name, role: r.role,
    aliases: r.aliases ?? [], notes: r.notes, avatarPath: r.avatar_path,
    createdAt: r.created_at,
  };
}

function safeName(name: string): string {
  return (name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)) || 'file';
}

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

function revalidateFirm(caseId: string) {
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
}

// ── Load the whole bundle (events + people + narrative) ───────────────────
export async function getFirmTimelineBundle(
  firmId: string,
  caseId: string,
): Promise<TimelineBundle> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { events: [], people: [], narrative: null };
  const admin = createAdminSupabase();
  if (!admin) return { events: [], people: [], narrative: null };
  const [{ data: ev }, { data: pl }, { data: nr }] = await Promise.all([
    admin.from('case_timeline_events').select('*').eq('case_id', caseId),
    admin.from('case_people').select('*').eq('case_id', caseId).order('display_name'),
    admin.from('case_timeline_narratives').select('*').eq('case_id', caseId).maybeSingle(),
  ]);
  // The timeline shows ONLY evidence the firm explicitly added (on_timeline).
  // Everything else stays in the evidence intake. Legacy rows with no flag are
  // treated as on the timeline so existing cases are not emptied (see
  // isOnTimeline).
  const events = sortTimeline(
    (ev ?? []).map((r) => toEvent(r as EventRow)).filter(isOnTimeline),
  );
  const people = (pl ?? []).map((r) => toPerson(r as PersonRow));
  const narrative = nr
    ? {
        caseId,
        summary: (nr as { summary: string | null }).summary,
        narrative: (nr as { narrative: string | null }).narrative,
        conclusion: (nr as { conclusion: string | null }).conclusion,
        eventCount: (nr as { event_count: number }).event_count,
        generatedAt: (nr as { generated_at: string | null }).generated_at,
      }
    : null;
  return { events, people, narrative };
}

// ── Create a manual event (with optional attachments) ─────────────────────
export async function createFirmTimelineEvent(
  firmId: string,
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const eventId = crypto.randomUUID();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const sourceLabel = String(formData.get('sourceLabel') ?? '').trim() || null;
  const occurredAtRaw = String(formData.get('occurredAt') ?? '').trim();
  const occurredPrecision = (String(formData.get('occurredPrecision') ?? 'day').trim() ||
    'day') as OccurredPrecision;
  let kind = (String(formData.get('kind') ?? '').trim() || 'note') as TimelineKind;

  const files = formData
    .getAll('files')
    .filter((f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0);

  const media: TimelineMedia[] = [];
  for (const f of files.slice(0, 10)) {
    if (f.size > MAX_BYTES) return { ok: false, error: `"${f.name}" is over the 50 MB limit.` };
    const path = `${gate.userId}/${caseId}/timeline/${eventId}/${safeName(f.name)}`;
    const buffer = Buffer.from(await f.arrayBuffer());
    const uploaded = await safeStorageUpload({
      client: admin,
      bucket: BUCKET,
      path,
      buffer,
      declaredMime: f.type || null,
      maxBytes: MAX_BYTES,
    });
    if (!uploaded.ok) return { ok: false, error: `Upload failed: ${uploaded.error}` };
    media.push({ path, mime: f.type || 'application/octet-stream', name: f.name, size: f.size });
  }
  if ((!kind || kind === 'note') && media[0]) kind = kindFromMime(media[0].mime, media[0].name);

  let occurredAt: string | null = null;
  if (occurredAtRaw) {
    const d = new Date(occurredAtRaw);
    if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
  }

  // New events land 'skipped' so the auto-analysis queue + cron backstop score
  // them (firm plan + AI configured); nothing to analyse just stays 'skipped'.
  const { data, error } = await admin
    .from('case_timeline_events')
    .insert({
      id: eventId,
      case_id: caseId,
      created_by: gate.userId,
      occurred_at: occurredAt,
      occurred_precision: occurredAt ? occurredPrecision : 'unknown',
      kind,
      title: title || '',
      description,
      media,
      source_label: sourceLabel,
      ai_status: 'skipped',
    })
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save.' };

  revalidateFirm(caseId);
  return { ok: true, event: toEvent(data as EventRow) };
}

// ── Edit an event's core fields (firm-gated) ──────────────────────────────
export async function updateFirmTimelineEvent(
  firmId: string,
  caseId: string,
  eventId: string,
  patch: {
    title?: string; description?: string | null; kind?: TimelineKind;
    occurredAt?: string | null; occurredPrecision?: OccurredPrecision;
    sourceLabel?: string | null; people?: string[]; position?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title.slice(0, 200);
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.sourceLabel !== undefined) row.source_label = patch.sourceLabel;
  if (patch.people !== undefined) row.people = patch.people;
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.occurredAt !== undefined) {
    if (patch.occurredAt) {
      const d = new Date(patch.occurredAt);
      row.occurred_at = Number.isNaN(d.getTime()) ? null : d.toISOString();
      row.occurred_precision = patch.occurredPrecision ?? 'day';
    } else {
      row.occurred_at = null; row.occurred_precision = 'unknown';
    }
  } else if (patch.occurredPrecision !== undefined) {
    row.occurred_precision = patch.occurredPrecision;
  }
  const { error } = await admin
    .from('case_timeline_events').update(row).eq('id', eventId).eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidateFirm(caseId);
  return { ok: true };
}

// ── People (firm-gated, admin) ────────────────────────────────────────────
export async function addFirmPerson(
  firmId: string,
  caseId: string,
  input: { displayName: string; role?: PersonRole; aliases?: string[]; notes?: string | null },
): Promise<{ ok: boolean; error?: string; person?: CasePerson }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: 'Give the person a name.' };
  const { data, error } = await admin
    .from('case_people')
    .insert({
      case_id: caseId, display_name: name.slice(0, 120),
      role: input.role ?? 'other',
      aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
      notes: input.notes ?? null, created_by: gate.userId,
    })
    .select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add person.' };
  revalidateFirm(caseId);
  return { ok: true, person: toPerson(data as PersonRow) };
}

export async function updateFirmPerson(
  firmId: string,
  caseId: string,
  personId: string,
  patch: { displayName?: string; role?: PersonRole; aliases?: string[]; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim().slice(0, 120);
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.aliases !== undefined) row.aliases = patch.aliases.map((a) => a.trim()).filter(Boolean);
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await admin
    .from('case_people').update(row).eq('id', personId).eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidateFirm(caseId);
  return { ok: true };
}

export async function deleteFirmPerson(
  firmId: string,
  caseId: string,
  personId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { error } = await admin
    .from('case_people').delete().eq('id', personId).eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidateFirm(caseId);
  return { ok: true };
}

// ── Generate the chronological narrative + conclusion (firm-gated) ────────
export async function generateFirmTimelineNarrative(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!aiConfigured()) return { ok: false, error: 'AI is not configured.' };
  if ((await resolveTimelineAccess()) !== 'firm') {
    return { ok: false, error: 'The timeline document is a firm-plan feature.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: caseRow } = await admin.from('cases').select('title').eq('id', caseId).maybeSingle();
  const bundle = await getFirmTimelineBundle(firmId, caseId);
  if (bundle.events.length === 0) return { ok: false, error: 'Add some evidence first.' };

  const peopleById = new Map(bundle.people.map((p) => [p.id, p.displayName]));
  const entries = bundle.events.map((e) => ({
    when: formatOccurred(e.occurredAt, e.occurredPrecision),
    kind: e.kind,
    title: e.title || '(untitled)',
    context: e.description,
    summary: e.aiSummary,
    people: e.people.map((id) => peopleById.get(id) ?? '').filter(Boolean),
  }));

  const res = await buildNarrative({
    caseTitle: (caseRow as { title?: string } | null)?.title ?? 'Matter',
    entries,
  });
  if ('error' in res) return { ok: false, error: res.error };

  await admin.from('case_timeline_narratives').upsert({
    case_id: caseId,
    summary: res.summary, narrative: res.narrative, conclusion: res.conclusion,
    event_count: bundle.events.length, generated_by: gate.userId,
    generated_at: new Date().toISOString(),
  });
  revalidateFirm(caseId);
  return { ok: true };
}
