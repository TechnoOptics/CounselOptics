'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntakeFolderAction } from '@/lib/firm-actions';
import type { RequestFolder } from '@/lib/request-folders';
import { T } from '@/components/i18n/LocaleProvider';

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
      <span className="text-muted uppercase tracking-[0.14em] font-semibold">
        <T>Folder</T>
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
        className="rounded-md bg-transparent ring-1 ring-edge px-2 py-1 text-foreground disabled:opacity-50"
      >
        <option value=""><T>Unfiled</T></option>
        {folders.map((f) => (
          <option key={f.key} value={f.key}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
