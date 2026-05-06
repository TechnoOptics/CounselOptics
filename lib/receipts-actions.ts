'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { RECEIPT_CATEGORIES, type ReceiptCategory } from './contract-types';

/**
 * Receipts vault: just-in-case storage for the consumer side.
 * Photos, screenshots, voice memos, emails. No legal action
 * attached - the user is building a paper trail.
 *
 * Files land in the user-vault Supabase bucket, scoped by user_id.
 * RLS on user_receipts enforces same-user access.
 */
export async function uploadReceiptAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; receiptId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const file = formData.get('file');
  const label = String(formData.get('label') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() as ReceiptCategory;
  const description = String(formData.get('description') ?? '').trim() || null;
  const occurredAt = String(formData.get('occurredAt') ?? '').trim() || null;
  const source = String(formData.get('source') ?? '').trim() || null;
  const tagsRaw = String(formData.get('tags') ?? '').trim();

  if (!label) return { ok: false, error: 'Give it a label.' };
  if (!RECEIPT_CATEGORIES.find((c) => c.id === category)) {
    return { ok: false, error: 'Pick a category.' };
  }

  const tags = tagsRaw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let filePath: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > 50 * 1024 * 1024) {
      return { ok: false, error: 'File is over the 50 MB limit.' };
    }
    mimeType = file.type || 'application/octet-stream';
    fileSize = file.size;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 100);
    const id = crypto.randomUUID();
    filePath = `${user.id}/receipts/${id}/${safeName}`;
    const admin = createAdminSupabase();
    if (!admin) return { ok: false, error: 'Service role not configured.' };
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from('user-vault')
      .upload(filePath, buffer, { contentType: mimeType, upsert: false });
    if (uploadErr) {
      // Bucket may not exist yet on first run; degrade gracefully
      // and record the row metadata-only so the user doesn't lose
      // the entry.
      if ((uploadErr.message ?? '').toLowerCase().includes('bucket')) {
        filePath = null;
      } else {
        return { ok: false, error: uploadErr.message };
      }
    }
  }

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service role not configured.' };
  const { data, error } = await admin
    .from('user_receipts')
    .insert({
      user_id: user.id,
      label,
      category,
      description,
      file_path: filePath,
      mime_type: mimeType,
      file_size: fileSize,
      occurred_at: occurredAt,
      source,
      tags,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  revalidatePath('/vault');
  return { ok: true, receiptId: (data as { id: string }).id };
}

export async function deleteReceiptAction(
  receiptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service role not configured.' };
  const { data: receipt } = await admin
    .from('user_receipts')
    .select('id, user_id, file_path')
    .eq('id', receiptId)
    .maybeSingle();
  if (!receipt) return { ok: false, error: 'Not found.' };
  const r = receipt as { id: string; user_id: string; file_path: string | null };
  if (r.user_id !== user.id) return { ok: false, error: 'Not yours.' };
  if (r.file_path) {
    await admin.storage.from('user-vault').remove([r.file_path]);
  }
  await admin.from('user_receipts').delete().eq('id', receiptId);
  revalidatePath('/vault');
  return { ok: true };
}
