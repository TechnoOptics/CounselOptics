'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startTimerAction, stopTimerAction } from '@/lib/time-tracking';
import type { TimeEntry } from '@/lib/time-tracking';

/**
 * Compact timer widget for the case page and the time page. Live-counts
 * elapsed seconds since the open timer started. Click stop to log.
 *
 * WHICH MATTER, AND WHY IT IS NOT OPTIONAL. An earlier version of this comment
 * described a "What is this for" picker that appeared when Start was pressed
 * without a case. There was no picker: the widget sent `caseId ?? null` and the
 * page mounted it with no case at all, so every timer started from
 * /counsel/time produced an entry that no invoice could ever include. The
 * picker below is that missing control, and startTimerAction refuses a timer
 * with no matter whether or not this component asks for one.
 *
 * On a case page `caseId` is passed and the picker is not drawn. On a page with
 * no case, the caller passes the firm's matters. If there are none, the widget
 * says so and points at Matters rather than offering a Start that would be
 * refused.
 */
export function TimerWidget({
  firmId,
  initial,
  caseId,
  caseTitle,
  cases,
}: {
  firmId: string;
  initial: TimeEntry | null;
  caseId?: string;
  caseTitle?: string;
  /** The firm's matters, for the picker. Omit on a page that has a caseId. */
  cases?: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<TimeEntry | null>(initial);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    const onCase = caseId ?? picked;
    if (!onCase) return;
    const title =
      caseTitle ?? cases?.find((c) => c.id === onCase)?.title ?? null;
    setError(null);
    startTransition(async () => {
      const res = await startTimerAction(firmId, {
        caseId: onCase,
        description: title ? `Work on ${title}` : null,
        source: 'manual',
      });
      if (res.ok) {
        setOpen({
          id: res.entryId ?? '',
          firmId,
          userId: '',
          caseId: onCase,
          documentId: null,
          description: title ? `Work on ${title}` : null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationSeconds: null,
          billable: true,
          rateCents: null,
          source: 'manual',
        });
        router.refresh();
      } else {
        setError(res.error ?? 'The timer could not be started.');
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

  const startButton = (
    <button
      type="button"
      onClick={start}
      disabled={pending || (!caseId && !picked)}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 text-[12.5px] text-ink-700 dark:text-cream-100/85 hover:text-forest-900 dark:hover:text-cream-100 transition-colors disabled:opacity-60"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
      {pending ? 'Starting...' : caseTitle ? 'Start timer on this case' : 'Start timer'}
    </button>
  );

  if (!open) {
    if (caseId) return startButton;

    // No matters to pick from: say so rather than offer a Start that the
    // server would refuse.
    if (!cases || cases.length === 0) {
      return (
        <p className="text-[12.5px] text-muted">
          Open a matter first. Time is logged against one so it can be invoiced.
        </p>
      );
    }

    return (
      <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="timer-matter">
            Matter this time is for
          </label>
          <select
            id="timer-matter"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            disabled={pending}
            className="input !py-1.5 !text-[12.5px] max-w-[16rem]"
          >
            <option value="">Which matter?</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {startButton}
        </div>
        {error && (
          <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>
        )}
      </div>
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
