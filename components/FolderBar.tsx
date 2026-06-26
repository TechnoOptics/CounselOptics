'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  createFolderAction,
  deleteFolderAction,
  type FolderKind,
} from '@/lib/folders-actions';

/**
 * Folder filter + management strip for the Vault and Contracts libraries.
 * "All" plus one chip per folder (with a count); a calm inline "New folder"
 * input; and a quiet "Remove this folder" action when one is selected.
 * Selecting a folder filters the list via the ?folder= query param, which
 * the server page reads.
 */
export function FolderBar({
  kind,
  folders,
  activeFolderId,
  basePath,
}: {
  kind: FolderKind;
  folders: { id: string; name: string; count: number }[];
  activeFolderId: string | null;
  basePath: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    const n = name.trim();
    if (!n) return;
    setError(null);
    startTransition(async () => {
      const res = await createFolderAction(kind, n);
      if (res.ok) {
        setName('');
        setAdding(false);
        router.refresh();
      } else {
        setError(res.error || 'Could not create the folder.');
      }
    });
  }

  function removeActive() {
    if (!activeFolderId) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteFolderAction(kind, activeFolderId);
      if (res.ok) {
        router.push(basePath);
        router.refresh();
      } else {
        setError(res.error || 'Could not remove the folder.');
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={basePath} active={!activeFolderId} label="All" />
        {folders.map((f) => (
          <Chip
            key={f.id}
            href={`${basePath}?folder=${f.id}`}
            active={activeFolderId === f.id}
            label={`${f.name} · ${f.count}`}
          />
        ))}

        {adding ? (
          <span className="inline-flex items-center gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  create();
                } else if (e.key === 'Escape') {
                  setAdding(false);
                  setName('');
                }
              }}
              placeholder="Folder name"
              maxLength={80}
              className="input h-8 w-40 py-1 text-sm"
            />
            <button
              type="button"
              onClick={create}
              disabled={pending || !name.trim()}
              className="btn-primary px-2.5 py-1 text-xs"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setName('');
                setError(null);
              }}
              className="px-1 text-xs text-ink-500 hover:text-ink-700 dark:text-cream-100/60 dark:hover:text-cream-100"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-300 px-3 py-1 text-[13px] text-ink-600 transition-colors hover:border-forest-700 hover:text-forest-900 dark:border-forest-700/60 dark:text-cream-100/70 dark:hover:text-cream-100"
          >
            + New folder
          </button>
        )}

        {activeFolderId && (
          <button
            type="button"
            onClick={removeActive}
            disabled={pending}
            className="ml-auto text-xs text-ink-500 hover:text-rose-700 dark:text-cream-100/55 dark:hover:text-rose-300"
          >
            Remove this folder
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-medium ring-1 transition-colors ${
        active
          ? 'bg-forest-900 text-white ring-forest-900 dark:bg-gold-metal dark:text-forest-950 dark:ring-gold-metal'
          : 'bg-white text-ink-700 ring-ink-200 hover:text-forest-900 dark:bg-forest-800/60 dark:text-cream-100/80 dark:ring-forest-700/50 dark:hover:text-cream-100'
      }`}
    >
      {label}
    </Link>
  );
}
