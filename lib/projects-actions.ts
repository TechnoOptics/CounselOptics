'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmMember } from './firm-authz';
import { createFirmCaseAction } from './firm-actions';
import { importFileAsCaseEvidence, loadCaseContext } from './case-evidence';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import type { Project, ProjectFolder, ProjectItem } from './project-types';

/**
 * Firm projects: a lightweight workspace of named folders holding notes
 * and documents, with an archive. Every ROW read and write goes through the
 * RLS-scoped client, so firm-membership on those is enforced by the
 * firm_projects* member policies.
 *
 * The STORAGE side does not work that way. Uploading, opening, copying and
 * deleting a project document all go through the service-role client, which
 * bypasses RLS on the object itself.
 *
 * There are 6 service-role storage calls in this file. Count them rather than
 * believe this sentence: `grep -cE 'admin\.storage' lib/projects-actions.ts`
 * (the pattern is escaped, so this line is not one of its own hits, and the
 * call form spans two lines in one place, so match on the receiver).
 * The number is written down because the last three times this file was
 * hardened, the fix reached every site somebody had listed and missed the one
 * nobody had. tests/project-storage-path-authorization.test.ts enumerates the
 * sites from the source, fails when the count above disagrees with it, and
 * fails when a new call appears without a gate, so neither the count nor the
 * list below can quietly go stale.
 *
 * They are NOT gated alike, so do not read one and assume the others.
 *
 *   - uploadProjectDocumentAction holds 2 of them, the upload and the remove
 *     that rolls it back. Both name a path this function just built from
 *     firmProjectPrefix, so there is nothing stored to validate; its only gate
 *     is the RLS-scoped `firm_projects` lookup at the top, and the
 *     firm_projects_member policy is what protects it. Removing that lookup
 *     would leave the upload unguarded.
 *   - deleteFolderAction, deleteProjectItemAction, getProjectDocumentUrlAction
 *     and pullProjectFilesIntoCaseAction hold the other 4, and every one of
 *     those hands a STORED path to the service role. Each calls
 *     callerIsFirmMember (lib/firm-authz.ts) and isFirmProjectPath, and on
 *     those four the in-action checks are the only authorization there is.
 */

// 50 MB / file, matching the firm document upload limit (firm-actions.ts) so
// the two upload surfaces are consistent (projects previously capped at 25 MB
// with the form stating no limit, which surprised users mid-upload).
const MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string): string {
  return (
    name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file'
  );
}

/**
 * Where one firm's project documents live in the firm-documents bucket.
 *
 * Written once and read by every guard below, so the layout the upload creates
 * and the layout the guards insist on cannot drift apart.
 */
function firmProjectPrefix(firmId: string): string {
  return `projects/${firmId}/`;
}

/**
 * A stored path may be handed to the SERVICE-ROLE client only when it names a
 * file inside `firmId`'s own project prefix.
 *
 * `firm_project_items.storage_path` is a plain column and the row policy on
 * that table constrains only `firm_id`, so its value is whatever the caller
 * chose to store. Every export of this module is a public HTTP endpoint, and
 * the service role bypasses RLS entirely, so a row that passes the row policy
 * proves nothing at all about the path it carries: a member of firm A can plant
 * a row of their own naming a file under firm B's prefix.
 *
 * It rejects, and never rewrites. A path that does not match is either a bug in
 * this module or somebody reaching for another firm's document, and silently
 * repointing it at something safe would hide both.
 */
function isFirmProjectPath(
  firmId: string,
  path: string | null | undefined,
): path is string {
  if (!firmId || !path) return false;
  // A traversal segment would let a matching prefix still resolve elsewhere.
  if (path.includes('..')) return false;
  return path.startsWith(firmProjectPrefix(firmId));
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
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const supabase = createServerSupabase();
  // Folder delete cascades its items (FK on delete cascade), so the paths have
  // to be read while the rows still exist. Reading is not irreversible; the
  // wipe below is, and it waits until the folder delete has actually landed.
  const { data: docs } = await supabase
    .from('firm_project_items')
    .select('storage_path')
    .eq('firm_id', firmId)
    .eq('folder_id', folderId)
    .not('storage_path', 'is', null);
  const { data: deleted, error } = await supabase
    .from('firm_project_folders')
    .delete()
    .eq('firm_id', firmId)
    .eq('id', folderId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // PostgREST reports a delete that matched nothing as a success, so an empty
  // result is the refusal and has to be told to the caller.
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: 'That folder is not in this firm.' };
  }
  const paths = ((docs ?? []) as Array<{ storage_path: string | null }>)
    .map((d) => d.storage_path)
    .filter((p): p is string => isFirmProjectPath(firmId, p));
  if (paths.length > 0) {
    const admin = createAdminSupabase();
    if (admin) await admin.storage.from('firm-documents').remove(paths);
  }
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
  const path = `${firmProjectPrefix(firmId)}${projectId}/${id}-${safeName(file.name)}`;
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
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const supabase = createServerSupabase();
  // The delete returns the row it removed, so the path comes back from the
  // write that was already gated rather than from a separate read.
  const { data: deleted, error } = await supabase
    .from('firm_project_items')
    .delete()
    .eq('firm_id', firmId)
    .eq('id', itemId)
    .select('storage_path');
  if (error) return { ok: false, error: error.message };
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: 'That item is not in this firm.' };
  }
  const path = (deleted as Array<{ storage_path: string | null }>)[0].storage_path;
  if (isFirmProjectPath(firmId, path)) {
    const admin = createAdminSupabase();
    if (admin) await admin.storage.from('firm-documents').remove([path]);
  }
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: true };
}

