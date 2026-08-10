'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { convertIntakeToCaseAction } from '@/lib/firm-actions';
import { runGatedAction } from '@/lib/gated-action';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The action bar's primary: take this request on as a matter.
 *
 * Once it has been taken on there is nothing left to do here, so the button
 * becomes the link to the matter it produced rather than staying a control
 * that would do the same thing twice.
 */
export function ConvertToMatter({
  firmId,
  intakeId,
  caseId = null,
}: {
  firmId: string;
  intakeId: string;
  /** Set once this request has become a matter. */
  caseId?: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (caseId) {
    return (
      <a
        href={`/counsel/cases/${caseId}`}
        className="btn-secondary !py-1.5 whitespace-nowrap text-[13px]"
      >
        <T>Open the matter &rarr;</T>
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span className="text-[12px] text-danger-text" data-no-translate>
          {error}
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runGatedAction(() => convertIntakeToCaseAction(firmId, intakeId));
            if (res.ok && res.caseId) router.push(`/counsel/cases/${res.caseId}`);
            else setError(res.error ?? t('Could not open the matter.'));
          });
        }}
        className="btn-primary !py-1.5 whitespace-nowrap text-[13px] disabled:opacity-60"
      >
        {pending ? <T>Moving&hellip;</T> : <T>Take it on as a matter</T>}
      </button>
    </span>
  );
}
