'use client';

import { useState, useTransition } from 'react';
import {
  clearCaseCompositionAction,
  updateCaseCompositionAction,
} from '@/lib/actions';
import { MAX_COMPOSITION_LENGTH, type CompositionVersion } from '@/lib/composition';
import { formatDateTimeShort, formatNumber } from '@/lib/format';

/**
 * The person's own account of what happened, on the case page, editable.
 *
 * This is `cases.description`, the text they wrote in the wizard when they
 * opened the case. Until now it could only be read back.
 *
 * Two things here are deliberate rather than decorative. Clearing the text
 * asks for a second click, because it is the one action in this panel that
 * removes something. And the earlier versions are shown, with the date each
 * was replaced, because a rewrite that quietly discarded the first account
 * would discard the version written closest to the events.
 */
export function CompositionPanel({
  caseId,
  description,
  history,
  isOwner,
}: {
  caseId: string;
  description: string;
  history: CompositionVersion[];
  isOwner: boolean;
}) {
  const [text, setText] = useState(description);
  const [editing, setEditing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = text.trim() !== description.trim();
  const older = [...history].sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateCaseCompositionAction(caseId, text);
      if (r.ok) {
        setEditing(false);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } else {
        setError(r.error ?? 'That change could not be saved.');
      }
    });
  }

  function clearText() {
    setError(null);
    startTransition(async () => {
      const r = await clearCaseCompositionAction(caseId);
      if (r.ok) {
        setText('');
        setEditing(false);
        setConfirmingClear(false);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } else {
        setError(r.error ?? 'That change could not be saved.');
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      {!editing && (
        <>
          {description ? (
            <p
              className="text-[15px] leading-relaxed text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap"
              data-no-translate
            >
              {description}
            </p>
          ) : (
            <p className="text-sm text-ink-500 dark:text-cream-100/55 leading-relaxed">
              {isOwner
                ? 'There is no account on this case yet. You can write one whenever you are ready, and change it later.'
                : 'The case owner has not written an account on this case.'}
            </p>
          )}
          {isOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setText(description);
                  setEditing(true);
                  setError(null);
                }}
                className="btn-secondary"
              >
                {description ? 'Edit your account' : 'Write your account'}
              </button>
              {savedFlash && (
                <span className="text-xs text-ink-500 dark:text-cream-100/60">Saved.</span>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="What happened, in your own words. Dates, places, and who was involved help most."
            className="input w-full font-sans leading-relaxed"
            disabled={pending}
            maxLength={MAX_COMPOSITION_LENGTH}
            data-no-translate
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">
              {formatNumber(text.length)} / {formatNumber(MAX_COMPOSITION_LENGTH)}
              {history.length > 0 || description
                ? ' · the version you are replacing is kept'
                : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setText(description);
                  setEditing(false);
                  setConfirmingClear(false);
                  setError(null);
                }}
                disabled={pending}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !dirty}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {description && (
            <div className="rounded-lg border border-ink-200 dark:border-forest-700/40 p-4">
              <p className="text-sm font-medium text-ink-800 dark:text-cream-100">
                Clear this account
              </p>
              <p className="text-xs text-ink-600 dark:text-cream-100/65 mt-1 leading-relaxed">
                This empties the text only. Your case stays open, and every exhibit,
                collaborator, and review stays exactly where it is. The wording you clear is
                kept below, with the date, so you can read it again.
              </p>
              {confirmingClear ? (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={clearText}
                    disabled={pending}
                    className="btn-secondary text-rose-700 dark:text-rose-200 disabled:opacity-50"
                  >
                    {pending ? 'Clearing…' : 'Yes, clear the text'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    disabled={pending}
                    className="btn-secondary disabled:opacity-50"
                  >
                    Keep it
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  disabled={pending}
                  className="btn-secondary mt-3 disabled:opacity-50"
                >
                  Clear the text
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
        >
          {error}
        </p>
      )}

      {older.length > 0 && (
        <div className="border-t border-ink-200 dark:border-forest-700/40 pt-4">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-sm font-medium text-forest-900 dark:text-cream-100"
          >
            {showHistory ? 'Hide' : 'Show'} earlier versions ({older.length})
          </button>
          <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1 leading-relaxed">
            Every version you replace is kept here with the date it was replaced. Nothing you
            have written is deleted.
          </p>
          {showHistory && (
            <ul className="space-y-3 mt-3">
              {older.map((v) => (
                <li
                  key={`${v.replacedAt}-${v.text.length}`}
                  className="rounded-lg border border-ink-200 dark:border-forest-700/40 p-3"
                >
                  <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/50">
                    Replaced {formatDateTimeShort(v.replacedAt)}
                  </p>
                  <p
                    className="text-sm leading-relaxed text-ink-700 dark:text-cream-100/75 whitespace-pre-wrap mt-1.5"
                    data-no-translate
                  >
                    {v.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