/** Short-TTL signed URL for a project document, for a member of its firm. */
export async function getProjectDocumentUrlAction(
  firmId: string,
  itemId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const supabase = createServerSupabase();
  const { data: item } = await supabase
    .from('firm_project_items')
    .select('storage_path')
    .eq('firm_id', firmId)
    .eq('id', itemId)
    .maybeSingle();
  const path = (item as { storage_path: string | null } | null)?.storage_path;
  if (!path) return { ok: false, error: 'Document not found.' };
  if (!isFirmProjectPath(firmId, path)) {
    return { ok: false, error: 'That file is not in this firm.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data, error } = await admin.storage
    .from('firm-documents')
    .createSignedUrl(path, 60 * 10);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not open.' };
  return { ok: true, url: data.signedUrl };
}

// ── Project ↔ Case linking ────────────────────────────────────────────────
//
// A project (a firm's working binder of notes + documents) can be bound to the
// matter it is for. From there a firm can pull the binder's documents straight
// into the case's evidence timeline. All writes are firm-membership gated: the
// project + case are both confirmed to belong to `firmId` before any change,
// and the evidence import runs through the admin client (case_timeline_events
// RLS is case-membership only, which firm members are not, so firm-case writes
// go through admin exactly like createFirmCaseAction).

/** Light case options for the "associate an existing case" picker. */
export async function listFirmCaseOptions(
  firmId: string,
): Promise<Array<{ id: string; title: string; status: string }>> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('cases')
    .select('id, title, status')
    .eq('firm_id', firmId)
    .order('updated_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<{ id: string; title: string; status: string }>).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
  }));
}

/** The case a project is linked to (title + status), or null. */
export async function getLinkedCaseAction(
  firmId: string,
  caseId: string,
): Promise<{ id: string; title: string; status: string } | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('cases')
    .select('id, title, status')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  return (data as { id: string; title: string; status: string } | null) ?? null;
}

