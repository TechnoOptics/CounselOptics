'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignTimeEntryToCaseAction } from '@/lib/time-tracking';
import { runGatedAction } from '@/lib/gated-action';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Put one orphaned entry onto a matter.
 *
 * Drawn only on rows the action can actually move: the caller's own entries,
 * with no matter and no invoice on them. Every other row keeps the plain
 * "None", because a control that would always be refused is not a control.
 */
export function AssignMatter({
  firmId,
  entryId,
  cases,
}: {
  firmId: string;
  entryId: string;
  cases: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const t = useT();
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const res = await runGatedAction(() =>
        assignTimeEntryToCaseAction(firmId, entryId, picked),
      );
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? t('That entry could not be moved.'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`assign-${entryId}`}>
          <T>Matter for this entry</T>
        </label>
        <select
          id={`assign-${entryId}`}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          disabled={pending}
          className="input !py-1 !text-[12px] max-w-[11rem]"
        >
          <option value="">{t('No matter')}</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={assign}
          disabled={pending || !picked}
          className="btn-secondary !py-1 !px-2 text-[11.5px] disabled:opacity-60"
        >
          {pending ? <T>Saving…</T> : <T>Assign</T>}
        </button>
      </div>
      {error && (
        <p className="text-[11.5px] text-rose-600 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
