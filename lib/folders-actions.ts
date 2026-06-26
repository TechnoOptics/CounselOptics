'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Folders for the consumer Vault and Contracts libraries. A folder is a
 * lightweight label scoped to one user and one surface ('vault' or
 * 'contract'); receipts/contracts carry a nullable folder_id. Deleting a
 * folder leaves its items in place (folder_id falls back to null via the
 * FK), so nothing a user uploaded is ever lost.
 */
export type FolderKind = 'vault' | 'contract';

const PATHS: Record<FolderKind, string> = {
  vault: '/vault',
  contract: '/contracts',
};

function isKind(k: unknown): k is FolderKind {
  return k === 'vault' || k === 'contract';
}

export async function createFolderAction(
  kind: FolderKind,
  name: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in first.' };
  if (!isKind(kind)) return { ok: false, error: 'Unknown folder type.' };
  const clean = (name ?? '').trim().slice(0, 80);
  if (!clean) return { ok: false, error: 'Please give the folder a name.' };

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('vault_folders')
    .insert({ user_id: user.id, kind, name: clean })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not create the folder.' };
  }
  revalidatePath(PATHS[kind]);
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteFolderAction(
  kind: FolderKind,
  folderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in first.' };
  if (!isKind(kind)) return { ok: false, error: 'Unknown folder type.' };
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('vault_folders')
    .delete()
    .eq('id', folderId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATHS[kind]);
  return { ok: true };
}

export async function moveReceiptToFolderAction(
  receiptId: string,
  folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Storage is not configured.' };

  const { data: r } = await admin
    .from('user_receipts')
    .select('id, user_id')
    .eq('id', receiptId)
    .maybeSingle();
  if (!r || (r as { user_id: string }).user_id !== user.id) {
    return { ok: false, error: 'That item was not found.' };
  }
  if (folderId) {
    const { data: f } = await admin
      .from('vault_folders')
      .select('id, user_id, kind')
      .eq('id', folderId)
      .maybeSingle();
    const folder = f as { user_id: string; kind: string } | null;
    if (!folder || folder.user_id !== user.id || folder.kind !== 'vault') {
      return { ok: false, error: 'That folder was not found.' };
    }
  }
  const { error } = await admin
    .from('user_receipts')
    .update({ folder_id: folderId })
    .eq('id', receiptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/vault');
  return { ok: true };
}

export async function moveContractToFolderAction(
  contractId: string,
  folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in first.' };
  const supabase = createServerSupabase();
  if (folderId) {
    const { data: f } = await supabase
      .from('vault_folders')
      .select('id, kind')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!f || (f as { kind: string }).kind !== 'contract') {
      return { ok: false, error: 'That folder was not found.' };
    }
  }
  const { error } = await supabase
    .from('user_contracts')
    .update({ folder_id: folderId })
    .eq('id', contractId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/contracts');
  return { ok: true };
}
