'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCaseAssigneeAction } from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

export type AssigneeOption = { userId: string; label: string };

/**
 * Responsible-attorney picker on the matter detail. Persists to
 * cases.assigned_to via setCaseAssigneeAction, then refreshes so the
 * server-rendered header and the dashboard stay in sync.
 */
export function CaseAssigneePicker({
  caseId,
  members,
  currentAssigneeId,
}: {
  caseId: string;
  members: AssigneeOption[];
  currentAssigneeId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string>(currentAssigneeId ?? '');
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setCaseAssigneeAction(caseId, next || null);
      if (res.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(res.error ?? t('Could not update the assignee.'));
      }
    });
  }

  return (
    // Left-aligned at every width: this now sits at the left end of the
    // matter's action bar rather than in a right-aligned header column.
    <div className="flex flex-col items-start gap-1">
      <label className="eyebrow text-[10px]" htmlFor="case-assignee">
        <T>Assigned to</T>
      </label>
      <select
        id="case-assignee"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.currentTarget.value)}
        // data-no-translate: option labels are firm member names, not UI copy.
        data-no-translate
        className="input text-sm min-w-[12rem] disabled:opacity-60"
      >
        <option value="">{t('Unassigned')}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
