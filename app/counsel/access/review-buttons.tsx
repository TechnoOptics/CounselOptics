'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveAccessRequestAction,
  denyAccessRequestAction,
} from '@/lib/access-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

export function ReviewButtons({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(kind: 'approve' | 'deny') {
    setError(null);
    startTransition(async () => {
      const res =
        kind === 'approve'
          ? await runGatedAction(() => approveAccessRequestAction(requestId))
          : await denyAccessRequestAction(requestId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? t('Could not complete that.'));
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
          className="btn text-muted hover:text-rose-600 dark:hover:text-rose-300 disabled:opacity-50"
        >
          <T>Decline</T>
        </button>
        <button
          type="button"
          onClick={() => run('approve')}
          disabled={pending}
          className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-50"
        >
          {pending ? <T>Working…</T> : <T>Approve</T>}
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
