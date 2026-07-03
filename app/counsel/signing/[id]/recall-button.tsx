'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recallSigningRequestAction } from '@/lib/signing-actions';

/**
 * Recall a signing request: its sign links stop working and signers
 * are notified. Two-step inline confirm (no native confirm(), which the
 * Capacitor WebView suppresses).
 */
export function RecallButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recall() {
    setError(null);
    startTransition(async () => {
      const res = await recallSigningRequestAction(requestId);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not recall.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-600 dark:text-cream-100/70">
            Recall and disable all links?
          </span>
          <button
            type="button"
            onClick={recall}
            disabled={pending}
            className="inline-flex items-center min-h-[36px] px-3 rounded-md bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? 'Recalling…' : 'Confirm recall'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="inline-flex items-center min-h-[36px] px-3 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[12px]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center min-h-[40px] px-3 rounded-md ring-1 ring-rose-200 dark:ring-rose-900/40 text-rose-700 dark:text-rose-300 text-[13px] hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          Recall request
        </button>
      )}
      {error && <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
}
