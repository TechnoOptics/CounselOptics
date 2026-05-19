'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntakeFolderAction } from '@/lib/firm-actions';
import type { RequestFolder } from '@/lib/request-folders';

/** Inline folder assignment on a request - any legal-team member. */
export function FolderPicker({
  firmId,
  intakeId,
  current,
  folders,
}: {
  firmId: string;
  intakeId: string;
  current: string;
  folders: RequestFolder[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-[12px]">
      <span className="text-ink-500 dark:text-cream-100/55 uppercase tracking-[0.14em] font-semibold">
        Folder
      </span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(async () => {
            await setIntakeFolderAction(firmId, intakeId, v);
            router.refresh();
          });
        }}
        className="rounded-md bg-transparent ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-1 text-ink-800 dark:text-cream-100/85 disabled:opacity-50"
      >
        <option value="">Unfiled</option>
        {folders.map((f) => (
          <option key={f.key} value={f.key}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
