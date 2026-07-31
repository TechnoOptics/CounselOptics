'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { safeStorageUpload } from './upload-safety';
import { buildNarrative, aiConfigured } from './timeline-ai';
import { computeEventAnalysis, loadCaseContext } from './case-evidence';
import { resolveTimelineAccess } from './timeline-entitlement';
import {
  kindFromMime,
  sortTimeline,
  formatOccurred,
  type TimelineEvent,
  type TimelineMedia,
  type CasePerson,
  type TimelineBundle,
  type TimelineKind,
  type OccurredPrecision,
  type PersonRole,
  type AiExtracted,
} from './timeline-types';

const BUCKET = 'exhibits';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB / item (video-friendly)

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

/** Confirm the caller can see this case (RLS-backed read). Returns caseId or null. */
async function assertCaseMember(caseId: string): Promise<boolean> {
  const supabase = createServerSupabase();
  const { data } = await supabase.from('cases').select('id').eq('id', caseId).maybeSingle();
  return Boolean(data);
}

function safeName(name: string): string {
  return (name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)) || 'file';
}

// ── Load ────────────────────────────────────────────────────────────────
export async function getTimelineBundle(caseId: string): Promise<TimelineBundle> {
  const user = await getCurrentUser();
  if (!user) return { events: [], people: [], narrative: null };
  const supabase = createServerSupabase();
  const [{ data: ev }, { data: pl }, { data: nr }] = await Promise.all([
    supabase.from('case_timeline_events').select('*').eq('case_id', caseId),
    supabase.from('case_people').select('*').eq('case_id', caseId).order('display_name'),
    supabase.from('case_timeline_narratives').select('*').eq('case_id', caseId).maybeSingle(),
  ]);
  const events = sortTimeline((ev ?? []).map((r) => toEvent(r as EventRow)));
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

// ── Create an event (fast; analysis runs separately) ──────────────────────
export async function createTimelineEvent(
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await assertCaseMember(caseId))) return { ok: false, error: 'You do not have access to this case.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // Firm plans build; Personal Plus submits; everyone else is locked out.
  const access = await resolveTimelineAccess();
  if (access === 'locked') {
    return { ok: false, error: 'The case timeline is available on Personal Plus and firm plans.' };
  }

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
    if (f.size > MAX_BYTES) {
      return { ok: false, error: `"${f.name}" is over the 50 MB limit.` };
    }
    const path = `${user.id}/${caseId}/timeline/${eventId}/${safeName(f.name)}`;
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

  // Infer a kind from the first attachment if the user didn't pick one.
  if ((!kind || kind === 'note') && media[0]) kind = kindFromMime(media[0].mime, media[0].name);

  let occurredAt: string | null = null;
  if (occurredAtRaw) {
    const d = new Date(occurredAtRaw);
    if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
  }

  // Only firm-plan users get Bella analysis queued; Personal Plus can upload +
  // add context, but the sense-making is the firm's tier.
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('case_timeline_events')
    .insert({
      id: eventId,
      case_id: caseId,
      created_by: user.id,
      occurred_at: occurredAt,
      occurred_precision: occurredAt ? occurredPrecision : 'unknown',
      kind,
      title: title || '',
      description,
      media,
      source_label: sourceLabel,
      ai_status:
        access === 'firm' && aiConfigured() && (media.length > 0 || description)
          ? 'pending'
          : 'skipped',
    })
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save.' };

  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: true, event: toEvent(data as EventRow) };
}

// ── Analyse an event with Bella ───────────────────────────────────────────
export async function analyzeTimelineEvent(
  eventId: string,
): Promise<{ ok: boolean; error?: string; event?: TimelineEvent }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: row } = await supabase
    .from('case_timeline_events').select('*').eq('id', eventId).maybeSingle();
  if (!row) return { ok: false, error: 'Not found.' };
  const ev = toEvent(row as EventRow);
  if (!aiConfigured()) {
    await supabase.from('case_timeline_events')
      .update({ ai_status: 'skipped' }).eq('id', eventId);
    return { ok: false, error: 'AI analysis is not configured.' };
  }
  if ((await resolveTimelineAccess()) !== 'firm') {
    await supabase.from('case_timeline_events')
      .update({ ai_status: 'skipped' }).eq('id', eventId);
    return { ok: false, error: 'Bella timeline analysis is a firm-plan feature.' };
  }

  await supabase.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', eventId);
  const admin = createAdminSupabase();

  // Score relevance against the case facts (when we can read them).
  const caseContext = admin ? await loadCaseContext(admin, ev.caseId) : null;
  const outcome = await computeEventAnalysis({ ev, admin, caseContext });

  if (!outcome.ok) {
    await supabase.from('case_timeline_events').update(outcome.patch).eq('id', eventId);
    const { data: fresh } = await supabase.from('case_timeline_events').select('*').eq('id', eventId).maybeSingle();
    return { ok: false, error: outcome.error, event: fresh ? toEvent(fresh as EventRow) : undefined };
  }

  const { data: updated } = await supabase
    .from('case_timeline_events').update(outcome.patch).eq('id', eventId).select('*').single();
  revalidatePath(`/cases/${ev.caseId}/timeline`);
  return { ok: true, event: updated ? toEvent(updated as EventRow) : ev };
}

