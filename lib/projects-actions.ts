'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import type { Project, ProjectFolder, ProjectItem } from './project-types';

/**
 * Firm projects: a lightweight workspace of named folders holding notes
 * and documents, with an archive. All reads and writes go through the
 * RLS-scoped client, so firm-membership is enforced by the
 * firm_projects* member policies - no service-role writes except the
 * storage upload (pathed under the firm + project).
 */

// 50 MB / file — matches the firm document upload limit (firm-actions.ts) so
// the two upload surfaces are consistent (projects previously capped at 25 MB
// with the form stating no limit, which surprised users mid-upload).
const MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string): string {
  return (
    name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file'
  );
}

type ProjectRow = {
  id: string;
  firm_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  case_id: string | null;
  created_at: string;
  updated_at: string;
};
type FolderRow = {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
};
type ItemRow = {
  id: string;
  project_id: string;
  folder_id: string | null;
  kind: 'note' | 'document';
  title: string;
  note_body: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  archived: boolean;
  created_at: string;
};

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    description: r.description,
    status: r.status,
    caseId: r.case_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function toFolder(r: FolderRow): ProjectFolder {
  return { id: r.id, projectId: r.project_id, name: r.name, createdAt: r.created_at };
}
function toItem(r: ItemRow): ProjectItem {
  return {
    id: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
    kind: r.kind,
    title: r.title,
    noteBody: r.note_body,
    storagePath: r.storage_path,
    fileName: r.file_name,
    fileSize: r.file_size,
    fileType: r.file_type,
    archived: r.archived,
    createdAt: r.created_at,
  };
}

export async function listFirmProjects(firmId: string): Promise<Project[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_projects')
    .select('*')
    .eq('firm_id', firmId)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as ProjectRow[]).map(toProject);
}

export async function getProjectDetail(
  firmId: string,
  projectId: string,
): Promise<{ project: Project; folders: ProjectFolder[]; items: ProjectItem[] } | null> {
  const supabase = createServerSupabase();
  const { data: projectRow } = await supabase
    .from('firm_projects')
    .select('*')
    .eq('firm_id', firmId)
    .eq('id', projectId)
    .maybeSingle();
  if (!projectRow) return null;
  const [{ data: folderRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from('firm_project_folders')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('firm_project_items')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
  ]);
  return {
    project: toProject(projectRow as ProjectRow),
    folders: ((folderRows ?? []) as FolderRow[]).map(toFolder),
    items: ((itemRows ?? []) as ItemRow[]).map(toItem),
  };
}

