'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { convertLeadToCaseAction } from '@/lib/lead-conversion';
import { runGatedAction } from '@/lib/gated-action';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The exit from an accepted lead, on the same shape as the intake lane's
 * "Move to active queue": one button before, a link to the matter after.
 *
 * The page renders this only when the lead can actually be linked to a matter
 * (see LeadCaseLink), so the button is never drawn over a mechanism that is
 * not there.
 */
export function OpenMatterButton({
  firmId,
  leadId,
  caseId,
}: {
  firmId: string;
  leadId: string;
  /** Set once this lead has been opened into a matter. */
  caseId: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function convert() {
    setError(null);
    startTransition(async () => {
      const res = await runGatedAction(() =>
        convertLeadToCaseAction(firmId, leadId),
      );
      if (res.ok && res.caseId) {
        router.push(`/counsel/cases/${res.caseId}`);
      } else {
        setError(res.error ?? t('Could not open the matter.'));
      }
    });
  }

  if (caseId) {
    return (
      <div className="mt-3 border-t border-edge pt-3">
        <p className="text-[12px] leading-relaxed text-muted">
          <T>This lead is open as a matter.</T>
        </p>
        <a
          href={`/counsel/cases/${caseId}`}
          className="btn-secondary mt-2 w-full justify-center !py-1.5 text-[13px]"
        >
          <T>Open the matter &rarr;</T>
        </a>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <p className="text-[12px] leading-relaxed text-muted">
        <T>
          Open this as a matter and the name, summary and state carry over, so
          nothing needs re-keying.
        </T>
      </p>
      {error && (
        <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={convert}
        disabled={pending}
        className="btn-primary mt-2 w-full justify-center !py-1.5 text-[13px] disabled:opacity-60"
      >
        {pending ? <T>Opening…</T> : <T>Open a matter from this lead</T>}
      </button>
    </div>
  );
}
