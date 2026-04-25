'use client';

import { useState, useTransition } from 'react';
import { setCaseStatusAction } from '@/lib/actions';
import type { CaseStatus } from '@/lib/types';

export function CloseCaseControl({
  caseId,
  status,
  isOwner,
}: {
  caseId: string;
  status: CaseStatus;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!isOwner) return null;
  const isClosed = status === 'closed' || status === 'archived';

  function setStatus(next: CaseStatus) {
    setError(null);
    startTransition(async () => {
      try {
        await setCaseStatusAction(caseId, next);
        setConfirming(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update status.');
      }
    });
  }

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Case lifecycle</p>
          <h2 className="text-lg font-semibold tracking-tight text-forest-900">
            {isClosed ? 'This case is closed' : 'Close this case'}
          </h2>
          <p className="text-sm text-ink-600 mt-1 max-w-xl leading-relaxed">
            {isClosed
              ? 'Closed cases stay readable and exportable, and move to the Closed cases section. Reopen any time.'
              : 'Closing locks the case in your Closed cases section. Exhibits and the case packet stay accessible. You can reopen any time.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isClosed ? (
            <button
              type="button"
              onClick={() => setStatus('open')}
              disabled={pending}
              className="btn-primary"
            >
              {pending ? 'Reopening...' : 'Reopen case'}
            </button>
          ) : confirming ? (
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStatus('closed')}
                disabled={pending}
                className="btn bg-rose-600 text-white hover:bg-rose-500"
              >
                {pending ? 'Closing...' : 'Confirm close'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              className="btn-secondary"
            >
              Close case
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 mt-3">
          {error}
        </p>
      )}
    </section>
  );
}
