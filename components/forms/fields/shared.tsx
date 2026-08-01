/**
 * The pieces every field component shares: the props contract, the label,
 * and the plain text-style input the majority of question types reduce to.
 *
 * Each question type gets its own component (see ./index.ts) so that a type
 * with a real difference, yesno and multiselect are the two that need a
 * fieldset rather than a labelled input, is not a special case buried inside
 * one giant switch. The types that differ only in the browser's input mode
 * stay thin wrappers over `TextLikeInput` rather than repeating markup.
 *
 * Accessibility contract, held by every field in this directory:
 *   - the visible label is bound to the control, by `htmlFor` for a single
 *     control and by `<legend>` inside a `<fieldset>` for a group;
 *   - a required question sets `aria-required`;
 *   - help text and the error message are referenced from the control by
 *     `aria-describedby`, so a screen reader reads why the field was
 *     rejected rather than announcing an unexplained invalid state;
 *   - a rejected control sets `aria-invalid`.
 *
 * Colours come from the shared `.input` and `.label` classes in globals.css,
 * which already carry both the light consumer palette and the dark counsel
 * one. Nothing here hard-codes a surface.
 */

import type { ReactNode } from 'react';
import type { Question } from '@/lib/form-schema';

/**
 * `:root` in globals.css declares `color-scheme: light dark`, so the parts of
 * a control the browser paints itself, a radio's dot, a checkbox's tick, a
 * date input's calendar glyph, follow the *operating system's* theme rather
 * than the page's. On the light consumer surface in a dark-mode browser that
 * renders black radios and an invisible white calendar icon on a white field.
 *
 * Pinning the scheme to the page instead fixes both surfaces at once: the
 * counsel shell always carries `dark`, the consumer surface carries it only
 * when the reader has chosen dark, so this tracks whichever one is mounted.
 */
export const SURFACE_SCHEME = '[color-scheme:light] dark:[color-scheme:dark]';

export type FieldProps = {
  question: Question;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  /** DOM id for the control, so the label's `htmlFor` has something to bind to. */
  inputId: string;
  /** Space-separated ids of the help and error text, or undefined when neither exists. */
  describedBy?: string;
  invalid: boolean;
};

/** The answer as a single string. Guards the draft-preview path, where a
 *  question's type may have changed under an answer of the other shape. */
export function asText(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : value === '' ? [] : [value];
}

/**
 * `silent` hides the marker from assistive tech, for the controls where
 * `aria-required` already carries the same fact and repeating it would have
 * the label read as "Counterparty name Required required".
 *
 * It is NOT silent on a plain `group`: `aria-required` is not supported on
 * that role, so on a multiselect the word in the legend is the only thing
 * telling a screen reader user the question must be answered.
 */
function RequiredMark({ required, silent }: { required: boolean; silent: boolean }) {
  if (!required) return null;
  return (
    <span
      aria-hidden={silent || undefined}
      className="ml-1.5 text-[11px] font-normal text-ink-500 dark:text-cream-100/55"
    >
      Required
    </span>
  );
}

export function FieldLabel({
  htmlFor,
  question,
}: {
  htmlFor: string;
  question: Question;
}) {
  return (
    <label htmlFor={htmlFor} className="label">
      {question.label}
      <RequiredMark required={question.required} silent />
    </label>
  );
}

/**
 * The same label for a group of controls. A `<legend>` cannot use `htmlFor`;
 * being the first child of the `<fieldset>` is what binds it to the group.
 */
export function GroupLabel({
  question,
  silentRequired,
}: {
  question: Question;
  silentRequired: boolean;
}) {
  return (
    <legend className="label">
      {question.label}
      <RequiredMark required={question.required} silent={silentRequired} />
    </legend>
  );
}

/**
 * Wrapper for a group of radios or checkboxes. `role` is `radiogroup` for a
 * set of radios, where exactly one answer is possible, and the default
 * `group` for checkboxes, where several are. A screen reader announces the
 * two differently, which is how someone who cannot see the controls knows
 * whether picking a second option replaces the first.
 *
 * `aria-required` and `aria-invalid` are only set on `radiogroup`. ARIA does
 * not support either on a plain `group`, so setting them there would look
 * correct in the source and announce nothing. The legend carries the required
 * word instead, and `aria-describedby` (which is global, so it does apply)
 * carries the error message either way.
 */
export function FieldGroup({
  question,
  describedBy,
  invalid,
  role = 'group',
  children,
}: {
  question: Question;
  describedBy?: string;
  invalid: boolean;
  role?: 'group' | 'radiogroup';
  children: ReactNode;
}) {
  const statesApply = role === 'radiogroup';
  return (
    <fieldset
      role={role}
      aria-required={(statesApply && question.required) || undefined}
      aria-invalid={(statesApply && invalid) || undefined}
      aria-describedby={describedBy}
      className="min-w-0"
    >
      <GroupLabel question={question} silentRequired={statesApply} />
      <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </fieldset>
  );
}

/**
 * One option in a radio or checkbox group.
 *
 * The label carries vertical padding so the tappable area around each option
 * clears the 24px minimum, which a bare 16px box does not. The label is bound
 * by `htmlFor` rather than wrapping the input, so the group's markup stays
 * one control plus one label and a screen reader reads the option once.
 */
export function OptionControl({
  id,
  name,
  type,
  label,
  checked,
  onChange,
}: {
  id: string;
  name: string;
  type: 'radio' | 'checkbox';
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        name={name}
        type={type}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`h-4 w-4 shrink-0 accent-forest-700 dark:accent-gold-500 ${SURFACE_SCHEME}`}
      />
      <label
        htmlFor={id}
        className="cursor-pointer py-1.5 text-sm text-forest-900 dark:text-cream-100"
      >
        {label}
      </label>
    </div>
  );
}

/**
 * The labelled single-line input that short_text, email, phone, date, time
 * and datetime all reduce to. `type` and the numeric bounds are the only
 * things those question types disagree about.
 */
export function TextLikeInput({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  type,
  inputMode,
  min,
  max,
  step,
  autoComplete,
}: FieldProps & {
  type: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric' | 'decimal';
  min?: string | number;
  max?: string | number;
  step?: number;
  autoComplete?: string;
}) {
  return (
    <>
      <FieldLabel htmlFor={inputId} question={question} />
      <input
        id={inputId}
        type={type}
        inputMode={inputMode}
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-required={question.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        min={min}
        max={max}
        step={step}
        autoComplete={autoComplete}
        className={`input ${SURFACE_SCHEME}`}
      />
    </>
  );
}
