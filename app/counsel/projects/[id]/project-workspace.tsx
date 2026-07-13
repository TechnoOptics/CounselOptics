'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { Project, ProjectFolder, ProjectItem } from '@/lib/project-types';
import { LinkCasePanel } from './link-case-panel';
import {
  addProjectNoteAction,
  uploadProjectDocumentAction,
  createFolderAction,
  renameFolderAction,
  deleteFolderAction,
  setItemArchivedAction,
  deleteProjectItemAction,
  setProjectArchivedAction,
  getProjectDocumentUrlAction,
} from '@/lib/projects-actions';

const ROOT = '__root__';

function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectWorkspace({
  firmId,
  project,
  folders,
  items,
  linkedCase,
  caseOptions,
}: {
  firmId: string;
  project: Project;
  folders: ProjectFolder[];
  items: ProjectItem[];
  linkedCase: { id: string; title: string; status: string } | null;
  caseOptions: Array<{ id: string; title: string; status: string }>;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  // Which folder's composer is open: `${folderKey}:${mode}` or null.
  const [composer, setComposer] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => (showArchived ? items : items.filter((i) => !i.archived)),
    [items, showArchived],
  );
  const docCount = useMemo(
    () => items.filter((i) => i.kind === 'document' && !i.archived).length,
    [items],
  );
  const itemsByFolder = useMemo(() => {
    const map = new Map<string, ProjectItem[]>();
    for (const it of visibleItems) {
      const key = it.folderId ?? ROOT;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return map;
  }, [visibleItems]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setComposer(null);
        setAddingFolder(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Something went wrong.'));
      }
    });
  }

  async function openDocument(itemId: string) {
    setError(null);
    const res = await getProjectDocumentUrlAction(firmId, itemId);
    if (!res.ok || !res.url) {
      setError(res.error ?? t('Could not open the document.'));
      return;
    }
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: res.url, toolbarColor: '#0b0b0d' });
    } else {
      window.open(res.url, '_blank', 'noopener');
    }
  }

  const sections: Array<{ key: string; label: string; folder?: ProjectFolder }> = [
    { key: ROOT, label: t('Unfiled') },
    ...folders.map((f) => ({ key: f.id, label: f.name, folder: f })),
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/counsel/projects"
            className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
          >
            ← <T>All projects</T>
          </Link>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-600 dark:text-cream-100/70">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-forest-700"
            />
            <T>Show archived</T>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                setProjectArchivedAction(firmId, project.id, project.status !== 'archived'),
              )
            }
            className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[12px] ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
          >
            {project.status === 'archived' ? <T>Unarchive project</T> : <T>Archive project</T>}
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      {/* Link this binder to the matter it is for */}
      <LinkCasePanel
        firmId={firmId}
        projectId={project.id}
        linkedCase={linkedCase}
        caseOptions={caseOptions}
        docCount={docCount}
      />

      {/* Add folder */}
      {addingFolder ? (
        <form
          className="card p-3 flex items-center gap-2"
          action={(fd) =>
            run(() => createFolderAction(firmId, project.id, String(fd.get('name') ?? '')))
          }
        >
          <input
            name="name"
            required
            autoFocus
            maxLength={160}
            placeholder={t('Folder name')}
            className="input flex-1"
          />
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
            <T>Add</T>
          </button>
          <button
            type="button"
            onClick={() => setAddingFolder(false)}
            className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[13px] text-ink-600 dark:text-cream-100/70"
          >
            <T>Cancel</T>
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddingFolder(true)}
          className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[13px] ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
        >
          + <T>New folder</T>
        </button>
      )}

      {/* Folders + items */}
      <div className="space-y-5">
        {sections.map((sec) => {
          const secItems = itemsByFolder.get(sec.key) ?? [];
          // Hide the empty Unfiled section unless it has items.
          if (sec.key === ROOT && secItems.length === 0) return null;
          const folderId = sec.folder ? sec.folder.id : null;
          return (
            <section key={sec.key} className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <FolderTitle
                  section={sec}
                  firmId={firmId}
                  projectId={project.id}
                  pending={pending}
                  onRename={(name) =>
                    sec.folder &&
                    run(() =>
                      renameFolderAction(firmId, sec.folder!.id, name, project.id),
                    )
                  }
                  onDelete={() =>
                    sec.folder &&
                    run(() => deleteFolderAction(firmId, sec.folder!.id, project.id))
                  }
                />
                <div className="flex items-center gap-1.5 text-[12px] shrink-0">
                  <button
                    type="button"
                    onClick={() => setComposer(`${sec.key}:note`)}
                    className="inline-flex items-center min-h-[34px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
                  >
                    + <T>Note</T>
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposer(`${sec.key}:doc`)}
                    className="inline-flex items-center min-h-[34px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
                  >
                    + <T>Document</T>
                  </button>
                </div>
              </div>

              {composer === `${sec.key}:note` && (
                <form
                  className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 space-y-2 bg-cream-50/40 dark:bg-forest-900/40"
                  action={(fd) =>
                    run(() =>
                      addProjectNoteAction(firmId, project.id, folderId, {
                        title: String(fd.get('title') ?? ''),
                        body: String(fd.get('body') ?? ''),
                      }),
                    )
                  }
                >
                  <input name="title" required maxLength={200} autoFocus placeholder={t('Note title')} className="input" />
                  <textarea name="body" rows={4} maxLength={20000} placeholder={t('Write your note…')} className="input resize-y" />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setComposer(null)} className="inline-flex items-center min-h-[36px] px-3 rounded-md text-[13px] text-ink-600 dark:text-cream-100/70"><T>Cancel</T></button>
                    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50"><T>Save note</T></button>
                  </div>
                </form>
              )}

              {composer === `${sec.key}:doc` && (
                <form
                  className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 space-y-2 bg-cream-50/40 dark:bg-forest-900/40"
                  action={(fd) => run(() => uploadProjectDocumentAction(firmId, project.id, folderId, fd))}
                >
                  <input name="title" maxLength={200} placeholder={t('Title (optional — defaults to file name)')} className="input" />
                  <input name="file" type="file" required className="text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-forest-600 file:px-3 file:py-1.5 file:text-cream-50 file:cursor-pointer" />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setComposer(null)} className="inline-flex items-center min-h-[36px] px-3 rounded-md text-[13px] text-ink-600 dark:text-cream-100/70"><T>Cancel</T></button>
                    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">{pending ? <T>Uploading…</T> : <T>Upload</T>}</button>
                  </div>
                </form>
              )}

              {secItems.length === 0 ? (
                <p className="text-[12px] text-ink-400 dark:text-cream-100/40 italic"><T>Empty.</T></p>
              ) : (
                <ul className="space-y-2">
                  {secItems.map((it) => (
                    <li
                      key={it.id}
                      className={`rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 ${it.archived ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex items-center gap-1.5">
                            <span className="text-ink-400 dark:text-cream-100/40 text-[11px] uppercase tracking-[0.1em]">
                              {it.kind === 'note' ? <T>Note</T> : <T>Doc</T>}
                            </span>
                            {it.title}
                          </p>
                          {it.kind === 'note' && it.noteBody && (
                            <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1 whitespace-pre-wrap line-clamp-4">
                              {it.noteBody}
                            </p>
                          )}
                          {it.kind === 'document' && (
                            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono">
                              {it.fileName} {it.fileSize ? `· ${fmtBytes(it.fileSize)}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] shrink-0">
                          {it.kind === 'document' && (
                            <button
                              type="button"
                              onClick={() => openDocument(it.id)}
                              className="inline-flex items-center min-h-[32px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
                            >
                              <T>Open</T>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() => setItemArchivedAction(firmId, it.id, !it.archived, project.id))
                            }
                            className="inline-flex items-center min-h-[32px] px-2.5 rounded-md text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
                          >
                            {it.archived ? <T>Unarchive</T> : <T>Archive</T>}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() => deleteProjectItemAction(firmId, it.id, project.id))
                            }
                            className="inline-flex items-center min-h-[32px] px-2.5 rounded-md text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                          >
                            <T>Delete</T>
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FolderTitle({
  section,
  onRename,
  onDelete,
  pending,
}: {
  section: { key: string; label: string; folder?: ProjectFolder };
  firmId: string;
  projectId: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!section.folder) {
    return (
      <p className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
        {section.label}
      </p>
    );
  }
  if (editing) {
    return (
      <form
        className="flex items-center gap-2 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          onRename(String(name ?? ''));
          setEditing(false);
        }}
      >
        <input name="name" defaultValue={section.label} autoFocus className="input flex-1" />
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={pending}>
          <T>Save</T>
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-[13px] text-ink-600 dark:text-cream-100/70 px-2">
          <T>Cancel</T>
        </button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <p className="font-display text-lg font-medium text-forest-900 dark:text-cream-100 truncate">
        {section.label}
      </p>
      <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-ink-500 dark:text-cream-100/55 hover:underline">
        <T>Rename</T>
      </button>
      {confirming ? (
        <span className="text-[11px]">
          <button type="button" disabled={pending} onClick={onDelete} className="text-rose-600 dark:text-rose-300 font-semibold">
            <T>Confirm delete</T>
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="ml-2 text-ink-500 dark:text-cream-100/55">
            <T>Cancel</T>
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-[11px] text-rose-500 dark:text-rose-300/80 hover:underline">
          <T>Delete</T>
        </button>
      )}
    </div>
  );
}
