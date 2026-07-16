import 'server-only';
import type { createAdminSupabase } from './supabase/admin';

/**
 * Per-matter registry of evidence-folder metadata (who created each folder and
 * whether it is public). Folder MEMBERSHIP lives on the events themselves
 * (ai_extracted.collections); this registry carries only the folder-level
 * facts that don't belong to any one event. Storage-backed JSON (same
 * zero-migration pattern as secure shares): one small file per matter in the
 * private exhibits bucket, read/written exclusively through the admin client
 * by firm-gated server actions.
 *
 * Visibility rule: a folder with NO registry entry (created before this
 * feature) is public. `isPublic: true` = everyone who can view the case sees
 * the folder; `false` = only its creator sees it. This is a VIEW preference,
 * not an evidence wall - the items themselves stay visible in the evidence
 * list either way.
 */

export type EvidenceFolderMeta = {
  /** User id of whoever created the folder (null for legacy/unknown). */
  createdBy: string | null;
  /** True: every case viewer sees the folder. False: creator only. */
  isPublic: boolean;
  createdAt?: string;
};

export type EvidenceFolderRegistry = Record<string, EvidenceFolderMeta>;

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

const BUCKET = 'exhibits';
const registryPath = (caseId: string) => `case-meta/${caseId}/evidence-folders.json`;

export async function readEvidenceFolderRegistry(
  admin: Admin,
  caseId: string,
): Promise<EvidenceFolderRegistry> {
  try {
    const { data } = await admin.storage.from(BUCKET).download(registryPath(caseId));
    if (!data) return {};
    const parsed = JSON.parse(await data.text()) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: EvidenceFolderRegistry = {};
    for (const [name, meta] of Object.entries(parsed as Record<string, unknown>)) {
      if (!meta || typeof meta !== 'object') continue;
      const m = meta as Partial<EvidenceFolderMeta>;
      out[name] = {
        createdBy: typeof m.createdBy === 'string' ? m.createdBy : null,
        isPublic: m.isPublic !== false,
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeEvidenceFolderRegistry(
  admin: Admin,
  caseId: string,
  registry: EvidenceFolderRegistry,
): Promise<boolean> {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(registryPath(caseId), Buffer.from(JSON.stringify(registry)), {
      contentType: 'application/json',
      upsert: true,
    });
  return !error;
}

/** Whether this viewer may see the folder. No entry = legacy = public. */
export function canSeeEvidenceFolder(
  meta: EvidenceFolderMeta | undefined,
  viewerId: string | null,
): boolean {
  if (!meta || meta.isPublic) return true;
  return meta.createdBy !== null && meta.createdBy === viewerId;
}
