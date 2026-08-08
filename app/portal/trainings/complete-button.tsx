'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeTrainingAction } from '@/lib/hub-actions';

export function CompleteTrainingButton({
  assignmentId,
}: {
  assignmentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await completeTrainingAction(assignmentId);
            if (res.ok) router.refresh();
            else setError(res.error ?? 'Could not update.');
          })
        }
        className="btn text-[12px] bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Mark complete'}
      </button>
      {error && (
        <p className="text-[11px] text-danger-text">{error}</p>
      )}
    </div>
  );
}
