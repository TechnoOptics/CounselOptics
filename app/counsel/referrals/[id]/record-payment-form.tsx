'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordReferralPaymentAction } from '@/lib/cocounsel-actions';

export function RecordPaymentForm({
  firmId,
  referralId,
  side,
  current,
}: {
  firmId: string;
  referralId: string;
  side: 'referring' | 'referred';
  current: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String((current / 100).toFixed(2)));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    const cents = Math.round(Number(amount.replace(/[^0-9.]/g, '')) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Amount must be non-negative.');
      return;
    }
    startTransition(async () => {
      const res = await recordReferralPaymentAction(
        firmId,
        referralId,
        side,
        cents,
      );
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Failed.');
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] mt-2 underline text-ink-600 dark:text-cream-100/70"
      >
        Update amount
      </button>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="input flex-1 text-[13px]"
      />
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="btn-primary text-sm"
      >
        {pending ? '...' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="btn-ghost text-sm"
      >
        Cancel
      </button>
      {error && (
        <span className="text-rose-700 dark:text-rose-300 text-[11px] ml-2">
          {error}
        </span>
      )}
    </div>
  );
}
