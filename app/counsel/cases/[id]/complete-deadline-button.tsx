'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeDeadlineAction } from '@/lib/deadlines-actions';

export function CompleteDeadlineButton({ deadlineId }: { deadlineId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          const res = await completeDeadlineAction(deadlineId);
          if (res.ok) router.refresh();
        });
      }}
      disabled={pending}
      className="text-[11px] underline text-emerald-700 dark:text-emerald-300"
    >
      {pending ? '...' : 'Complete'}
    </button>
  );
}
