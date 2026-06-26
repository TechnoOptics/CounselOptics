'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  moveReceiptToFolderAction,
  moveContractToFolderAction,
  type FolderKind,
} from '@/lib/folders-actions';

/**
 * Compact per-item folder picker. Changing the selection moves the item
 * (a vault receipt or a contract) into that folder, or out of all folders
 * when "No folder" is chosen. Stops click propagation so it works even
 * when the row is wrapped in a link.
 */
export function MoveToFolder({
  kind,
  itemId,
  folders,
  currentFolderId,
}: {
  kind: FolderKind;
  itemId: string;
  folders: { id: string; name: string }[];
  currentFolderId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    const folderId = value || null;
    if (folderId === (currentFolderId ?? null)) return;
    startTransition(async () => {
      const res =
        kind === 'vault'
          ? await moveReceiptToFolderAction(itemId, folderId)
          : await moveContractToFolderAction(itemId, folderId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <label
      className="inline-flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-cream-100/55"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span className="sr-only">Move to folder</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
      <select
        value={currentFolderId ?? ''}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[150px] rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px] text-ink-700 dark:border-forest-700/60 dark:bg-forest-900 dark:text-cream-100/80"
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
