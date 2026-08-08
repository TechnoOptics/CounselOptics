'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recallSigningRequestAction } from '@/lib/signing-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

/**
 * Recall a signing request: its sign links stop working and signers
 * are notified. Two-step inline confirm (no native confirm(), which the
 * Capacitor WebView suppresses).
 */
export function RecallButton({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recall() {
    setError(null);
    startTransition(async () => {
      const res = await runGatedAction(() => recallSigningRequestAction(requestId));
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not recall.'));
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">
            <T>Recall and disable all links?</T>
          </span>
          <button
            type="button"
            onClick={recall}
            disabled={pending}
            className="inline-flex items-center min-h-[36px] px-3 rounded-md bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? <T>Recalling…</T> : <T>Confirm recall</T>}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="inline-flex items-center min-h-[36px] px-3 rounded-md ring-1 ring-edge text-[12px]"
          >
            <T>Cancel</T>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center min-h-[40px] px-3 rounded-md ring-1 ring-rose-200 dark:ring-rose-900/40 text-rose-700 dark:text-rose-300 text-[13px] hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          <T>Recall request</T>
        </button>
      )}
      {error && <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
}
