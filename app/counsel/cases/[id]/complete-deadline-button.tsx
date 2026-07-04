'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeDeadlineAction } from '@/lib/deadlines-actions';
import { T } from '@/components/i18n/LocaleProvider';

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
      className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[11px] text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
    >
      {pending ? '...' : <T>Complete</T>}
    </button>
  );
}
