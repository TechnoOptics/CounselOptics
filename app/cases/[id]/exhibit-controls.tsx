'use client';

import { useState, useTransition } from 'react';
import { setExhibitWithdrawnAction, updateExhibitDetailsAction } from '@/lib/actions';
import { EXHIBIT_CATEGORIES, type Exhibit } from '@/lib/types';
import { withdrawConfirmLines } from '@/lib/exhibit-withdrawal';

/**
 * The owner's controls on one exhibit row: correct its details, or withdraw it
 * from the packet.
 *
 * Deliberately thin. Every decision worth testing lives in
 * lib/exhibit-withdrawal.ts, because vitest runs here in a node environment
 * with no DOM and none may be added, so a rule written into this file could
 * not be exercised by a test at all.
 *
 * The file input and the label are absent from this form on purpose, and not
 * merely disabled. The bytes are the evidence, and the label is how a court
 * refers to this document.
 *
 * Both actions RETURN their refusal. A thrown message is replaced by React
 * with a digest in a production build, which is what the person would read
 * instead of the sentence. The catch below is for a dropped connection only,
 * and deliberately does not read a message off the rejection.
 */
export function ExhibitControls({ exhibit }: { exhibit: Exhibit }) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm-withdraw'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const withdrawn = Boolean(exhibit.withdrawnAt);
  const category = exhibit.category ?? '';
  const categoryOptions = (EXHIBIT_CATEGORIES as readonly string[]).includes(category)
    ? EXHIBIT_CATEGORIES
    : // Keep a value the exhibit already carries on the list, so a legacy
      // category cannot silently become something else when an unrelated
      // description is fixed.
      [category, ...EXHIBIT_CATEGORIES];

  function saveDetails(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const res = await updateExhibitDetailsAction(exhibit.id, formData);
        if (!res?.ok) {
          setError(res?.error || 'That change could not be saved.');
          return;
        }
        setSaved(true);
        setMode('idle');
      } catch {
        setError(
          'That change did not reach us. Check your connection and try again.',
        );
      }
    });
  }

  function setWithdrawn(next: boolean) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const res = await setExhibitWithdrawnAction(exhibit.id, next);
        if (!res?.ok) {
          setError(res?.error || 'Nothing was changed.');
          return;
        }
        setMode('idle');
      } catch {
        setError(
          'That change did not reach us. Check your connection and try again.',
        );
      }
    });
  }

  return (
    <div className="mt-3">
      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setMode('edit');
            }}
            className="rounded-md border border-forest-200 bg-white px-2.5 py-1 text-forest-900 hover:bg-cream-50 hover:border-gold-500"
          >
            Edit details
          </button>
          {withdrawn ? (
            <button
              type="button"
              onClick={() => setWithdrawn(false)}
              disabled={pending}
              className="rounded-md border border-forest-200 bg-white px-2.5 py-1 text-forest-900 hover:bg-cream-50 hover:border-gold-500"
            >
              {pending ? 'Working…' : 'Put back in the packet'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode('confirm-withdraw')}
              className="rounded-md border border-ink-200 bg-white px-2.5 py-1 text-ink-700 hover:bg-cream-50"
            >
              Withdraw from packet
            </button>
          )}
          {saved && <span className="text-ink-500">Saved.</span>}
        </div>
      )}

      {mode === 'confirm-withdraw' && (
        <div className="rounded-lg border border-ink-200 bg-cream-50 p-4">
          <p className="text-sm font-medium text-ink-950">
            Withdraw {exhibit.label} from the packet?
          </p>
          {withdrawConfirmLines(exhibit.label).map((line) => (
            <p key={line} className="mt-2 text-sm leading-relaxed text-ink-700">
              {line}
            </p>
          ))}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setWithdrawn(true)}
              disabled={pending}
              className="btn-secondary"
            >
              {pending ? 'Working…' : 'Withdraw it'}
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              disabled={pending}
              className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-cream-50"
            >
              Keep it in
            </button>
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <form action={saveDetails} className="rounded-lg border border-ink-200 p-4 space-y-3">
          <p className="text-sm font-medium text-ink-950">
            Details for {exhibit.label}
          </p>
          <p className="text-xs leading-relaxed text-ink-500">
            The file itself and the label {exhibit.label} do not change. The
            label is how this document is referred to elsewhere, so it stays as
            it is.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor={`category-${exhibit.id}`}>
                Category
              </label>
              <select
                id={`category-${exhibit.id}`}
                name="category"
                className="input"
                defaultValue={category}
              >
                <option value="">Select…</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`incidentDate-${exhibit.id}`}>
                Date of incident
              </label>
              <input
                id={`incidentDate-${exhibit.id}`}
                name="incidentDate"
                type="date"
                className="input"
                // A date-only value, stored and read back as the same calendar
                // day. The chronology on the packet is ordered by this field.
                defaultValue={(exhibit.incidentDate ?? '').slice(0, 10)}
              />
              <p className="mt-1 text-xs text-ink-500">
                The day the event happened, not the day you uploaded the file.
                This is what orders your timeline.
              </p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor={`source-${exhibit.id}`}>
              Source
            </label>
            <input
              id={`source-${exhibit.id}`}
              name="source"
              className="input"
              placeholder="Where this evidence came from (device, person, etc.)"
              defaultValue={exhibit.source ?? ''}
            />
          </div>

          <div>
            <label className="label" htmlFor={`description-${exhibit.id}`}>
              Description
            </label>
            <input
              id={`description-${exhibit.id}`}
              name="description"
              className="input"
              placeholder="What this exhibit shows or why it matters"
              defaultValue={exhibit.description ?? ''}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('idle');
              }}
              disabled={pending}
              className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-cream-50"
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
