'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setStatus } from '../set-status';
import { T, useT } from '@/components/i18n/LocaleProvider';

export type StatusOption = { value: string; label: string };

/**
 * Matter status picker on the matter detail, beside the responsible-attorney
 * picker: the two things this page can change in place.
 *
 * Reverts to the previous value and says why when the write is refused, for
 * the same reason the assignee picker does. A select that snaps back with no
 * explanation is how a person concludes the product is broken; a select that
 * stays put having written nothing is worse, because they conclude the
 * opposite.
 */
export function CaseStatusPicker({
  caseId,
  options,
  current,
}: {
  caseId: string;
  options: StatusOption[];
  current: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      // setStatus, not the action directly: see ../set-status.
      const res = await setStatus(caseId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(res.error ?? t('Could not change the matter status.'));
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <label className="eyebrow text-[10px]" htmlFor="case-status">
        <T>Status</T>
      </label>
      <select
        id="case-status"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="input text-sm min-w-[12rem] disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
