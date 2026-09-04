'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { setIntakeLegalFieldsAction } from '@/lib/firm-actions';
import type { IntakeLegalFields } from '@/lib/intake-legal-fields';

/**
 * The legal team's working fields on a request, in the rail with the rest of
 * what the firm does about it.
 *
 * Everything here is a real column the employee's page never selects (see
 * lib/intake-legal-fields.ts). The one exception is Close notes, which is
 * the reason the decline dialog wrote and the employee is meant to read; it
 * is shown here so the block is complete and is NOT a second field.
 *
 * SAVING. Selects and checkboxes save on change, dates on blur, the same as
 * the management block above the record: an operated surface should not make
 * somebody find a Save button for a field they have already set. Every
 * refusal is the server's: the action does its own authorization and says in
 * one sentence when a column is not there yet.
 */

/** One labelled field, at the density this rail is scanned at. */
function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground transition-colors focus:border-edge-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40 disabled:opacity-50';

export type RelatedMatterOption = { id: string; title: string };

export function AdministrativeTools({
  firmId,
  intakeId,
  fields,
  matters,
  closeNotes,
}: {
  firmId: string;
  intakeId: string;
  fields: IntakeLegalFields;
  /** The firm's own matters, for the related-matter select. */
  matters: RelatedMatterOption[];
  /** The decision reason, when the request has been decided. */
  closeNotes: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [completedOn, setCompletedOn] = useState(fields.completedOn ?? '');

  function save(
    input: Parameters<typeof setIntakeLegalFieldsAction>[2],
    note: string,
  ) {
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await setIntakeLegalFieldsAction(firmId, intakeId, input);
      if (res.ok) {
        setSaved(note);
        router.refresh();
      } else {
        setError(res.error ?? t('That could not be saved.'));
      }
    });
  }

  const related = fields.relatedCaseId ?? '';
  const relatedKnown = related !== '' && matters.some((m) => m.id === related);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          <T>Administrative tools</T>
        </h2>
        <span className="text-[11.5px] text-muted">
          {pending ? (
            <T>Saving</T>
          ) : error ? (
            <span className="text-danger-text" data-no-translate>
              {error}
            </span>
          ) : saved ? (
            <span data-no-translate>{saved}</span>
          ) : null}
        </span>
      </div>

      <div className="space-y-3.5 p-4">
        <Field
          label={<T>Related matter</T>}
          hint={
            relatedKnown ? (
              <Link
                href={`/counsel/cases/${related}`}
                className="underline hover:text-foreground"
              >
                <T>Open the matter</T>
              </Link>
            ) : (
              <T>A matter this request touches, if any</T>
            )
          }
        >
          <select
            className={CONTROL}
            value={relatedKnown ? related : ''}
            disabled={pending}
            onChange={(e) =>
              save({ relatedCaseId: e.target.value }, t('Related matter saved.'))
            }
          >
            <option value="">{t('None')}</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label={<T>Date completed</T>}>
          <input
            type="date"
            className={CONTROL}
            value={completedOn}
            disabled={pending}
            onChange={(e) => setCompletedOn(e.target.value)}
            onBlur={() =>
              completedOn !== (fields.completedOn ?? '') &&
              save({ completedOn }, t('Date completed saved.'))
            }
          />
        </Field>

        <label className="flex items-start gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            className="mt-[3px] h-3.5 w-3.5 flex-none"
            checked={fields.multipleDocuments}
            disabled={pending}
            onChange={(e) =>
              save(
                { multipleDocuments: e.target.checked },
                t('Saved.'),
              )
            }
          />
          <span>
            <T>More than one document</T>
          </span>
        </label>

        <div className="border-t border-edge pt-3.5">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            <T>Close notes</T>
          </span>
          {closeNotes ? (
            <p
              data-no-translate
              className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground"
            >
              {closeNotes}
            </p>
          ) : (
            <p className="text-[12px] text-muted">
              <T>Written when the request is declined or closed out. The person who filed it reads it too.</T>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
