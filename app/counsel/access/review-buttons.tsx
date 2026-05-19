'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveAccessRequestAction,
  denyAccessRequestAction,
} from '@/lib/access-actions';

export function ReviewButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(kind: 'approve' | 'deny') {
    setError(null);
    startTransition(async () => {
      const res =
        kind === 'approve'
          ? await approveAccessRequestAction(requestId)
          : await denyAccessRequestAction(requestId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? 'Could not complete that.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run('deny')}
          disabled={pending}
          className="btn text-ink-600 dark:text-cream-100/65 hover:text-rose-600 dark:hover:text-rose-300 disabled:opacity-50"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => run('approve')}
          disabled={pending}
          className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-50"
        >
          {pending ? 'Working…' : 'Approve'}
        </button>
      </div>
      {error && (
        <p className="text-[11.5px] text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
