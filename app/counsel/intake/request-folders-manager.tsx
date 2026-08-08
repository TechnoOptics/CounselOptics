'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveRequestFolderAction,
  deleteRequestFolderAction,
} from '@/lib/firm-actions';
import type { RequestFolder } from '@/lib/request-folders';
import { T, useT } from '@/components/i18n/LocaleProvider';

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
  const t = useT();
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
        setError(res.error ?? t('Could not add folder.'));
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
        <p className="eyebrow"><T>Folders</T></p>
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
            placeholder={t('New folder (e.g. Contracts, Litigation, HR)')}
            className="input !py-1 text-[13px] w-64 max-w-[60vw]"
            disabled={pending}
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !name.trim()}
            className="btn-primary !py-1 text-[13px]"
          >
            <T>Add</T>
          </button>
        </div>
      </div>
      {initial.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {initial.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 ring-1 ring-edge px-2.5 py-1 text-[12px] text-foreground"
            >
              {f.name}
              <button
                type="button"
                onClick={() => remove(f.key)}
                disabled={pending}
                aria-label={`Delete ${f.name}`}
                className="text-muted hover:text-rose-600 dark:hover:text-rose-300"
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
