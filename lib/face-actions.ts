'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getFirmFaceSetting } from './face-settings';
import { detectFacesHook } from './timeline-ai';
import { clusterFaces } from './face-detect';
import { EXHIBITS_BUCKET } from './case-evidence';
import type { FaceBox } from './face-detect';
import type { TimelineMedia } from './timeline-types';

/** How many photos one scan invocation will process (bounds serverless time). */
const SCAN_IMAGE_CAP = 60;

/**
 * Firm-scoped actions for recurring-face detection (biometric / special-category
 * data). Like the rest of firm evidence, firm members are NOT case members, so
 * every read/write goes through the ADMIN client, gated on the caller being a
 * member of the firm (and, for case work, the case belonging to that firm) -
 * mirroring lib/case-evidence-actions.ts.
 *
 * This file owns the opt-in toggle (with purge-on-disable). Face reads +
 * merge/split/label land here too as the feature is built out.
 */

/** The current user is an owner/admin of `firmId`. */
async function assertFirmAdmin(
  firmId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (member as { role: string } | null)?.role;
  if (!role) return { ok: false, error: 'You do not have access to this firm.' };
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only a firm owner or admin can change this setting.' };
  }
  return { ok: true, userId: user.id };
}

/** Read the firm's recurring-face opt-in (any firm member). */
export async function getRecurringFacesEnabledAction(
  firmId: string,
): Promise<{ ok: boolean; enabled?: boolean; error?: string }> {
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
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const setting = await getFirmFaceSetting(admin, firmId);
  return { ok: true, enabled: setting.enabled };
}

/**
 * Turn recurring-face detection on or off for a firm (owner/admin only).
 *
 * Turning it OFF is a purge: every face vector + cluster the firm holds, across
 * all its matters, is hard-deleted. This is deliberate - face embeddings are
 * biometric identifiers, so switching the feature off must leave none behind
 * (R14 retention commitment). Turning it back on starts from an empty slate;
 * faces are re-detected as evidence is (re-)analysed.
 */
export async function setRecurringFacesEnabledAction(
  firmId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string; purged?: number }> {
  const gate = await assertFirmAdmin(firmId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from('firm_settings')
    .upsert(
      {
        firm_id: firmId,
        recurring_faces_enabled: enabled,
        recurring_faces_updated_at: now,
        recurring_faces_updated_by: gate.userId,
        updated_at: now,
      },
      { onConflict: 'firm_id' },
    );
  if (upErr) return { ok: false, error: upErr.message };

  let purged = 0;
  if (!enabled) {
    // Collect the firm's cases, then hard-delete their face vectors + clusters.
    const { data: cases } = await admin.from('cases').select('id').eq('firm_id', firmId);
    const caseIds = ((cases ?? []) as { id: string }[]).map((c) => c.id);
    if (caseIds.length) {
      const { count } = await admin
        .from('case_evidence_faces')
        .delete({ count: 'exact' })
        .in('case_id', caseIds);
      purged = count ?? 0;
      await admin.from('case_face_clusters').delete().in('case_id', caseIds);
    }
  }

  revalidatePath('/counsel');
  return { ok: true, purged };
}

// ── Case-scoped face work (gated on firm membership + case.firm_id) ──────────

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

type FaceRow = {
  id: string;
  event_id: string;
  media_path: string;
  bbox: FaceBox;
  embedding: number[];
  cluster_id: string | null;
};

/** One face crop shown in the UI: enough to position a crop over its photo. */
export type RecurringFaceCrop = {
  faceId: string;
  eventId: string;
  mediaPath: string;
  bbox: FaceBox;
};

/** One recurring-person group. NOT an identity - a group of similar-looking crops. */
export type RecurringPerson = {
  clusterId: string;
  label: string | null;
  photoCount: number;
  representative: RecurringFaceCrop | null;
  faces: RecurringFaceCrop[];
};

function toCrop(r: FaceRow): RecurringFaceCrop {
  return { faceId: r.id, eventId: r.event_id, mediaPath: r.media_path, bbox: r.bbox };
}

/** Area * confidence, to pick the most prominent face as a cluster's face. */
function prominence(r: FaceRow): number {
  const area = (r.bbox?.width ?? 0) * (r.bbox?.height ?? 0);
  return area * (r.bbox?.score ?? 1);
}

/**
 * Dedicated recurring-face pass over a matter's photos. Self-hosted, one image
 * at a time (bounded per invocation), gated on the firm opt-in. Full re-scan:
 * clears the case's faces + clusters, re-detects across up to SCAN_IMAGE_CAP
 * photos, then clusters the embeddings by cosine distance. Re-runnable. Finds
 * nothing (safely) until the self-hosted model is provisioned.
 */
export async function analyzeCaseFacesAction(
  firmId: string,
  caseId: string,
): Promise<{
  ok: boolean;
  error?: string;
  scanned?: number;
  total?: number;
  faces?: number;
  clusters?: number;
  truncated?: boolean;
}> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // Hard gate: no firm opt-in => process zero faces.
  const setting = await getFirmFaceSetting(admin, firmId);
  if (!setting.enabled) {
    return { ok: false, error: 'Turn on Recurring people for this firm first.' };
  }

  const { data: rows } = await admin
    .from('case_timeline_events')
    .select('id, media')
    .eq('case_id', caseId);
  const events = ((rows ?? []) as { id: string; media: TimelineMedia[] | null }[])
    .map((e) => ({
      id: e.id,
      images: (Array.isArray(e.media) ? e.media : []).filter((m) =>
        /^image\/(jpeg|png|webp)$/i.test(m.mime),
      ),
    }))
    .filter((e) => e.images.length > 0);

  const total = events.length;
  const toScan = events.slice(0, SCAN_IMAGE_CAP);

  // Full re-scan: clear existing faces + clusters for this case.
  await admin.from('case_face_clusters').delete().eq('case_id', caseId);
  await admin.from('case_evidence_faces').delete().eq('case_id', caseId);

  let inserted = 0;
  for (const ev of toScan) {
    for (const media of ev.images) {
      try {
        const dl = await admin.storage.from(EXHIBITS_BUCKET).download(media.path);
        if (!dl.data) continue;
        const buffer = Buffer.from(await (dl.data as Blob).arrayBuffer());
        const faces = await detectFacesHook(buffer, media.mime);
        if (!faces?.length) continue;
        const insertRows = faces.map((f) => ({
          case_id: caseId,
          event_id: ev.id,
          media_path: media.path,
          bbox: f.bbox,
          embedding: f.embedding,
        }));
        const { error } = await admin.from('case_evidence_faces').insert(insertRows);
        if (!error) inserted += insertRows.length;
      } catch {
        /* one unreadable image never fails the whole pass */
      }
    }
  }

  const clusters = await reclusterCase(admin, caseId);

  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return {
    ok: true,
    scanned: toScan.length,
    total,
    faces: inserted,
    clusters,
    truncated: total > toScan.length,
  };
}

