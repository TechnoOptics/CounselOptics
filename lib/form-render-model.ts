/**
 * The pure logic behind `components/forms/FormRenderer.tsx`: turning whatever
 * the caller actually holds into something safe to render, naming a control's
 * DOM id, and reading an answer back as text.
 *
 * It lives here rather than inside the component for one reason: this repo's
 * test environment is `node` with no DOM (see vitest.config.ts), so a module
 * with no React in it is testable today and a component is not. These are the
 * branches in the renderer that can be got wrong quietly, so they are the part
 * that most needs the coverage.
 */

import { QUESTION_TYPES } from './form-schema';
import type {
  FormPayload,
  Question,
  QuestionConfig,
  QuestionType,
  Row,
  Rule,
} from './form-schema';

const QUESTION_TYPE_SET: ReadonlySet<string> = new Set<string>(QUESTION_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s === '' ? undefined : s;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `min` and `max` are a number on numeric questions and an ISO string on the
 *  date and time ones, so both shapes pass through and nothing else does. */
function bound(value: unknown): number | string | undefined {
  return num(value) ?? str(value);
}

/**
 * A config that every field component can destructure without throwing and
 * without rendering `[object Object]` into a DOM attribute. Deliberately not
 * keyed off the question's type, unlike `coerceConfig` in form-schema: an
 * author part-way through changing a question's type still has the old type's
 * config attached, and dropping it here would lose their work in the preview.
 */
function coerceConfig(raw: unknown): QuestionConfig {
  if (!isRecord(raw)) return {};
  const config: QuestionConfig = {};

  const maxChars = num(raw.maxChars);
  if (maxChars !== undefined) config.maxChars = maxChars;
  const maxWords = num(raw.maxWords);
  if (maxWords !== undefined) config.maxWords = maxWords;
  const step = num(raw.step);
  if (step !== undefined) config.step = step;
  const min = bound(raw.min);
  if (min !== undefined) config.min = min;
  const max = bound(raw.max);
  if (max !== undefined) config.max = max;
  const currency = str(raw.currency);
  if (currency !== undefined) config.currency = currency;

  // Always an array when present: SelectField and MultiSelectField map over it.
  if (raw.options !== undefined) {
    config.options = Array.isArray(raw.options)
      ? raw.options.map((o) => (typeof o === 'string' ? o : String(o ?? ''))).filter(Boolean)
      : [];
  }

  return config;
}

/**
 * A rule, or nothing. A malformed rule is dropped rather than kept, because
 * `computeVisibilityMap` reads `showWhen.questionId` and a rule pointing at
 * nothing resolves to hidden. Dropping it leaves the question always shown,
 * which is the right way to fail for the question the author is editing.
 */
function coerceRule(raw: unknown): Rule | undefined {
  if (!isRecord(raw)) return undefined;
  const questionId = str(raw.questionId);
  if (!questionId) return undefined;
  const op = raw.op;
  if (op !== 'eq' && op !== 'neq' && op !== 'answered') return undefined;
  if ((op === 'eq' || op === 'neq') && typeof raw.value !== 'string') return undefined;
  return { questionId, op, value: typeof raw.value === 'string' ? raw.value : undefined };
}

/**
 * Rows the renderer can walk without throwing, from anything at all.
 *
 * The parameter is `unknown` on purpose. The builder's draft arrives as raw
 * `draft_payload` jsonb, typed `unknown` all the way from Postgres (see
 * `FormState.draft` in lib/form-queries.ts), with no coercion anywhere in
 * between. Typing this `FormPayload` would only mean the caller writes
 * `safeRows(draft as FormPayload)`, and the cast, not this function, would be
 * where the safety was actually lost.
 *
 * It never throws and never routes the draft through `readFormPayload`: that
 * reader drops a question with no label yet, which is exactly the question the
 * author is looking at in the preview. Coerce, clamp, drop what it cannot
 * understand, always return something renderable, in the style of
 * `readPartnerConfig` in lib/partner-config-core.ts.
 *
 * What it repairs, and why each one matters:
 *
 *   - one question per `key`. A duplicate key means two questions reading and
 *     writing one answer, so the later one is dropped.
 *   - a non-empty `id`. `computeVisibilityMap` keys on `id`, so a question
 *     without one would share a map entry with every other question missing
 *     one, and could be hidden by a rule that has nothing to do with it.
 *   - a known `type`, falling back to `short_text`. An unknown type has no
 *     field component, and rendering the question as a text box keeps the
 *     author's half-written question on screen.
 *   - a `config` object with usable values. `Question.config` is declared
 *     non-optional, so TypeScript never flags its absence, but seven of the
 *     twelve field components destructure it.
 *   - a boolean `required`. It reaches the DOM as `aria-required`, and a
 *     truthy non-boolean would emit `aria-required="yes"`, which is not valid
 *     ARIA and announces nothing.
 *   - at most three fields per row, which is what the grid lays out.
 *
 * A duplicate non-empty `id` is left alone: a rule may point at it, and
 * rewriting it here would silently break that rule. `validateFormPayload`
 * rejects it at publish time.
 */
export function safeRows(payload: unknown): Row[] {
  if (!isRecord(payload) || !Array.isArray(payload.rows)) return [];

  const seenKeys = new Set<string>();
  const rows: Row[] = [];

  payload.rows.forEach((rawRow, rowIndex) => {
    if (!isRecord(rawRow) || !Array.isArray(rawRow.fields)) return;

    const fields: Question[] = [];
    rawRow.fields.forEach((rawField, fieldIndex) => {
      if (fields.length >= 3) return;
      if (!isRecord(rawField)) return;

      const key = typeof rawField.key === 'string' ? rawField.key.trim() : '';
      if (key === '' || seenKeys.has(key)) return;
      seenKeys.add(key);

      const type =
        typeof rawField.type === 'string' && QUESTION_TYPE_SET.has(rawField.type)
          ? (rawField.type as QuestionType)
          : 'short_text';

      fields.push({
        id: str(rawField.id) ?? `draft-${rowIndex}-${fieldIndex}`,
        key,
        type,
        label: typeof rawField.label === 'string' ? rawField.label : '',
        help: str(rawField.help),
        required: rawField.required === true,
        config: coerceConfig(rawField.config),
        showWhen: coerceRule(rawField.showWhen),
      });
    });

    if (fields.length > 0) {
      rows.push({ id: str(rawRow.id) ?? `draft-row-${rowIndex}`, fields });
    }
  });

  return rows;
}

/** The coerced rows back in payload shape, for handing to lib/form-validate. */
export function safePayload(payload: unknown): FormPayload {
  return { schemaVersion: 1, rows: safeRows(payload) };
}

/**
 * A DOM id for one question's control. Built from the question's position as
 * well as its key: a key is free text, so two different keys can slug to the
 * same string, and a colliding id would bind a label to the wrong control and
 * merge two yesno questions into one radio group.
 */
export function domId(
  prefix: string,
  key: string,
  rowIndex: number,
  fieldIndex: number,
): string {
  return `${prefix}-${rowIndex}-${fieldIndex}-${key.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/**
 * What to show as a question's label.
 *
 * A published question always has one: `validateFormPayload` rejects an empty
 * label at the publish gate. A draft in the builder's preview may not, because
 * the author has not typed it yet, and rendering an input with an empty label
 * would leave a screen reader with an unnamed control. The placeholder names
 * it without pretending to be the author's words.
 */
export function questionLabel(q: Pick<Question, 'label'>): string {
  return q.label?.trim() ? q.label : 'Untitled question';
}

/** One answer as the counsel side reads it back, in the read-only view. */
export function formatAnswer(
  q: Question,
  value: string | string[] | undefined,
): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (value === '') return '';
  if (q.type === 'currency') {
    // The stored answer is whatever the employee typed, and the validator
    // accepts a leading symbol, so strip one before prefixing the code rather
    // than reading back "USD $2,500.00".
    const code = (q.config?.currency ?? 'USD').toUpperCase();
    return `${code} ${value.trim().replace(/^\$\s*/, '')}`;
  }
  return value;
}
