'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  runConflictCheckAction,
  clearConflictAction,
} from '@/lib/conflict-check';

// One hex per severity; StatusPill derives the fill and the border from
// it. An unrecognised severity reads as the mildest, not as the worst.
const SEVERITY_COLOR: Record<string, string> = {
  high: PILL_COLORS.flagged,
  medium: PILL_COLORS.waiting,
  low: PILL_COLORS.info,
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
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await runConflictCheckAction(firmId, intakeId);
      if (!res.ok) setError(res.error ?? t('Check failed.'));
      router.refresh();
    });
  }
  function clear() {
    setError(null);
    if (reason.trim().length < 10) {
      setError(t('Reason must be at least 10 characters.'));
      return;
    }
    startTransition(async () => {
      const res = await clearConflictAction(firmId, intakeId, reason);
      if (!res.ok) setError(res.error ?? t('Could not clear.'));
      router.refresh();
    });
  }

  const hits = results ?? [];
  const flagged = status === 'conflict_check_flagged';
  const passed = status === 'conflict_check_passed' || status === 'engaged';

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow"><T>Conflict check</T></p>
          <p className="text-[12px] text-muted mt-0.5 leading-relaxed max-w-2xl">
            <T>Searches the firm&rsquo;s existing client list and prior matter
            intakes for any name overlap with the parties on this intake.
            Hits are categorized by severity; clear with a written reason
            for the audit trail.</T>
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? <T>Running...</T> : status === 'in_progress' ? <T>Run check</T> : <T>Re-run</T>}
        </button>
      </div>

      {hits.length === 0 && passed && (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-300">
          <T>No conflicts found. You&rsquo;re clear to proceed with engagement.</T>
        </p>
      )}

      {hits.length > 0 && (
        <ul className="space-y-2">
          {hits.map((h, i) => (
            <li
              key={i}
              className="rounded-lg p-3 ring-1 ring-edge bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-foreground">
                  <strong>{h.matchedParty}</strong> <T>matches</T>{' '}
                  <strong>{h.matchedAgainst}</strong>
                </p>
                <StatusPill
                  size="sm"
                  color={SEVERITY_COLOR[h.severity] ?? SEVERITY_COLOR.low}
                >
                  {h.severity}
                </StatusPill>
              </div>
              <p className="text-[11.5px] text-muted mt-0.5">
                <T>Source:</T> {h.source.replace(/_/g, ' ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {flagged && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">
            <T>Conflict check flagged. Clear with a written reason or reject the
            intake.</T>
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="input"
            placeholder={t('Written waiver from the existing client; conflict is purely titular; common business name; etc. (min. 10 chars)')}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="btn-secondary"
            >
              {pending ? <T>Clearing...</T> : <T>Clear with this reason</T>}
            </button>
          </div>
        </div>
      )}

      {notes && (
        <div className="text-[12px] text-muted italic border-t border-edge pt-3">
          <T>Cleared with:</T> {notes}
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