export async function createProjectAction(
  firmId: string,
  input: { name: string; description?: string | null; caseId?: string | null },
): Promise<{ ok: boolean; error?: string; projectId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give the project a name.' };
  const supabase = createServerSupabase();
  // Only attach the case when it belongs to this firm, so a stray/forged
  // caseId can't link a project to another firm's matter.
  let caseId: string | null = null;
  if (input.caseId) {
    const { data: kase } = await supabase
      .from('cases')
      .select('id')
      .eq('id', input.caseId)
      .eq('firm_id', firmId)
      .maybeSingle();
    if (kase) caseId = input.caseId;
  }
  const { data, error } = await supabase
    .from('firm_projects')
    .insert({
      firm_id: firmId,
      name: name.slice(0, 200),
      description: input.description?.trim() || null,
      case_id: caseId,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create project.' };
  revalidatePath('/counsel/projects');
  return { ok: true, projectId: (data as { id: string }).id };
}

export async function setProjectArchivedAction(
  firmId: string,
  projectId: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_projects')
    .update({ status: archived ? 'archived' : 'active', updated_at: new Date().toISOString() })
    .eq('firm_id', firmId)
    .eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/projects');
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function createFolderAction(
  firmId: string,
  projectId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Name the folder.' };
  const supabase = createServerSupabase();
  const { error } = await supabase.from('firm_project_folders').insert({
    firm_id: firmId,
    project_id: projectId,
    name: trimmed.slice(0, 160),
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function renameFolderAction(
  firmId: string,
  folderId: string,
  name: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Name the folder.' };
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_project_folders')
    .update({ name: trimmed.slice(0, 160) })
    .eq('firm_id', firmId)
    .eq('id', folderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function deleteFolderAction(
  firmId: string,
  folderId: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  // Folder delete cascades its items (FK on delete cascade). Storage
  // files for those items are best-effort cleaned by the admin client.
  const admin = createAdminSupabase();
  if (admin) {
    const { data: docs } = await supabase
      .from('firm_project_items')
      .select('storage_path')
      .eq('folder_id', folderId)
      .not('storage_path', 'is', null);
    const paths = ((docs ?? []) as Array<{ storage_path: string | null }>)
      .map((d) => d.storage_path)
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) {
      await admin.storage.from('firm-documents').remove(paths);
    }
  }
  const { error } = await supabase
    .from('firm_project_folders')
    .delete()
    .eq('firm_id', firmId)
    .eq('id', folderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function addProjectNoteAction(
  firmId: string,
  projectId: string,
  folderId: string | null,
  input: { title: string; body: string },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Give the note a title.' };
  const supabase = createServerSupabase();
  const { error } = await supabase.from('firm_project_items').insert({
    firm_id: firmId,
    project_id: projectId,
    folder_id: folderId,
    kind: 'note',
    title: title.slice(0, 200),
    note_body: input.body.trim().slice(0, 20000) || null,
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function uploadProjectDocumentAction(
  firmId: string,
  projectId: string,
  folderId: string | null,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // Membership + project ownership check through the RLS client.
  const supabase = createServerSupabase();
  const { data: proj } = await supabase
    .from('firm_projects')
    .select('id')
    .eq('firm_id', firmId)
    .eq('id', projectId)
    .maybeSingle();
  if (!proj) return { ok: false, error: 'Project not found.' };

  const file = formData
    .getAll('file')
    .find(
      (f): f is File =>
        typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0,
    );
  if (!file) return { ok: false, error: 'Choose a file to upload.' };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That file is over the 25 MB limit.' };
  }
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `projects/${firmId}/${projectId}/${id}-${safeName(file.name)}`;
  const { error: upErr } = await admin.storage
    .from('firm-documents')
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error } = await supabase.from('firm_project_items').insert({
    firm_id: firmId,
    project_id: projectId,
    folder_id: folderId,
    kind: 'document',
    title: (String(formData.get('title') ?? '').trim() || file.name).slice(0, 200),
    storage_path: path,
    file_name: file.name.slice(0, 200),
    file_size: file.size,
    file_type: file.type || null,
    created_by: user.id,
  });
  if (error) {
    await admin.storage.from('firm-documents').remove([path]);
    return { ok: false, error: error.message };
  }
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function setItemArchivedAction(
  firmId: string,
  itemId: string,
  archived: boolean,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_project_items')
    .update({ archived, updated_at: new Date().toISOString() })
    .eq('firm_id', firmId)
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

export async function deleteProjectItemAction(
  firmId: string,
  itemId: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  const { data: item } = await supabase
    .from('firm_project_items')
    .select('storage_path')
    .eq('firm_id', firmId)
    .eq('id', itemId)
    .maybeSingle();
  const { error } = await supabase
    .from('firm_project_items')
    .delete()
    .eq('firm_id', firmId)
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  const path = (item as { storage_path: string | null } | null)?.storage_path;
  if (path) {
    const admin = createAdminSupabase();
    if (admin) await admin.storage.from('firm-documents').remove([path]);
  }
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

/** Short-TTL signed URL for a project document, after RLS confirms access. */
export async function getProjectDocumentUrlAction(
  firmId: string,
  itemId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const supabase = createServerSupabase();
  const { data: item } = await supabase
    .from('firm_project_items')
    .select('storage_path')
    .eq('firm_id', firmId)
    .eq('id', itemId)
    .maybeSingle();
  const path = (item as { storage_path: string | null } | null)?.storage_path;
  if (!path) return { ok: false, error: 'Document not found.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data, error } = await admin.storage
    .from('firm-documents')
    .createSignedUrl(path, 60 * 10);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not open.' };
  return { ok: true, url: data.signedUrl };
}