// ── Edit / delete ─────────────────────────────────────────────────────────
export async function updateTimelineEvent(
  eventId: string,
  patch: {
    title?: string; description?: string | null; kind?: TimelineKind;
    occurredAt?: string | null; occurredPrecision?: OccurredPrecision;
    sourceLabel?: string | null; people?: string[]; position?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
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
  const { data, error } = await supabase
    .from('case_timeline_events').update(row).eq('id', eventId).select('case_id').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (data) revalidatePath(`/cases/${(data as { case_id: string }).case_id}/timeline`);
  return { ok: true };
}

export async function deleteTimelineEvent(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: row } = await supabase
    .from('case_timeline_events').select('case_id, media').eq('id', eventId).maybeSingle();
  if (!row) return { ok: false, error: 'Not found.' };
  const r = row as { case_id: string; media: TimelineMedia[] | null };
  const admin = createAdminSupabase();
  if (admin && Array.isArray(r.media) && r.media.length) {
    await admin.storage.from(BUCKET).remove(r.media.map((m) => m.path)).catch(() => {});
  }
  const { error } = await supabase.from('case_timeline_events').delete().eq('id', eventId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/cases/${r.case_id}/timeline`);
  return { ok: true };
}

// ── People ────────────────────────────────────────────────────────────────
export async function addPerson(
  caseId: string,
  input: { displayName: string; role?: PersonRole; aliases?: string[]; notes?: string | null },
): Promise<{ ok: boolean; error?: string; person?: CasePerson }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: 'Give the person a name.' };
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('case_people')
    .insert({
      case_id: caseId, display_name: name.slice(0, 120),
      role: input.role ?? 'other',
      aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
      notes: input.notes ?? null, created_by: user.id,
    })
    .select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add person.' };
  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: true, person: toPerson(data as PersonRow) };
}

export async function updatePerson(
  personId: string,
  patch: { displayName?: string; role?: PersonRole; aliases?: string[]; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim().slice(0, 120);
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.aliases !== undefined) row.aliases = patch.aliases.map((a) => a.trim()).filter(Boolean);
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase
    .from('case_people').update(row).eq('id', personId).select('case_id').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (data) revalidatePath(`/cases/${(data as { case_id: string }).case_id}/timeline`);
  return { ok: true };
}

export async function deletePerson(personId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: row } = await supabase.from('case_people').select('case_id').eq('id', personId).maybeSingle();
  const { error } = await supabase.from('case_people').delete().eq('id', personId);
  if (error) return { ok: false, error: error.message };
  if (row) revalidatePath(`/cases/${(row as { case_id: string }).case_id}/timeline`);
  return { ok: true };
}

// ── Signed media URL (member-scoped) ──────────────────────────────────────
export async function getTimelineMediaUrl(path: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  // This is a public endpoint that mints a signed URL into the private
  // `exhibits` bucket, which holds consumer AND firm-matter evidence. The path
  // is caller-supplied, so being signed in cannot be the only gate: read the
  // case id out of the path convention (userId/caseId/timeline/...) and confirm
  // the caller can actually see that case before signing anything. Anything
  // that does not match the convention is refused.
  const segments = path.split('/');
  if (segments.length < 3 || segments.some((s) => !s || s === '.' || s === '..')) return null;
  const caseId = segments[1];
  if (!(await assertCaseMember(caseId))) return null;
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

// ── Generate the narrative + conclusion ───────────────────────────────────
export async function generateTimelineNarrative(
  caseId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await assertCaseMember(caseId))) return { ok: false, error: 'No access to this case.' };
  if (!aiConfigured()) return { ok: false, error: 'AI is not configured.' };
  if ((await resolveTimelineAccess()) !== 'firm') return { ok: false, error: 'The timeline document is a firm-plan feature.' };

  const supabase = createServerSupabase();
  const { data: caseRow } = await supabase.from('cases').select('title').eq('id', caseId).maybeSingle();
  const bundle = await getTimelineBundle(caseId);
  if (bundle.events.length === 0) return { ok: false, error: 'Add some events first.' };

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
    caseTitle: (caseRow as { title?: string } | null)?.title ?? 'Case',
    entries,
  });
  if ('error' in res) return { ok: false, error: res.error };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  await admin.from('case_timeline_narratives').upsert({
    case_id: caseId,
    summary: res.summary, narrative: res.narrative, conclusion: res.conclusion,
    event_count: bundle.events.length, generated_by: user.id,
    generated_at: new Date().toISOString(),
  });
  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: true };
}