/** Re-cluster all of a case's faces and rebuild the cluster rows. Returns count. */
async function reclusterCase(admin: SupabaseClient, caseId: string): Promise<number> {
  const { data } = await admin
    .from('case_evidence_faces')
    .select('id, event_id, media_path, bbox, embedding, cluster_id')
    .eq('case_id', caseId);
  const faces = (data ?? []) as FaceRow[];
  if (!faces.length) return 0;

  await admin.from('case_face_clusters').delete().eq('case_id', caseId);

  const byId = new Map(faces.map((f) => [f.id, f]));
  const groups = clusterFaces(faces.map((f) => ({ id: f.id, embedding: f.embedding })));
  let created = 0;
  for (const memberIds of groups) {
    if (!memberIds.length) continue;
    const members = memberIds.map((id) => byId.get(id)).filter(Boolean) as FaceRow[];
    const rep = members.reduce((a, b) => (prominence(b) > prominence(a) ? b : a));
    const { data: clusterRow } = await admin
      .from('case_face_clusters')
      .insert({ case_id: caseId, representative_face_id: rep.id })
      .select('id')
      .single();
    const clusterId = (clusterRow as { id: string } | null)?.id;
    if (!clusterId) continue;
    await admin.from('case_evidence_faces').update({ cluster_id: clusterId }).in('id', memberIds);
    created += 1;
  }
  return created;
}

/**
 * Read a matter's recurring-people groups for the UI. Only clusters that recur
 * (appear in more than one photo) are surfaced by default, since a face in a
 * single photo is not "recurring".
 */
