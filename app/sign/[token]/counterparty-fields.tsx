'use client';

import { useState } from 'react';
import type { TemplateField } from '@/lib/firm-templates';
import {
  missingCounterpartyFields,
  sanitizeCounterpartyValues,
  type CounterpartyValues,
} from '@/lib/counterparty-fields';
import { submitCounterpartyFieldsAction } from './counterparty-actions';

/**
 * The parts of the document that are the signer's to supply.
 *
 * WHY THIS STEP COMES BEFORE THE DISCLOSURE. The disclosure asks the signer
 * to affirm that they have reviewed the document, and a document with their
 * own entity name and address still missing from it is not the document they
 * are being asked to be bound by. So the details are collected first, drawn
 * into the page above, and only then is the ceremony offered. The signer
 * reviews what they will actually be signing.
 *
 * WHAT THIS COMPONENT IS NOT. It is not the gate. Everything typed here is
 * re-checked on the server by resolveCounterpartySubmission, over plain
 * values, against the fields the legal team declared as the counterparty's
 * and the blanks the renderer actually drew. The checks below exist so the
 * signer is told what is missing without a round trip, not so the server can
 * skip asking.
 *
 * Dates are picked, never auto-filled: a date the signer did not choose is a
 * fact about their agreement that they did not assert. The helper line says
 * how it will be printed, so nobody has to guess whether 06/08 is June or
 * August on the copy that comes back.
 */
export function CounterpartyFields({
  token,
  fields,
  initialValues,
  onSubmitted,
}: {
  token: string;
  fields: TemplateField[];
  initialValues: CounterpartyValues;
  /** Called with the values the SERVER accepted, which are the ones drawn
   *  onto the page. Never with what was typed, because the two can differ:
   *  the server trims, folds whitespace and bounds length. */
  onSubmitted: (values: CounterpartyValues) => void;
}) {
  const [values, setValues] = useState<CounterpartyValues>(initialValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const local = sanitizeCounterpartyValues(fields, values);
    const stillMissing = missingCounterpartyFields(fields, local);
    if (stillMissing.length > 0) {
      setMissing(stillMissing);
      setError('Please fill in the details marked as required.');
      return;
    }
    setMissing([]);
    setBusy(true);
    try {
      const result = await submitCounterpartyFieldsAction(token, local);
      if (!result.ok) {
        setMissing(result.missing ?? []);
        setError(result.error);
        return;
      }
      onSubmitted(result.values);
    } catch {
      setError(
        'Your details could not be saved just now. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <p className="eyebrow mb-2">Your details</p>
      <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        A few parts of this document are yours to complete.
      </h2>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
        These go into the document. You will see them in place above before you
        sign, and you can change them until you do.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {fields.map((field) => {
          const isMissing = missing.includes(field.key);
          return (
            <label key={field.key} className="block">
              <span className="block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                <span data-no-translate>{field.label}</span>
                {field.required ? (
                  <span className="text-ink-500 dark:text-cream-100/55 font-normal">
                    {' '}
                    (required)
                  </span>
                ) : (
                  <span className="text-ink-500 dark:text-cream-100/55 font-normal">
                    {' '}
                    (optional)
                  </span>
                )}
              </span>
              <input
                type={field.type === 'date' ? 'date' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) => set(field.key, e.currentTarget.value)}
                maxLength={200}
                required={field.required}
                aria-invalid={isMissing || undefined}
                className={`input mt-1.5 w-full ${
                  isMissing ? 'ring-1 ring-red-500/70' : ''
                }`}
                data-no-translate
              />
              {field.type === 'date' && (
                <span className="block text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
                  This is printed on the document in full, for example August 6,
                  2026.
                </span>
              )}
            </label>
          );
        })}

        {error && (
          <p className="text-[13px] text-red-700 dark:text-red-300 leading-relaxed">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving your details' : 'Put these in the document'}
        </button>
      </form>
    </section>
  );
}

/**
 * What the signer sees once their details are in the document: a short
 * summary and a way back to change them.
 *
 * Separate from the form on purpose. Leaving the form open beside a document
 * that already shows the values invites the signer to edit a field, not press
 * the button, and sign an instrument that says something else.
 */
export function CounterpartyFieldsSummary({
  fields,
  values,
  onEdit,
  locked,
}: {
  fields: TemplateField[];
  values: CounterpartyValues;
  onEdit: () => void;
  /** True once the signer is at the pad. The values are still changeable
   *  until the signature lands, but changing them under an open pad is how
   *  someone signs a document they last read a version ago. */
  locked: boolean;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <p className="eyebrow mb-2">Your details</p>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        These are now in the document above. Read it through with them in place
        before you sign.
      </p>
      <dl className="mt-4 space-y-2">
        {fields.map((field) => (
          <div key={field.key} className="flex flex-wrap gap-x-2 text-[13px]">
            <dt className="text-ink-600 dark:text-cream-100/70" data-no-translate>
              {field.label}
            </dt>
            <dd
              className="font-medium text-forest-900 dark:text-cream-100"
              data-no-translate
            >
              {values[field.key] || 'Not given'}
            </dd>
          </div>
        ))}
      </dl>
      {!locked && (
        <button type="button" onClick={onEdit} className="btn-ghost text-sm mt-4">
          Change these details
        </button>
      )}
    </section>
  );
}
