'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  resendCounselInviteAction,
  revokeCounselGrantAction,
} from '@/lib/firm-actions';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function GrantActions({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function resend() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await resendCounselInviteAction(grantId);
      if (!res.ok) setError(res.error ?? 'Could not resend.');
      else {
        setOk('Email resent.');
        router.refresh();
      }
    });
  }

  function revoke() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await revokeCounselGrantAction(grantId);
      if (!res.ok) setError(res.error ?? 'Could not revoke.');
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="btn-ghost text-[12px]"
      >
        {pending ? '...' : 'Resend email'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="btn-ghost text-[12px] text-rose-700 dark:text-rose-300"
      >
        Revoke
      </button>
      {error && (
        <span className="text-[11px] text-rose-700 dark:text-rose-300">{error}</span>
      )}
      {ok && (
        <span className="text-[11px] text-emerald-700 dark:text-emerald-300">{ok}</span>
      )}

      {/* Was a native confirm(), which the Capacitor WebView suppresses. */}
      {confirming && (
        <ConfirmDialog
          question="Revoke this invitation?"
          detail="The link stops working. Whoever it was sent to can no longer use it, and a new invitation would have to be sent."
          confirmLabel="Revoke"
          busy={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            revoke();
          }}
        />
      )}
    </div>
  );
}
