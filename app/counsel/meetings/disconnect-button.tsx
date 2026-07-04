'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { disconnectFirmIntegrationAction } from '@/lib/actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Disconnect button for an active integration. Two-step confirm so a
 * misclick doesn't drop the firm's calendar/meeting connection. Only
 * owners + admins can succeed; non-admins get a friendly error inline.
 */
export function DisconnectButton({
  firmId,
  provider,
}: {
  firmId: string;
  provider: 'microsoft' | 'zoom';
}) {
  const t = useT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await disconnectFirmIntegrationAction(firmId, provider);
      if (!res.ok) {
        setError(res.error ?? t('Disconnect failed.'));
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-secondary"
        >
          <T>Disconnect</T>
        </button>
        {error && (
          <p className="text-[11px] text-rose-700 dark:text-rose-300 w-full mt-1">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <span className="text-[12px] text-ink-700 dark:text-cream-100/80">
        <T>Are you sure?</T>
      </span>
      <button
        type="button"
        onClick={disconnect}
        disabled={pending}
        className="btn-primary"
      >
        {pending ? <T>Disconnecting…</T> : <T>Yes, disconnect</T>}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="btn-ghost"
      >
        <T>Cancel</T>
      </button>
    </>
  );
}
