'use server';

import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';
import {
  extractFileText,
  scoreDocument,
  type DocScorecard,
} from './doc-review';

export type IntakeAttachment = {
  name: string;
  path: string;
  size: number;
  type: string;
};

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB / file
const MAX_FILES = 8;

function safeName(name: string): string {
  return (
    name
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 120) || 'file'
  );
}

/**
 * Upload intake attachments for an enterprise employee or a legal
 * member. Employees aren't firm_members so storage RLS would block a
 * direct client upload (same class of failure as the intake row);
 * here we verify the caller really belongs to the firm (member OR
 * active employee) and write via the service-role storage client,
 * pathed under the firm + uploader so it can't collide or leak.
 */
export async function uploadIntakeFilesAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; files?: IntakeAttachment[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // Authorize: legal member, or an active employee whose role can file
  // requests. Uploading attachments is part of filing, so it shares the
  // requests.create entitlement - hiding the form in the UI is not a
  // server-side gate on its own.
  const auth = await authorizeFirmActor(
    admin,
    firmId,
    user.id,
    'requests.create',
  );
  if (!auth.ok) return { ok: false, error: auth.error };

  const raw = formData.getAll('attachments');
  const blobs = raw.filter(
    (f): f is File => typeof f === 'object' && f !== null && 'size' in f,
  );
  const files: IntakeAttachment[] = [];
  for (const f of blobs.slice(0, MAX_FILES)) {
    if (!f.size) continue;
    if (f.size > MAX_BYTES) {
      return {
        ok: false,
        error: `"${f.name}" is over 25 MB. Please attach a smaller file or share a link.`,
      };
    }
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `intake-uploads/${firmId}/${user.id}/${id}-${safeName(
      f.name,
    )}`;
    const { error } = await admin.storage
      .from('firm-documents')
      .upload(path, f, {
        contentType: f.type || 'application/octet-stream',
        upsert: false,
      });
    if (error) {
      return { ok: false, error: `Upload failed: ${error.message}` };
    }
    files.push({
      name: f.name,
      path,
      size: f.size,
      type: f.type || 'application/octet-stream',
    });
  }
  return { ok: true, files };
}

/**
 * Run an attached document through Advottic Review and return a
 * scorecard. The employee intake form calls this before submit and
 * gates the form on the resulting grade (C or higher passes).
 */
export async function reviewIntakeAttachmentAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; scorecard?: DocScorecard; fileName?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // This is the in-flow quality gate on an intake attachment (a costed
  // AI call), not the standalone Review tool - the intake form requires
  // a passing grade before a request with an attachment can be filed.
  // So it shares the requests.create entitlement: a view-only employee
  // who can't file at all must not be able to spend AI calls here, but
  // any role that can legitimately file requests can run it.
  const auth = await authorizeFirmActor(
    admin,
    firmId,
    user.id,
    'requests.create',
  );
  if (!auth.ok) return { ok: false, error: auth.error };

  const raw = formData.getAll('attachments');
  const file = raw.find(
    (f): f is File =>
      typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0,
  );
  const pasted = String(formData.get('reviewText') ?? '').trim();

  let text = pasted;
  let fileName: string | undefined;
  if (file) {
    fileName = file.name;
    if (file.size > MAX_BYTES) {
      return { ok: false, error: 'That file is over 25 MB to review.' };
    }
    const ext = await extractFileText(file);
    if (ext.text.trim().length >= 120) {
      text = ext.text;
    } else if (!pasted) {
      return {
        ok: false,
        error:
          ext.error ??
          'Could not read enough text from that file. Upload a PDF, Word, or text file, or paste the contract text.',
      };
    }
  }
  if (text.trim().length < 120) {
    return {
      ok: false,
      error: 'Attach a document or paste the contract text to review it.',
    };
  }

  const { data: firmRow } = await admin
    .from('firms')
    .select('name, jurisdictions, practice_areas')
    .eq('id', firmId)
    .maybeSingle();
  const fr = firmRow as {
    name?: string;
    jurisdictions?: string[] | null;
    practice_areas?: string[] | null;
  } | null;

  const result = await scoreDocument({
    text,
    matterType: String(formData.get('requestType') ?? '') || null,
    state: String(formData.get('state') ?? '') || null,
    firmName: fr?.name ?? null,
    jurisdictions: fr?.jurisdictions ?? [],
    practiceAreas: fr?.practice_areas ?? [],
  });
  if ('error' in result) return { ok: false, error: result.error };
  return { ok: true, scorecard: result, fileName };
}
