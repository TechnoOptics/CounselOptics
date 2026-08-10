'use client';

import { useState, useTransition } from 'react';
import { updateWitnessStatementAction } from '@/lib/actions';
import { formatDateTimeShort, formatNumber } from '@/lib/format';

/**
 * Witness self-edit panel. Renders inside the case detail when the
 * current viewer is the witness named on a `case_collaborators` row.
 * Lets them write their account of what happened in their own words.
 *
 * The textarea is friendly to long-form writing (8-12 visible lines,
 * autosizes), shows a saved-at timestamp, and disables submit while
 * the action is mid-flight. Server enforces the "only edit your own
 * statement" rule.
 */
export function WitnessStatementEditor({
  caseId,
  collaboratorId,
  initialStatement,
  initialUpdatedAt,
}: {
  caseId: string;
  collaboratorId: string;
  initialStatement: string;
  initialUpdatedAt: string | null;
}) {
  const [text, setText] = useState(initialStatement);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = text.trim() !== initialStatement.trim();

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set('statement', text);
    startTransition(async () => {
      const r = await updateWitnessStatementAction(caseId, collaboratorId, fd);
      if (r.ok) {
        setUpdatedAt(new Date().toISOString());
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } else {
        setError(r.error ?? 'Could not save your statement.');
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div>
        <p className="eyebrow mb-1">Your statement</p>
        <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
          What happened, in your own words
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          You were invited as a witness on this case. Write what you saw, when, where, and
          who else was involved. Stick to facts you observed firsthand. The owner of the
          case can see this, and so can their attorney.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder="On the afternoon of [date], I was at [location] when…"
        className="input w-full font-sans leading-relaxed"
        disabled={pending}
        maxLength={50_000}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">
          {savedFlash
            ? 'Saved.'
            : updatedAt
              ? `Last saved ${formatDateTimeShort(updatedAt)}`
              : 'Not saved yet.'}
          {' · '}
          <span>{formatNumber(text.length)} / 50,000</span>
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="btn-primary disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save statement'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}
    </section>
  );
}
