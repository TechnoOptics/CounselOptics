'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveRequestFolderAction,
  deleteRequestFolderAction,
} from '@/lib/firm-actions';
import type { RequestFolder } from '@/lib/request-folders';

/**
 * Owner/admin: create the folders/sections requests get organized
 * into. Assigning an intake to a folder happens on the request
 * itself (any legal-team member can file it there).
 */
export function RequestFoldersManager({
  firmId,
  initial,
}: {
  firmId: string;
  initial: RequestFolder[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set('name', name.trim());
    setError(null);
    startTransition(async () => {
      const res = await saveRequestFolderAction(firmId, fd);
      if (res.ok) {
        setName('');
        router.refresh();
      } else {
        setError(res.error ?? 'Could not add folder.');
      }
    });
  }

  function remove(key: string) {
    startTransition(async () => {
      await deleteRequestFolderAction(firmId, key);
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Folders</p>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="New folder (e.g. Contracts, Litigation, HR)"
            className="input !py-1 text-[13px] w-64 max-w-[60vw]"
            disabled={pending}
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !name.trim()}
            className="btn-primary !py-1 text-[13px]"
          >
            Add
          </button>
        </div>
      </div>
      {initial.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {initial.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-cream-50 dark:bg-forest-800/50 ring-1 ring-ink-200 dark:ring-forest-700/40 px-2.5 py-1 text-[12px] text-ink-700 dark:text-cream-100/85"
            >
              {f.name}
              <button
                type="button"
                onClick={() => remove(f.key)}
                disabled={pending}
                aria-label={`Delete ${f.name}`}
                className="text-ink-400 hover:text-rose-600 dark:hover:text-rose-300"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <p className="text-[12px] text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
