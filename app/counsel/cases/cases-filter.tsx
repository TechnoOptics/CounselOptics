'use client';

import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';

export type AssigneeFilterOption = { value: string; label: string };

/**
 * Assignee filter for the firm cases list. Drives the `?assignee=`
 * query param the server page reads to narrow the caseload:
 *   ''          -> everyone
 *   'me'        -> matters assigned to the signed-in attorney
 *   'unassigned'-> matters with no assignee
 *   <userId>    -> matters assigned to that member
 */
export function CasesFilter({
  options,
  current,
}: {
  options: AssigneeFilterOption[];
  current: string;
}) {
  const t = useT();
  const router = useRouter();

  function onChange(next: string) {
    const params = new URLSearchParams();
    if (next) params.set('assignee', next);
    const qs = params.toString();
    router.push(qs ? `/counsel/cases?${qs}` : '/counsel/cases');
  }

  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-600 dark:text-cream-100/70">
      <span className="uppercase tracking-wider font-mono text-[11px]">
        <T>Assignee</T>
      </span>
      <select
        value={current}
        onChange={(e) => onChange(e.currentTarget.value)}
        // data-no-translate: member-name options are user data.
        data-no-translate
        className="input text-sm py-1"
        aria-label={t('Filter by assignee')}
      >
        {options.map((o) => (
          <option key={o.value || 'all'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
