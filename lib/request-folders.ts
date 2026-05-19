/**
 * Request folders / sections.
 *
 * Legal teams want intakes organized, not one flat list. An admin
 * defines folders (firms.metadata.requestFolders); each intake is
 * filed into one via intake_answers.folder (the folder key). No
 * schema - same metadata + JSON pattern as roles/menu. Pure so the
 * list page, detail page, and admin UI all share it.
 */

export type RequestFolder = { key: string; name: string };

export function slugifyFolderKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `folder-${Date.now().toString(36)}`
  );
}

export function readRequestFolders(metadata: unknown): RequestFolder[] {
  const raw = (metadata as { requestFolders?: unknown } | null)
    ?.requestFolders;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RequestFolder[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const key = String(o.key ?? '').trim();
    const name = String(o.name ?? '').trim();
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: name.slice(0, 48) });
  }
  return out;
}

/** The folder key stored on an intake (or '' for unfiled). */
export function readIntakeFolder(
  intakeAnswers: unknown,
): string {
  const f = (intakeAnswers as { folder?: unknown } | null)?.folder;
  return typeof f === 'string' ? f : '';
}
