'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reopenSigningRequestAction } from '@/lib/signing-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

/**
 * Reopen a request a signer put on hold (rejected / requested changes)
 * instead of rebuilding it. Signers who already signed stay signed; the
 * objecting signer's link goes live again for the revised document.
 */
export function ReopenButton({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reopen() {
    setError(null);
    startTransition(async () => {
      const res = await runGatedAction(() => reopenSigningRequestAction(requestId));
      if (res.ok) router.refresh();
      else setError(res.error ?? t('Could not reopen.'));
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={reopen}
        disabled={pending}
        className="inline-flex items-center min-h-[40px] px-3 rounded-md bg-forest-700 text-white text-[13px] font-semibold hover:bg-forest-800 disabled:opacity-50"
      >
        {pending ? <T>Reopening…</T> : <T>Reopen for signing</T>}
      </button>
      {error && <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
}
