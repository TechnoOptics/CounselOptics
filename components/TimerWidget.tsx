'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startTimerAction, stopTimerAction } from '@/lib/time-tracking';
import type { TimeEntry } from '@/lib/time-tracking';

/**
 * Compact timer widget for the firm sidebar / case page. Live-counts
 * elapsed seconds since the open timer started. Click stop to log.
 *
 * Mounts at the top of /counsel/* routes when an active firm context
 * exists. The "What is this for" picker appears when the user clicks
 * Start without a context (eg. on the firm landing page); on a case
 * page, it auto-tags the case.
 */
export function TimerWidget({
  firmId,
  initial,
  caseId,
  caseTitle,
}: {
  firmId: string;
  initial: TimeEntry | null;
  caseId?: string;
  caseTitle?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<TimeEntry | null>(initial);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(
    open ? Math.floor((Date.now() - Date.parse(open.startedAt)) / 1000) : 0,
  );

  useEffect(() => {
    if (!open) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(
        Math.floor((Date.now() - Date.parse(open.startedAt)) / 1000),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  function start() {
    startTransition(async () => {
      const res = await startTimerAction(firmId, {
        caseId: caseId ?? null,
        description: caseTitle ? `Work on ${caseTitle}` : null,
        source: 'manual',
      });
      if (res.ok) {
        setOpen({
          id: res.entryId ?? '',
          firmId,
          userId: '',
          caseId: caseId ?? null,
          documentId: null,
          description: caseTitle ? `Work on ${caseTitle}` : null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationSeconds: null,
          billable: true,
          rateCents: null,
          source: 'manual',
        });
        router.refresh();
      }
    });
  }

  function stop() {
    startTransition(async () => {
      const res = await stopTimerAction(firmId);
      if (res.ok) {
        setOpen(null);
        router.refresh();
      }
    });
  }

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 text-[12.5px] text-ink-700 dark:text-cream-100/85 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
        {pending ? 'Starting...' : caseTitle ? 'Start timer on this case' : 'Start timer'}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-amber-200 dark:ring-amber-700/40 bg-amber-50 dark:bg-amber-950/30 text-[12.5px]">
      <span
        className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"
        aria-hidden
      />
      <span className="font-mono tabular-nums text-amber-800 dark:text-amber-200">
        {hh}:{mm}:{ss}
      </span>
      {open.description && (
        <span className="text-amber-800/80 dark:text-amber-200/80 truncate max-w-[12rem]">
          · {open.description}
        </span>
      )}
      <button
        type="button"
        onClick={stop}
        disabled={pending}
        className="ml-2 px-2 py-0.5 rounded ring-1 ring-amber-300 dark:ring-amber-700/40 bg-white dark:bg-amber-900/40 text-[11px] font-semibold text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-800/40"
      >
        {pending ? 'Stopping...' : 'Stop'}
      </button>
    </div>
  );
}
