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
import type { FormPayload, Question, Row } from '@/lib/form-schema';
import { computeVisibilityMap, type Answers } from '@/lib/form-validate';
import { FIELD_COMPONENTS } from './fields';
import { ShortTextField } from './fields/ShortTextField';

export type FormRendererProps = {
  payload: FormPayload;
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
 * The builder hands its draft over verbatim rather than through
 * `readFormPayload`, because the lenient reader drops the half-written
 * question the author is still editing. So a payload reaching this component
 * may be incomplete, and every read below tolerates that instead of throwing
 * a blank screen at the author mid-keystroke.
 */
function safeRows(payload: FormPayload | null | undefined): Row[] {
  if (!payload || !Array.isArray(payload.rows)) return [];
  return payload.rows
    .filter((row): row is Row => !!row && Array.isArray(row.fields))
    .map((row) => ({
      ...row,
      fields: row.fields.filter((q): q is Question => !!q && typeof q.key === 'string' && q.key !== ''),
    }));
}

/** DOM ids may not contain whitespace, and a question key is free text. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

/**
 * Every row is the same three-column grid, so a field in the second column of
 * one row lines up with the second column of the next. Each field spans one
 * column; a row left with a single visible field spans the whole width rather
 * than sitting in a third of it. Mobile is always one column.
 */
const ROW_GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
const FULL_SPAN = 'sm:col-span-2 lg:col-span-3';

function formatAnswer(q: Question, value: string | string[] | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (value === '') return '';
  if (q.type === 'currency') {
    const code = (q.config.currency ?? 'USD').toUpperCase();
    return `${code} ${value}`;
  }
  return value;
}

export function FormRenderer({
  payload,
  answers,
  onChange,
  errors,
  readOnly = false,
  idPrefix = 'form',
  className = '',
}: FormRendererProps) {
  const rows = useMemo(() => safeRows(payload), [payload]);
  const visible = useMemo(
    () => computeVisibilityMap({ schemaVersion: 1, rows }, answers),
    [rows, answers],
  );

  return (
    <div className={`space-y-5 ${className}`}>
      {rows.map((row, rowIndex) => {
        // Absent from the map means the question carries no rule, or came
        // from a draft with no id yet. Show it: only an evaluated `false`
        // hides a question.
        const shown = row.fields.filter((q) => visible.get(q.id) !== false);
        if (shown.length === 0) return null;

        return (
          <div key={row.id || `row-${rowIndex}`} className={ROW_GRID}>
            {shown.map((q) => (
              <Field
                key={q.key}
                question={q}
                answers={answers}
                onChange={onChange}
                error={errors?.[q.key]}
                readOnly={readOnly}
                idPrefix={idPrefix}
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
  idPrefix,
  className,
}: {
  question: Question;
  answers: Answers;
  onChange: (key: string, value: string | string[]) => void;
  error?: string;
  readOnly: boolean;
  idPrefix: string;
  className?: string;
}) {
  const inputId = `${idPrefix}-${slug(question.id || question.key)}`;
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
          {question.label}
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
