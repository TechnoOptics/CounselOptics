'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntakeFolderAction } from '@/lib/firm-actions';
import type { RequestFolder } from '@/lib/request-folders';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { BarSelect } from './bar-select';

/**
 * Inline folder assignment on a request - any legal-team member.
 *
 * Wears the action bar's field shape rather than its own, because it now
 * stands next to the owner select and two controls at two heights in one
 * strip reads as a mistake.
 */
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
  const t = useT();
  const [pending, startTransition] = useTransition();

  return (
    <BarSelect
      label={<T>Folder</T>}
      value={current}
      disabled={pending}
      onChange={(v) => {
        startTransition(async () => {
          await setIntakeFolderAction(firmId, intakeId, v);
          router.refresh();
        });
      }}
    >
      <option value="">{t('Unfiled')}</option>
      {folders.map((f) => (
        <option key={f.key} value={f.key}>
          {f.name}
        </option>
      ))}
    </BarSelect>
  );
}
