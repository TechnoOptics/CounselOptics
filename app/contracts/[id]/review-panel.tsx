'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewContractAction } from '@/lib/contracts-actions';

export function ReviewPanel({
  contractId,
  initialReviewedAt,
}: {
  contractId: string;
  initialReviewedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await reviewContractAction(contractId);
      if (!res.ok) {
        setError(res.error ?? 'Review failed.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="btn-primary text-sm"
      >
        {pending ? 'Bella reviewing...' : initialReviewedAt ? 'Re-run review' : 'Run review'}
      </button>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
