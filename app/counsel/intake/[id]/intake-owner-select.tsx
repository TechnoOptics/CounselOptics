'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignIntakeAction } from '@/lib/intake-conversation';
import type { IntakePerson } from '@/lib/intake-conversation-types';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { BarSelect } from './bar-select';

/**
 * Who owns this request, as an inline select in the action bar.
 *
 * The same control used to sit inside the People block, three sections down
 * the record, which meant the single most-changed field on the screen was
 * the one you had to scroll for. The server action is unchanged and does
 * its own authorization; moving the control moves nothing but the control.
 */
export function IntakeOwnerSelect({
  intakeId,
  assignee,
  people,
}: {
  intakeId: string;
  assignee: IntakePerson | null;
  /** Everyone on the request; only the legal side can own it. */
  people: IntakePerson[];
}) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const legal = people.filter((p) => p.side === 'legal');

  return (
    <span className="inline-flex items-center gap-2">
      <BarSelect
        label={<T>Owner</T>}
        value={assignee?.userId ?? ''}
        disabled={pending}
        onChange={(v) => {
          setError(null);
          start(async () => {
            const res = await assignIntakeAction(intakeId, v || null);
            if (res.ok) router.refresh();
            else setError(res.error ?? t('That could not be saved.'));
          });
        }}
      >
        <option value="">{t('Unassigned')}</option>
        {legal.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name}
          </option>
        ))}
      </BarSelect>
      {error && (
        <span className="text-[12px] text-danger-text" data-no-translate>
          {error}
        </span>
      )}
    </span>
  );
}
