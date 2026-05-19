'use server';

import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

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

  // Authorize: legal member OR active employee of this firm.
  const [{ data: mem }, { data: emp }] = await Promise.all([
    admin
      .from('firm_members')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle(),
    admin
      .from('firm_employees')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .is('deactivated_at', null)
      .maybeSingle(),
  ]);
  if (!mem && !emp) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }

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