/** Bind an existing firm case to a project (both must belong to `firmId`). */
export async function associateProjectWithCaseAction(
  firmId: string,
  projectId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await callerIsFirmMember(firmId))) return { ok: false, error: 'You do not have access to this firm.' };
  const supabase = createServerSupabase();
  // Both sides must belong to this firm, so a stray/forged id can't cross firms.
  const [{ data: proj }, { data: kase }] = await Promise.all([
    supabase.from('firm_projects').select('id').eq('id', projectId).eq('firm_id', firmId).maybeSingle(),
    supabase.from('cases').select('id').eq('id', caseId).eq('firm_id', firmId).maybeSingle(),
  ]);
  if (!proj) return { ok: false, error: 'Project not found.' };
  if (!kase) return { ok: false, error: 'That case is not in this firm.' };

  const { error } = await supabase
    .from('firm_projects')
    .update({ case_id: caseId, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

/** Unbind a project from its case (leaves the case untouched). */
export async function unlinkProjectFromCaseAction(
  firmId: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await callerIsFirmMember(firmId))) return { ok: false, error: 'You do not have access to this firm.' };
  const supabase = createServerSupabase();
  const { data: proj } = await supabase
    .from('firm_projects').select('case_id').eq('id', projectId).eq('firm_id', firmId).maybeSingle();
  const priorCaseId = (proj as { case_id: string | null } | null)?.case_id ?? null;
  const { error } = await supabase
    .from('firm_projects')
    .update({ case_id: null, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/projects/${projectId}`);
  if (priorCaseId) revalidatePath(`/counsel/cases/${priorCaseId}`);
  return { ok: true };
}

/** Open a new firm matter from a project, then link the project to it. */
export async function createCaseFromProjectAction(
  firmId: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string; caseId?: string }> {
  if (!(await callerIsFirmMember(firmId))) return { ok: false, error: 'You do not have access to this firm.' };
  const supabase = createServerSupabase();
  const { data: projRow } = await supabase
    .from('firm_projects')
    .select('id, name, description')
    .eq('id', projectId)
    .eq('firm_id', firmId)
    .maybeSingle();
  const project = projRow as { id: string; name: string; description: string | null } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const created = await createFirmCaseAction(firmId, {
    title: project.name,
    subject: project.name,
  });
  if (!created.ok || !created.caseId) {
    return { ok: false, error: created.error ?? 'Could not open the matter.' };
  }

  // Carry the project description onto the matter (createFirmCaseAction opens
  // with an empty description); admin write, firm membership already confirmed.
  if (project.description?.trim()) {
    const admin = createAdminSupabase();
    if (admin) {
      await admin.from('cases').update({ description: project.description.trim() }).eq('id', created.caseId);
    }
  }

  const link = await associateProjectWithCaseAction(firmId, projectId, created.caseId);
  if (!link.ok) return { ok: false, error: link.error };
  revalidatePath(`/counsel/projects/${projectId}`);
  revalidatePath('/counsel/cases');
  return { ok: true, caseId: created.caseId };
}

/**
 * Pull a project's uploaded documents into its linked case as evidence
 * timeline entries. Each document is copied from the firm-documents bucket
 * into the exhibits bucket and gets its own case_timeline_events row, analysed
 * inline when the firm is on a plan that includes timeline analysis.
 */
export async function pullProjectFilesIntoCaseAction(
  firmId: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string; imported?: number; failed?: number; errors?: string[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await callerIsFirmMember(firmId))) return { ok: false, error: 'You do not have access to this firm.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const supabase = createServerSupabase();

  const { data: projRow } = await supabase
    .from('firm_projects')
    .select('id, name, case_id')
    .eq('id', projectId)
    .eq('firm_id', firmId)
    .maybeSingle();
  const project = projRow as { id: string; name: string; case_id: string | null } | null;
  if (!project) return { ok: false, error: 'Project not found.' };
  if (!project.case_id) return { ok: false, error: 'Link this project to a case first.' };

  // Confirm the linked case is still in this firm before writing to it.
  const { data: kase } = await supabase
    .from('cases').select('id').eq('id', project.case_id).eq('firm_id', firmId).maybeSingle();
  if (!kase) return { ok: false, error: 'The linked case is not in this firm.' };
  const caseId = project.case_id;

  const { data: itemRows } = await supabase
    .from('firm_project_items')
    .select('id, title, storage_path, file_name, file_type')
    .eq('project_id', projectId)
    .eq('kind', 'document')
    .eq('archived', false)
    .not('storage_path', 'is', null);
  const docs = ((itemRows ?? []) as Array<{
    id: string; title: string; storage_path: string | null; file_name: string | null; file_type: string | null;
  }>).filter((d) => d.storage_path);
  if (docs.length === 0) return { ok: false, error: 'This project has no documents to pull in.' };

  const aiEligible = aiConfigured() && (await resolveTimelineAccess()) === 'firm';
  const caseContext = aiEligible ? await loadCaseContext(admin, caseId) : null;

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  // Cap the batch so one action stays within server time limits; the button
  // can be pressed again for the remainder.
  for (const doc of docs.slice(0, 25)) {
    const name = doc.file_name || doc.title || 'document';
    // `storage_path` is a plain column on a row policed only on firm_id, so a
    // member of this firm can plant a row naming a file under another firm's
    // prefix. Refuse it BEFORE the download, not after: this path does not
    // hand back a link, it copies the bytes into a matter as a durable
    // exhibit, and a check that runs after the fetch has already lost.
    if (!isFirmProjectPath(firmId, doc.storage_path)) {
      failed++;
      errors.push(`${name}: that file is not in this firm.`);
      continue;
    }
    const storagePath = doc.storage_path;
    try {
      const dl = await admin.storage.from('firm-documents').download(storagePath);
      if (!dl.data) {
        failed++;
        continue;
      }
      const buffer = Buffer.from(await dl.data.arrayBuffer());
      const res = await importFileAsCaseEvidence({
        admin,
        caseId,
        userId: user.id,
        buffer,
        name,
        mime: doc.file_type || 'application/octet-stream',
        sourceLabel: `Project: ${project.name}`,
        analyze: aiEligible,
        caseContext,
      });
      if (res.ok) imported++;
      else {
        failed++;
        if (res.error) errors.push(`${name}: ${res.error}`);
      }
    } catch (err) {
      failed++;
      errors.push(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  revalidatePath(`/counsel/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/timeline`);
  revalidatePath(`/counsel/projects/${projectId}`);
  return { ok: imported > 0, imported, failed, errors: errors.slice(0, 5) };
}
