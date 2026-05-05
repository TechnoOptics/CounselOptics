'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  runConflictCheckAction,
  clearConflictAction,
} from '@/lib/conflict-check';

const SEVERITY_TONE: Record<string, string> = {
  high: 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  medium: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  low: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
};

export function ConflictCheckPanel({
  firmId,
  intakeId,
  status,
  results,
  notes,
}: {
  firmId: string;
  intakeId: string;
  status: string;
  results:
    | Array<{
        source: string;
        matchedParty: string;
        matchedAgainst: string;
        severity: string;
      }>
    | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await runConflictCheckAction(firmId, intakeId);
      if (!res.ok) setError(res.error ?? 'Check failed.');
      router.refresh();
    });
  }
  function clear() {
    setError(null);
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters.');
      return;
    }
    startTransition(async () => {
      const res = await clearConflictAction(firmId, intakeId, reason);
      if (!res.ok) setError(res.error ?? 'Could not clear.');
      router.refresh();
    });
  }

  const hits = results ?? [];
  const flagged = status === 'conflict_check_flagged';
  const passed = status === 'conflict_check_passed' || status === 'engaged';

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Conflict check</p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5 leading-relaxed max-w-2xl">
            Searches the firm&rsquo;s existing client list and prior matter
            intakes for any name overlap with the parties on this intake.
            Hits are categorized by severity; clear with a written reason
            for the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? 'Running...' : status === 'in_progress' ? 'Run check' : 'Re-run'}
        </button>
      </div>

      {hits.length === 0 && passed && (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-300">
          No conflicts found. You&rsquo;re clear to proceed with engagement.
        </p>
      )}

      {hits.length > 0 && (
        <ul className="space-y-2">
          {hits.map((h, i) => (
            <li
              key={i}
              className="rounded-lg p-3 ring-1 ring-ink-200 dark:ring-forest-700/40 bg-ink-50/40 dark:bg-forest-900/30"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-forest-900 dark:text-cream-100">
                  <strong>{h.matchedParty}</strong> matches{' '}
                  <strong>{h.matchedAgainst}</strong>
                </p>
                <span
                  className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${
                    SEVERITY_TONE[h.severity] ?? SEVERITY_TONE.low
                  }`}
                >
                  {h.severity}
                </span>
              </div>
              <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                Source: {h.source.replace(/_/g, ' ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {flagged && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">
            Conflict check flagged. Clear with a written reason or reject the
            intake.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="input"
            placeholder="Written waiver from the existing client; conflict is purely titular; common business name; etc. (min. 10 chars)"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="btn-primary"
            >
              {pending ? 'Clearing...' : 'Clear with this reason'}
            </button>
          </div>
        </div>
      )}

      {notes && (
        <div className="text-[12px] text-ink-500 dark:text-cream-100/55 italic border-t border-ink-100 dark:border-forest-800/40 pt-3">
          Cleared with: {notes}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}
