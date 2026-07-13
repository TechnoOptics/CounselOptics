'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { safeStorageUpload } from './upload-safety';

/**
 * Party portraits + case-context images shown on the matter details. Firm
 * members are not case members of a firm matter, so every read/write goes
 * through the ADMIN client gated on firm membership + case.firm_id, mirroring
 * lib/case-evidence-actions.ts. Images live in the exhibits bucket; case_images
 * is the index.
 */

const BUCKET = 'exhibits';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB per image

export type CaseImage = {
  id: string;
  kind: 'party' | 'context';
  label: string | null;
  storagePath: string;
  createdAt: string;
};

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

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'image';
}

type Row = { id: string; kind: 'party' | 'context'; label: string | null; storage_path: string; created_at: string };
const toImage = (r: Row): CaseImage => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  storagePath: r.storage_path,
  createdAt: r.created_at,
});

/** List a matter's images (admin, firm-scoped). */
export async function listCaseImages(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; images?: CaseImage[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_images')
    .select('id, kind, label, storage_path, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  return { ok: true, images: ((data ?? []) as Row[]).map(toImage) };
}

/** Upload one party/context image (admin, firm-scoped). */
export async function uploadCaseImageAction(
  firmId: string,
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; image?: CaseImage }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const file = formData.get('file');
  if (!(typeof file === 'object' && file !== null && 'size' in file)) {
    return { ok: false, error: 'Choose an image.' };
  }
  const f = file as File;
  if (f.size === 0) return { ok: false, error: 'That image is empty.' };
  if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Images must be under 15 MB.' };
  if (!/^image\//.test(f.type)) return { ok: false, error: 'Only image files are allowed.' };

  const kindRaw = String(formData.get('kind') ?? 'party');
  const kind: 'party' | 'context' = kindRaw === 'context' ? 'context' : 'party';
  const label = String(formData.get('label') ?? '').trim().slice(0, 200) || null;

  const imageId = crypto.randomUUID();
  const path = `${gate.userId}/${caseId}/case-images/${imageId}/${safeName(f.name)}`;
  const buffer = Buffer.from(await f.arrayBuffer());
  const uploaded = await safeStorageUpload({
    client: admin,
    bucket: BUCKET,
    path,
    buffer,
    declaredMime: f.type || null,
    maxBytes: MAX_IMAGE_BYTES,
  });
  if (!uploaded.ok) return { ok: false, error: `Upload failed: ${uploaded.error}` };

  const { data, error } = await admin
    .from('case_images')
    .insert({ id: imageId, case_id: caseId, kind, storage_path: path, label, created_by: gate.userId })
    .select('id, kind, label, storage_path, created_at')
    .single();
  if (error || !data) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: error?.message ?? 'Could not save the image.' };
  }
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true, image: toImage(data as Row) };
}

/** Delete an image + its stored file (admin, firm-scoped). */
export async function deleteCaseImageAction(
  firmId: string,
  caseId: string,
  imageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data: row } = await admin
    .from('case_images')
    .select('storage_path')
    .eq('id', imageId)
    .eq('case_id', caseId)
    .maybeSingle();
  const path = (row as { storage_path: string } | null)?.storage_path;
  if (path) await admin.storage.from(BUCKET).remove([path]).catch(() => {});
  const { error } = await admin.from('case_images').delete().eq('id', imageId).eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

/**
 * Feature (or clear, when imageId is null) a party image as the matter's party
 * portrait / business logo. Stored on cases.subject_profile.featuredImageId
 * (zero migration). Read-modify-write so the rest of the dossier is preserved.
 * Firm-scoped admin path, mirroring the other writes here.
 */
export async function setFeaturedPartyImageAction(
  firmId: string,
  caseId: string,
  imageId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // When setting (not clearing), confirm the image is a party image on this
  // matter, so we never point the portrait at a stray or context image.
  if (imageId) {
    const { data: img } = await admin
      .from('case_images')
      .select('id, kind')
      .eq('id', imageId)
      .eq('case_id', caseId)
      .maybeSingle();
    const row = img as { id: string; kind: string } | null;
    if (!row || row.kind !== 'party') {
      return { ok: false, error: 'Choose a party image to feature.' };
    }
  }

  const { data: caseRow } = await admin
    .from('cases')
    .select('subject_profile')
    .eq('id', caseId)
    .maybeSingle();
  const profile = {
    ...(((caseRow as { subject_profile: Record<string, unknown> | null } | null)?.subject_profile) ?? {}),
  };
  if (imageId) profile.featuredImageId = imageId;
  else delete profile.featuredImageId;

  const { error } = await admin
    .from('cases')
    .update({ subject_profile: profile, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

/** Short-TTL signed URL for an image (admin, firm-scoped). */
export async function getCaseImageUrl(
  firmId: string,
  caseId: string,
  path: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) {
    // Co-counsel GUEST may VIEW the party portrait / case images of their
    // matter (read only - uploads stay firm-member-gated above).
    const { guestCanReadCase } = await import('./counsel-guest');
    if (!(await guestCanReadCase(caseId, firmId))) return { ok: false, error: gate.error };
  }
  if (!path.includes(`/${caseId}/case-images/`)) return { ok: false, error: 'Not in this matter.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ? { ok: true, url: data.signedUrl } : { ok: false, error: 'Could not open.' };
}
