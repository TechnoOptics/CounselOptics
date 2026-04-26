'use client';

import { useState, useTransition } from 'react';
import {
  setFeedbackStatusAction,
  updateFeedbackNotesAction,
} from '@/lib/actions';
import type { FeedbackRow as FB, FeedbackStatus } from '@/lib/storage';

const STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'wontfix', label: "Won't fix" },
];

const CATEGORY_TONE: Record<string, string> = {
  bug: 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-700/40',
  suggestion:
    'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-700/40',
  praise:
    'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/40',
  other:
    'bg-ink-100 text-ink-700 border border-ink-200 dark:bg-forest-800 dark:text-cream-100/80',
};

export function FeedbackRow({ item }: { item: FB }) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [notes, setNotes] = useState(item.adminNotes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function pickStatus(next: FeedbackStatus) {
    if (pending || next === status) return;
    const prev = status;
    setStatus(next);
    setError(null);
    start(async () => {
      const res = await setFeedbackStatusAction(item.id, next);
      if (!res.ok) {
        setStatus(prev);
        setError(res.error ?? 'Failed.');
      } else {
        setSavedAt(Date.now());
      }
    });
  }

  function saveNotes() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await updateFeedbackNotesAction(item.id, notes);
      if (!res.ok) setError(res.error ?? 'Failed.');
      else setSavedAt(Date.now());
    });
  }

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={`badge capitalize ${CATEGORY_TONE[item.category] ?? CATEGORY_TONE.other}`}>
              {item.category}
            </span>
            <span className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums">
              {new Date(item.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
          <h3 className="font-semibold text-ink-950 dark:text-cream-100">{item.subject}</h3>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            From{' '}
            <span className="font-medium text-ink-700 dark:text-cream-100/85">
              {item.userDisplayName || item.userEmail || 'unknown user'}
            </span>
            {item.userEmail && (
              <>
                {' · '}
                <a className="underline" href={`mailto:${item.userEmail}`}>
                  {item.userEmail}
                </a>
              </>
            )}
            {item.urlAtSubmit && (
              <>
                {' · '}
                <span className="font-mono">{item.urlAtSubmit.replace(/^https?:\/\//, '')}</span>
              </>
            )}
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => pickStatus(e.target.value as FeedbackStatus)}
          disabled={pending}
          className="input max-w-[160px] text-sm"
          aria-label="Feedback status"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-3 whitespace-pre-wrap leading-relaxed">
        {item.body}
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-[11px] uppercase tracking-[0.18em] font-semibold text-gold-700 dark:text-gold-300">
          Admin notes
        </summary>
        <div className="mt-2 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Internal notes about triage / repro / linked issue / etc."
            className="input resize-y text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
              {item.userAgent ? <code className="font-mono break-all">{item.userAgent}</code> : null}
            </span>
            <button
              type="button"
              onClick={saveNotes}
              disabled={pending}
              className="btn-secondary text-sm py-1.5 px-3"
            >
              {pending ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>
      </details>

      {error && (
        <p className="text-[11.5px] text-rose-700 dark:text-rose-300 mt-2">{error}</p>
      )}
      {savedAt && !error && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-2">Saved.</p>
      )}
    </li>
  );
}
