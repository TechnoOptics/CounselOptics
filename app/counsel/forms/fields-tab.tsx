'use client';

import type { TemplateField } from '@/lib/firm-templates';
import type { DetectedBlank } from '@/lib/template-blank-detection';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import { counterpartyFieldsGoUnfilled } from '@/lib/firm-template-placeholders';
import { T } from '@/components/i18n/LocaleProvider';
import { INPUT_CLS, blankIdentity } from './template-editor-model';

/**
 * WHO FILLS WHAT IN.
 *
 * Two halves of the same question, in this order on purpose. The blanks
 * panel is every place the DOCUMENT still asks for something that the
 * template has not declared; the field list is everything it has. Accepting
 * a suggestion at the top makes a row appear at the bottom, which is why
 * they sit in one section rather than in two.
 *
 * Nothing here is applied by being found. Detection produces a list, the
 * buttons apply one item at a time, and what a button writes is the BODY on
 * the Document section, so the author can see exactly what changed.
 */
export function FieldsTab({
  busy,
  hasBody,
  deliveryMode,
  fields,
  setFieldMeta,
  addable,
  unnamed,
  fillDetectedCount,
  fromDetection,
  onAccept,
  onDismiss,
}: {
  busy: boolean;
  /** Blanks are read from the body, so an empty body has nothing to report. */
  hasBody: boolean;
  deliveryMode: DeliveryMode;
  fields: TemplateField[];
  setFieldMeta: (
    next: (m: Record<string, TemplateField>) => Record<string, TemplateField>,
  ) => void;
  addable: DetectedBlank[];
  unnamed: DetectedBlank[];
  /** Fill blanks the body carries at all, dismissed ones included. */
  fillDetectedCount: number;
  fromDetection: Set<string>;
  onAccept: (b: DetectedBlank) => void;
  onDismiss: (b: DetectedBlank) => void;
}) {
  return (
    <div className="space-y-4">
      {hasBody && (
      <div className="rounded-lg border border-edge p-3.5">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">
          <T>Blanks found in this document</T>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          <T>
            Read from the body on the Document section. Nothing here is part of
            your template until you add it, and adding one writes a placeholder
            into the body where the rule is, so you can see exactly what changed.
          </T>
        </p>

        {addable.length > 0 && (
          <>
            <p className="mt-3 text-[12.5px] font-medium text-foreground">
              <T>Blanks somebody has to fill in</T>
            </p>
            {/* Said ONCE for the group, not on every row it applies to. The
                first version repeated the whole sentence per blank, and on a
                real NDA that is five identical lines of amber down the panel,
                which is how a warning stops being read. The rows carry a
                three-word marker and this explains what the marker means.
                mergeTemplateDocument appends its own signature and date lines
                per party, so a printed name or a date taken from inside an
                execution block puts the same fact on the instrument twice.
                Said, not decided: the author may genuinely want it. */}
            {addable.some((b) => b.inExecutionBlock) && (
              <p className="mt-1 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                <T>
                  Some of these sit in the signature block, marked below. The
                  signature and date lines are added for you when the document
                  goes out, so adding one of those would put the same thing on
                  the page twice.
                </T>
              </p>
            )}
            <ul className="mt-1.5 space-y-1.5">
              {addable.map((b) => (
                <li key={blankIdentity(b)} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code
                    className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                    data-no-translate
                  >
                    {'{{'}
                    {b.key}
                    {'}}'}
                  </code>
                  <span className="text-[12.5px] text-foreground" data-no-translate>
                    {b.label}
                  </span>
                  {b.inExecutionBlock && (
                    <span className="text-[12px] text-amber-700 dark:text-amber-300">
                      <T>in the signature block</T>
                    </span>
                  )}
                  {/* Pushed to one edge so the actions line up down the list.
                      Left inline they followed a label and an optional marker,
                      both variable width, and landed at a different place on
                      every row. */}
                  <span className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAccept(b)}
                      className="text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
                    >
                      <T>Add as a field</T>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(b)}
                      className="text-[12.5px] text-muted hover:text-danger-text"
                    >
                      <T>Not a field</T>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {unnamed.length > 0 && (
          <>
            <p className="mt-3 text-[12.5px] font-medium text-foreground">
              <T>Blanks with no name to give them</T>
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              <T>
                There is a blank here but nothing beside it that says what goes
                in it, so it is left alone rather than given an invented name.
                If somebody should fill one in, put a placeholder where the
                rule is and it becomes a field.
              </T>
            </p>
            <ul className="mt-1.5 space-y-1" data-no-translate>
              {unnamed.map((b) => (
                <li
                  key={blankIdentity(b)}
                  className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                >
                  {b.context}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* A body with nothing to find says so. An empty panel reads as a
            panel that failed rather than as a document with no blanks in it,
            and the two need to be told apart at a glance. */}
        {addable.length === 0 && unnamed.length === 0 && (
          <p className="mt-3 text-[12.5px] text-muted">
            {fillDetectedCount === 0 ? (
              <T>
                No blanks were found in this body. Type a placeholder in double
                braces wherever somebody should fill something in, and it
                becomes a field below.
              </T>
            ) : (
              <T>
                Every blank found here has been set aside. Edit the body to
                look again.
              </T>
            )}
          </p>
        )}
      </div>
      )}

      {fields.length > 0 ? (
        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            Fields (from the body)
          </p>
          <p className="mb-2 text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>
              A field the recipient fills in is left as a blank on the document
              your colleague sends. The recipient types it on the signing page
              and sees it in place before they sign. This only applies to
              templates that go out for signature.
            </T>
          </p>
          {/* Said here rather than left to be discovered by the person who
              receives the document. Nothing below is disabled: a firm may be
              drafting a template it means to switch over later, so the
              consequence is stated and the choice is left alone. */}
          {counterpartyFieldsGoUnfilled({ deliveryMode, fields }) && (
            <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">
              <T>
                This template goes out as a secure link, so nobody will fill in the
                fields marked for the recipient: there is no signing page for them to
                type on, and the document prints those fields as their labels. Set them
                to Your colleague fills in, or change How this goes out to For
                signature.
              </T>
            </p>
          )}
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f.key} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-cream-100 px-1.5 py-0.5 text-[11.5px] dark:bg-forest-800" data-no-translate>
                  {'{{'}{f.key}{'}}'}
                </code>
                {/* Which of these rows the author put there and which this page
                    suggested, while the difference can still change what they
                    do. It lasts as long as the editing session: once the
                    template is saved, the placeholder is in the author's own
                    body and there is nothing left to attribute. */}
                {fromDetection.has(f.key) && (
                  <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[11px] text-accent-text">
                    <T>Suggested</T>
                  </span>
                )}
                <input
                  className={`${INPUT_CLS} !w-56`}
                  value={f.label}
                  onChange={(e) => setFieldMeta((m) => ({ ...m, [f.key]: { ...f, label: e.target.value } }))}
                />
                <select
                  className={`${INPUT_CLS} !w-32`}
                  value={f.type}
                  onChange={(e) =>
                    setFieldMeta((m) => ({ ...m, [f.key]: { ...f, type: e.target.value as TemplateField['type'] } }))
                  }
                >
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                  <option value="textarea">Paragraph</option>
                </select>
                {/* Who fills this in. Only the legal team decides this, which
                    is why the control is here and nowhere else: the employee
                    filling a form must not be able to invent obligations for
                    the other side, and the counterparty must not be able to
                    invent fields for themselves. */}
                <select
                  className={`${INPUT_CLS} !w-44`}
                  value={f.party ?? 'employee'}
                  onChange={(e) =>
                    setFieldMeta((m) => ({
                      ...m,
                      [f.key]: {
                        ...f,
                        party:
                          e.target.value === 'counterparty' ? 'counterparty' : 'employee',
                      },
                    }))
                  }
                  aria-label={`Who fills in ${f.label}`}
                >
                  <option value="employee">Your colleague fills in</option>
                  <option value="counterparty">The recipient fills in</option>
                </select>
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600 dark:text-cream-100/70">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => setFieldMeta((m) => ({ ...m, [f.key]: { ...f, required: e.target.checked } }))}
                  />
                  Required
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // A section that would otherwise be empty says what would put
        // something in it. Without this the panel above sits alone and the
        // section reads as broken rather than as a template with no fields.
        <p className="text-[12.5px] text-muted">
          <T>
            This template has no fields yet. Add one from the blanks above, or
            type a placeholder in double braces into the body on the Document
            section.
          </T>
        </p>
      )}
    </div>
  );
}
