'use client';

import { useState, useTransition } from 'react';
import { rescanUnreadExhibitsAction, type BulkScanResult } from '@/lib/actions';

/**
 * Read every exhibit on this case that has not been read yet.
 *
 * The results list is the point of this component, not the button. A person
 * preparing for a hearing needs to know exactly which exhibits are still
 * unread and why, so each one is named with its own outcome. An aggregate
 * "done" would let somebody walk into court believing their evidence had been
 * read when some of it had not.
 *
 * The action returns its refusals as values rather than throwing them, so the
 * catch here is only for a genuine transport failure.
 */
export function BulkScanPanel({
  caseId,
  unreadCount,
  totalCount,
}: {
  caseId: string;
  unreadCount: number;
  totalCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (unreadCount === 0 && !result) return null;

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await rescanUnreadExhibitsAction(caseId);
        if (!res.ok) {
          setError(res.error || 'That did not finish. Please try again in a moment.');
          setResult(null);
          return;
        }
        setResult(res);
      } catch {
        setError('That did not finish. Check your connection and try again.');
      }
    });
  }

  const scanned = result?.outcomes.filter((o) => o.status === 'scanned') ?? [];
  const failed = result?.outcomes.filter((o) => o.status === 'failed') ?? [];
  const notAttempted = result?.outcomes.filter((o) => o.status === 'not-attempted') ?? [];

  return (
    <div className="card p-6 mt-6 border border-gold-300 bg-cream-50/60">
      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700">
        Reading your exhibits
      </p>

      {unreadCount > 0 && (
        <p className="mt-2 text-sm text-ink-800 leading-relaxed">
          {unreadCount} of your {totalCount} exhibit{totalCount === 1 ? '' : 's'}{' '}
          {unreadCount === 1 ? 'has' : 'have'} not been read yet. Until{' '}
          {unreadCount === 1 ? 'it is' : 'they are'} read, nothing in your
          summary, chronology or packet can draw on what{' '}
          {unreadCount === 1 ? 'it says' : 'they say'}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? 'Reading...' : `Read the unread exhibit${unreadCount === 1 ? '' : 's'}`}
        </button>
        <span className="text-xs text-ink-500">
          They are read one at a time, so each result is reported on its own.
        </span>
      </div>

      {error && (
        <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-ink-800">
            {result.scanned} read
            {failed.length > 0 ? `, ${failed.length} could not be read` : ''}
            {notAttempted.length > 0
              ? `, ${notAttempted.length} not reached in this run`
              : ''}
            .
          </p>

          {result.outcomes.length > 0 && (
            <ul className="divide-y divide-ink-100 border border-ink-100 rounded-lg overflow-hidden">
              {result.outcomes.map((o) => (
                <li key={o.exhibitId} className="px-4 py-3 bg-white">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-ink-950 text-white font-mono tracking-wide">
                      {o.label}
                    </span>
                    <span className="text-sm text-ink-800 truncate">{o.fileName}</span>
                    <span
                      className={
                        o.status === 'scanned'
                          ? 'text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5'
                          : o.status === 'failed'
                            ? 'text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-0.5'
                            : 'text-xs text-ink-600 bg-ink-50 border border-ink-200 rounded px-2 py-0.5'
                      }
                    >
                      {o.status === 'scanned'
                        ? 'Read'
                        : o.status === 'failed'
                          ? 'Not read'
                          : 'Not reached'}
                    </span>
                  </div>
                  {o.message && (
                    <p className="mt-1.5 text-xs text-ink-600 leading-relaxed">
                      {o.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {scanned.length > 0 && (
            <p className="text-xs text-ink-500">
              Reload the page to see what the newly read exhibits say.
            </p>
          )}

          {result.stillUnread > 0 && (
            <p className="text-sm text-ink-800">
              {result.stillUnread} exhibit{result.stillUnread === 1 ? '' : 's'} still{' '}
              {result.stillUnread === 1 ? 'has' : 'have'} not been read. You can
              press the button again to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
