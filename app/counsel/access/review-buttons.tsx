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
  const [unsent, setUnsent] = useState(false);

  function run(kind: 'approve' | 'deny') {
    setError(null);
    setUnsent(false);
    startTransition(async () => {
      const res =
        kind === 'approve'
          ? await runGatedAction(() => approveAccessRequestAction(requestId))
          : await denyAccessRequestAction(requestId);
      if (!res.ok) {
        setError(res.error ?? t('Could not complete that.'));
        return;
      }
      // The decision is recorded either way. What varies is whether the
      // person it concerns was told, and that email is the only channel
      // they have: an external requester cannot sign in to read a screen.
      // So when it did not go out, hold the row here with a note rather
      // than refreshing it out of the queue as though the loop had closed.
      if (res.notified === false) {
        setUnsent(true);
        return;
      }
      router.refresh();
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
      {unsent && (
        <p className="max-w-[36ch] text-right text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
          <T>
            Your decision is saved, but we could not email it to them, so they
            have not been told. Reach out directly.
          </T>
        </p>
      )}
    </div>
  );
}
