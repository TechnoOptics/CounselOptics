'use client';

/**
 * The one renderer for a built intake form.
 *
 * Both the employee Hub and the counsel side mount this. There is no second
 * implementation, because two of them drift and the drift shows up as an
 * employee answering a different form from the one legal built.
 *
 * Three things this file is careful about:
 *
 * 1. Visibility is computed once per render, as a whole map, not per field.
 *    `isQuestionVisible` rebuilds the entire map on every call, so asking it
 *    per field would be quadratic in the number of questions.
 *
 * 2. A hidden question is not rendered at all. Not rendered disabled, not
 *    hidden with CSS. `computeVisibilityMap` is the only source of that
 *    decision, and it is the same function the server validates with, so a
 *    question an employee never saw can never block their submission.
 *
 * 3. Answers key on the question's `key`, never on a row or field index.
 *    Reordering a form must not re-associate an answer with another question.
 *
 * The payload comes in as `unknown` and is narrowed by `safePayload` in
 * lib/form-render-model.ts, which is also where the pure logic lives and where
 * it is unit tested. The builder's draft is raw jsonb that has been through no
 * coercion at all, so that narrowing is the only barrier there is.
 *
 * Errors are supplied by the caller rather than computed here, so the caller
 * decides when to show them (on submit, typically, not on every keystroke).
 * A caller that shows errors on submit should also move focus to the first
 * field carrying one: each message is bound to its input by
 * `aria-describedby`, so focusing the input is what reads the reason aloud.
 *
 * Styling uses the shared `.input` and `.label` classes, which already carry
 * both the light consumer palette and the dark counsel one. Nothing here
 * hard-codes a surface.
 */

import { useMemo } from 'react';
import type { Question } from '@/lib/form-schema';
import { domId, formatAnswer, questionLabel, safePayload } from '@/lib/form-render-model';
import { computeVisibilityMap, type Answers } from '@/lib/form-validate';
import { FIELD_COMPONENTS } from './fields';
import { ShortTextField } from './fields/ShortTextField';

export type FormRendererProps = {
  /**
   * `unknown`, not `FormPayload`, because the builder's draft arrives as raw
   * `draft_payload` jsonb typed `unknown` and uncoerced (see `FormState.draft`
   * in lib/form-queries.ts). Typing it `FormPayload` would only move the
   * problem: the caller would write `as FormPayload` and the cast, not this
   * component, would be where the safety was lost. `safePayload` narrows it
   * here instead, so a published payload and a half-written draft both go in
   * the same way.
   */
  payload: unknown;
  /**
   * Keyed by question `key`. This renderer never deletes an answer: hiding a
   * question leaves whatever was typed into it sitting here, so that flipping
   * the controlling answer back does not lose the work. `validateAnswers`
   * ignores a hidden question's answer, so it cannot block a submission, but
   * the submit path owns the decision of whether to strip those answers
   * before storing them.
   */
  answers: Answers;
  onChange: (key: string, value: string | string[]) => void;
  /** Keyed by question `key`, as `validateAnswers` returns them. */
  errors: Record<string, string>;
  /** Render answers as text, for the counsel view of a submitted request. */
  readOnly?: boolean;
  /**
   * Prefix for generated DOM ids. Set it if two forms are ever on one page,
   * so their inputs and labels do not collide.
   */
  idPrefix?: string;
  className?: string;
};

/**
 * Every row is the same three-column grid, so a field in the second column of
 * one row lines up with the second column of the next. Each field spans one
 * column; a row left with a single visible field spans the whole width rather
 * than sitting in a third of it. Mobile is always one column.
 */
const ROW_GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
const FULL_SPAN = 'sm:col-span-2 lg:col-span-3';

export function FormRenderer({
  payload,
  answers,
  onChange,
  errors,
  readOnly = false,
  idPrefix = 'form',
  className = '',
}: FormRendererProps) {
  const safe = useMemo(() => safePayload(payload), [payload]);
  const visible = useMemo(() => computeVisibilityMap(safe, answers), [safe, answers]);

  return (
    <div className={`space-y-5 ${className}`}>
      {safe.rows.map((row, rowIndex) => {
        // `!visible.get(id)` rather than `!== false`, matching the server's
        // test in `validateAnswers`. The two only ever differ if the map were
        // built from a different set of questions than the one being
        // rendered, and where they differ, treating an unknown question as
        // hidden is the safe direction: showing something the server counts
        // as hidden is what breaks requiredness.
        const shown = row.fields.filter((q) => visible.get(q.id));
        if (shown.length === 0) return null;

        return (
          <div key={row.id} className={ROW_GRID}>
            {shown.map((q) => (
              <Field
                key={q.key}
                question={q}
                answers={answers}
                onChange={onChange}
                error={errors[q.key]}
                readOnly={readOnly}
                inputId={domId(idPrefix, q.key, rowIndex, row.fields.indexOf(q))}
                className={shown.length === 1 ? FULL_SPAN : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  question,
  answers,
  onChange,
  error,
  readOnly,
  inputId,
  className,
}: {
  question: Question;
  answers: Answers;
  onChange: (key: string, value: string | string[]) => void;
  error?: string;
  readOnly: boolean;
  inputId: string;
  className?: string;
}) {
  const helpId = question.help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const value = answers[question.key];

  if (readOnly) {
    const text = formatAnswer(question, value);
    // The unanswered note uses ink-500, not the obvious muted ink-400, which
    // is only 2.6:1 on white. "Not answered" is a fact the reader needs.
    return (
      <div className={`min-w-0 ${className ?? ''}`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/55">
          {questionLabel(question)}
        </p>
        <p
          className={`mt-1 whitespace-pre-wrap break-words text-sm ${
            text
              ? 'text-forest-900 dark:text-cream-100'
              : 'text-ink-500 dark:text-cream-100/60'
          }`}
        >
          {text || 'Not answered'}
        </p>
      </div>
    );
  }

  const Control = FIELD_COMPONENTS[question.type] ?? ShortTextField;

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <Control
        question={question}
        value={value}
        onChange={(next) => onChange(question.key, next)}
        inputId={inputId}
        describedBy={describedBy}
        invalid={!!error}
      />
      {question.help && (
        <p id={helpId} className="mt-1 text-[12px] text-ink-500 dark:text-cream-100/55">
          {question.help}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-[12px] text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

export default FormRenderer;