export async function getCaseRecurringPeopleAction(
  firmId: string,
  caseId: string,
  opts?: { includeSingletons?: boolean },
): Promise<{ ok: boolean; error?: string; people?: RecurringPerson[]; faceCount?: number }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const [{ data: faceData }, { data: clusterData }] = await Promise.all([
    admin
      .from('case_evidence_faces')
      .select('id, event_id, media_path, bbox, embedding, cluster_id')
      .eq('case_id', caseId),
    admin
      .from('case_face_clusters')
      .select('id, label, representative_face_id')
      .eq('case_id', caseId),
  ]);
  const faces = (faceData ?? []) as FaceRow[];
  const clusters = (clusterData ?? []) as {
    id: string;
    label: string | null;
    representative_face_id: string | null;
  }[];

  const byCluster = new Map<string, FaceRow[]>();
  for (const f of faces) {
    if (!f.cluster_id) continue;
    const list = byCluster.get(f.cluster_id) ?? [];
    list.push(f);
    byCluster.set(f.cluster_id, list);
  }

  const people: RecurringPerson[] = clusters
    .map((c) => {
      const members = byCluster.get(c.id) ?? [];
      const photoCount = new Set(members.map((m) => m.event_id)).size;
      const repRow =
        members.find((m) => m.id === c.representative_face_id) ??
        (members.length ? members.reduce((a, b) => (prominence(b) > prominence(a) ? b : a)) : null);
      return {
        clusterId: c.id,
        label: c.label,
        photoCount,
        representative: repRow ? toCrop(repRow) : null,
        faces: members.map(toCrop),
      };
    })
    .filter((p) => p.faces.length > 0)
    .filter((p) => opts?.includeSingletons || p.photoCount > 1)
    .sort((a, b) => b.photoCount - a.photoCount);

  return { ok: true, people, faceCount: faces.length };
}

/** Set (or clear) a firm's private note on a cluster. NOT an identity claim. */
export async function labelClusterAction(
  firmId: string,
  caseId: string,
  clusterId: string,
  label: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const clean = (label ?? '').trim().slice(0, 120) || null;
  const { error } = await admin
    .from('case_face_clusters')
    .update({ label: clean, updated_at: new Date().toISOString() })
    .eq('id', clusterId)
    .eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true };
}

/** Merge two clusters into one (reassign faces, keep the target's label). */
export async function mergeClustersAction(
  firmId: string,
  caseId: string,
  sourceClusterId: string,
  targetClusterId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (sourceClusterId === targetClusterId) return { ok: false, error: 'Pick two different groups.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  // Both clusters must belong to this case.
  const { data: found } = await admin
    .from('case_face_clusters')
    .select('id')
    .eq('case_id', caseId)
    .in('id', [sourceClusterId, targetClusterId]);
  if (((found ?? []) as unknown[]).length !== 2) return { ok: false, error: 'Group not found.' };
  await admin
    .from('case_evidence_faces')
    .update({ cluster_id: targetClusterId })
    .eq('case_id', caseId)
    .eq('cluster_id', sourceClusterId);
  await admin.from('case_face_clusters').delete().eq('id', sourceClusterId).eq('case_id', caseId);
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true };
}

/** Split faces out of a cluster into a new group (they were wrongly merged). */
export async function splitFacesAction(
  firmId: string,
  caseId: string,
  faceIds: string[],
): Promise<{ ok: boolean; error?: string; clusterId?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const ids = Array.from(new Set((faceIds ?? []).filter((s) => typeof s === 'string')));
  if (!ids.length) return { ok: false, error: 'Pick at least one face to split off.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  // Confirm every face is in this case before moving it.
  const { data: faces } = await admin
    .from('case_evidence_faces')
    .select('id, bbox, media_path, event_id, embedding, cluster_id')
    .eq('case_id', caseId)
    .in('id', ids);
  const rows = (faces ?? []) as FaceRow[];
  if (rows.length !== ids.length) return { ok: false, error: 'Some faces were not found.' };
  const rep = rows.reduce((a, b) => (prominence(b) > prominence(a) ? b : a));
  const { data: clusterRow, error: cErr } = await admin
    .from('case_face_clusters')
    .insert({ case_id: caseId, representative_face_id: rep.id })
    .select('id')
    .single();
  const clusterId = (clusterRow as { id: string } | null)?.id;
  if (cErr || !clusterId) return { ok: false, error: cErr?.message ?? 'Could not split.' };
  await admin.from('case_evidence_faces').update({ cluster_id: clusterId }).in('id', ids);
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, clusterId };
}

/** Short-TTL signed URL for a face's source photo (firm-scoped). */
export async function getFaceMediaUrlAction(
  firmId: string,
  caseId: string,
  path: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  // The path is namespaced under the case; confirm it belongs here before signing.
  if (!path.includes(`/${caseId}/timeline/`)) return { ok: false, error: 'File not in this matter.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin.storage.from(EXHIBITS_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ? { ok: true, url: data.signedUrl } : { ok: false, error: 'Could not open.' };
}
