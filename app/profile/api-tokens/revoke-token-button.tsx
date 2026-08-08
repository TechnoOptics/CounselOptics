'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revokeTokenAction } from './actions';
// Rendered from the counsel route through TokensPanel. A pure passthrough
// outside a LocaleProvider, so the consumer route is unchanged.
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Revoke control for one issued token.
 *
 * Two steps, inline. Revoking cannot be undone: `revoked_at` is set once and
 * never cleared, and a revoked token can only be replaced by minting a new
 * one, which means the integration has to be reconfigured with the new
 * secret. So a single tap must not be enough.
 *
 * The confirm is inline rather than a native confirm() dialog, matching the
 * webhook manager and the meeting disconnect control: confirm() is suppressed
 * or inconsistently styled inside the Capacitor WebView, so on a phone the
 * tap would silently do nothing.
 *
 * This is a courtesy to a person, not a gate. The gate is inside
 * revokeTokenAction, which is a public HTTP endpoint whatever this renders.
 */
export function RevokeTokenButton({ tokenId }: { tokenId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function revoke() {
    setError(null);
    startTransition(async () => {
      const res = await revokeTokenAction(tokenId);
      setConfirming(false);
      if (!res.ok) {
        setError(res.error ?? t('Could not revoke that token.'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="shrink-0 text-right">
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="rounded-md bg-rose-600 text-white inline-flex items-center min-h-[36px] px-2.5 text-[11.5px] font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? <T>Revoking...</T> : <T>Confirm revoke</T>}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 inline-flex items-center min-h-[36px] px-2.5 text-[11.5px] text-ink-700 dark:text-cream-100/85 hover:bg-ink-50 dark:hover:bg-forest-900/50 disabled:opacity-50"
          >
            <T>Cancel</T>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md ring-1 ring-rose-200 dark:ring-rose-700/40 text-rose-700 dark:text-rose-300 inline-flex items-center min-h-[36px] px-2.5 text-[11.5px] font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          <T>Revoke</T>
        </button>
      )}
      {confirming && !error && (
        <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55 max-w-[15rem]">
          <T>Anything using this token stops working immediately.</T>
        </p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 max-w-[15rem]">
          {error}
        </p>
      )}
    </div>
  );
}
