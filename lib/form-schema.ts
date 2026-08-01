/**
 * Intake form payload: the schema a firm's built intake form is stored as,
 * and the two ways to read it back.
 *
 * `validateFormPayload` is the publish gate. It is strict and collects every
 * problem in one pass, because the builder's publish dialog lists each one as
 * a link to the offending field. A validator that stops at the first error
 * makes that UI useless.
 *
 * `readFormPayload` is the render path. It is lenient and never throws,
 * modelled on `readPartnerConfig` in lib/partner-config-core.ts: coerce,
 * clamp, drop what it cannot understand, always return something usable. A
 * stored version must always render, even if it somehow drifted out of
 * shape.
 *
 * See docs/superpowers/specs/2026-08-01-intake-form-builder-design.md for the
 * full design (data model, builder UX, partner projection). This file owns
 * only the payload shape and the two entry points above.
 */

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency',
  'date',
  'time',
  'datetime',
  'yesno',
  'select',
  'multiselect',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

const QUESTION_TYPE_SET: ReadonlySet<string> = new Set(QUESTION_TYPES);

function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && QUESTION_TYPE_SET.has(value);
}

// Loose superset of every type's config shape. Which keys apply depends on
// `Question.type`; both entry points enforce that at runtime rather than in
// the type system, matching the hand-rolled style of PartnerQuestion.
export type QuestionConfig = {
  maxChars?: number;
  maxWords?: number;
  min?: number | string;
  max?: number | string;
  step?: number;
  currency?: string;
  options?: string[];
};

export type Rule = {
  questionId: string; // must appear earlier in the form
  op: 'eq' | 'neq' | 'answered';
  value?: string; // required for eq and neq
};

export type Question = {
  id: string;
  key: string; // answers are stored against this, immutable once published
  type: QuestionType;
  label: string;
  help?: string;
  required: boolean;
  config: QuestionConfig;
  showWhen?: Rule;
};

export type Row = {
  id: string;
  fields: Question[]; // one to three
};

export type FormPayload = {
  schemaVersion: 1;
  rows: Row[];
};

export type FormError = {
  path: string;
  questionId?: string;
  message: string;
};

const MAX_LABEL = 200;
const MAX_HELP = 500;
const MAX_OPTIONS = 100;
const MAX_QUESTIONS = 60;
const MAX_ROWS = 40;

function emptyPayload(): FormPayload {
  return { schemaVersion: 1, rows: [] };
}

export const EMPTY_PAYLOAD: FormPayload = emptyPayload();

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// validateFormPayload: the publish gate. Strict, collects every error.
// ---------------------------------------------------------------------------

export function validateFormPayload(
  payload: unknown,
): { ok: true; payload: FormPayload } | { ok: false; errors: FormError[] } {
  const errors: FormError[] = [];
  const fail = (path: string, message: string, questionId?: string) => {
    errors.push(questionId ? { path, message, questionId } : { path, message });
  };

  if (typeof payload !== 'object' || payload === null) {
    fail('', 'Form payload must be an object.');
    return { ok: false, errors };
  }
  const p = payload as Record<string, unknown>;

  if (p.schemaVersion !== 1) {
    fail('schemaVersion', 'schemaVersion must be 1.');
  }

  if (!Array.isArray(p.rows)) {
    fail('rows', 'rows must be an array.');
    return { ok: false, errors };
  }
  const rawRows = p.rows as unknown[];

  if (rawRows.length === 0) {
    fail('rows', 'A form must contain at least one row.');
  }
  if (rawRows.length > MAX_ROWS) {
    fail('rows', `A form may contain at most ${MAX_ROWS} rows.`);
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const rows: Row[] = [];
  let questionCount = 0;

  rawRows.forEach((rawRow, rowIndex) => {
    const rowPath = `rows[${rowIndex}]`;

    if (typeof rawRow !== 'object' || rawRow === null) {
      fail(rowPath, 'Each row must be an object.');
      return;
    }
    const ro = rawRow as Record<string, unknown>;

    const rowId = typeof ro.id === 'string' ? ro.id.trim() : '';
    if (!rowId) fail(`${rowPath}.id`, 'Each row must have an id.');

    if (!Array.isArray(ro.fields)) {
      fail(`${rowPath}.fields`, 'A row\'s fields must be an array.');
      return;
    }
    const rawFields = ro.fields as unknown[];

    if (rawFields.length < 1 || rawFields.length > 3) {
      fail(`${rowPath}.fields`, 'Each row must contain one to three fields.');
    }

    const fields: Question[] = [];

    rawFields.forEach((rawField, fieldIndex) => {
      const fieldPath = `${rowPath}.fields[${fieldIndex}]`;
      questionCount += 1;
      if (questionCount > MAX_QUESTIONS) {
        fail(fieldPath, `A form may contain at most ${MAX_QUESTIONS} questions.`);
      }

      if (typeof rawField !== 'object' || rawField === null) {
        fail(fieldPath, 'Each field must be an object.');
        return;
      }
      const qo = rawField as Record<string, unknown>;

      const id = typeof qo.id === 'string' ? qo.id.trim() : '';
      if (!id) fail(`${fieldPath}.id`, 'Each question must have an id.');

      const key = typeof qo.key === 'string' ? qo.key.trim() : '';
      if (!key) {
        fail(`${fieldPath}.key`, 'Each question must have a key.', id || undefined);
      } else if (seenKeys.has(key)) {
        fail(
          `${fieldPath}.key`,
          `Question key "${key}" must be unique within the form.`,
          id || undefined,
        );
      } else {
        seenKeys.add(key);
      }

      const type = qo.type;
      if (!isQuestionType(type)) {
        fail(
          `${fieldPath}.type`,
          `Question type must be one of: ${QUESTION_TYPES.join(', ')}.`,
          id || undefined,
        );
      }

      const rawLabel = typeof qo.label === 'string' ? qo.label : '';
      const label = rawLabel.trim();
      if (!label) {
        fail(`${fieldPath}.label`, 'Question label must not be empty.', id || undefined);
      } else if (label.length > MAX_LABEL) {
        fail(
          `${fieldPath}.label`,
          `Question label must be at most ${MAX_LABEL} characters.`,
          id || undefined,
        );
      }

      if (qo.help !== undefined) {
        const help = typeof qo.help === 'string' ? qo.help.trim() : '';
        if (help.length > MAX_HELP) {
          fail(
            `${fieldPath}.help`,
            `Question help text must be at most ${MAX_HELP} characters.`,
            id || undefined,
          );
        }
      }

      const config =
        typeof qo.config === 'object' && qo.config !== null
          ? (qo.config as Record<string, unknown>)
          : {};

      if (isQuestionType(type)) {
        if (type === 'select' || type === 'multiselect') {
          const options = config.options;
          if (!Array.isArray(options) || options.length === 0) {
            fail(
              `${fieldPath}.config.options`,
              'Select and multiselect questions must have at least one option.',
              id || undefined,
            );
          } else if (options.length > MAX_OPTIONS) {
            fail(
              `${fieldPath}.config.options`,
              `Options are capped at ${MAX_OPTIONS} entries.`,
              id || undefined,
            );
          }
        }
        if (type === 'currency') {
          const currency = config.currency;
          if (typeof currency !== 'string' || !currency.trim()) {
            fail(
              `${fieldPath}.config.currency`,
              'Currency questions must name a currency.',
              id || undefined,
            );
          }
        }
      }

      if (qo.showWhen !== undefined) {
        const swPath = `${fieldPath}.showWhen`;
        if (typeof qo.showWhen !== 'object' || qo.showWhen === null) {
          fail(swPath, 'showWhen must be an object.', id || undefined);
        } else {
          const sw = qo.showWhen as Record<string, unknown>;
          const refId = typeof sw.questionId === 'string' ? sw.questionId.trim() : '';
          if (!refId) {
            fail(`${swPath}.questionId`, 'showWhen must reference a question id.', id || undefined);
          } else if (!seenIds.has(refId)) {
            fail(
              `${swPath}.questionId`,
              'showWhen must reference a question that appears earlier in the form.',
              id || undefined,
            );
          }

          const op = sw.op;
          if (op !== 'eq' && op !== 'neq' && op !== 'answered') {
            fail(`${swPath}.op`, 'showWhen.op must be eq, neq, or answered.', id || undefined);
          } else if ((op === 'eq' || op === 'neq') && typeof sw.value !== 'string') {
            fail(
              `${swPath}.value`,
              'showWhen.value is required when op is eq or neq.',
              id || undefined,
            );
          }
        }
      }

      if (id) seenIds.add(id);

      fields.push({
        id,
        key,
        type: isQuestionType(type) ? type : 'short_text',
        label,
        help: typeof qo.help === 'string' && qo.help.trim() ? qo.help.trim() : undefined,
        required: qo.required === true,
        config: config as QuestionConfig,
        showWhen:
          typeof qo.showWhen === 'object' && qo.showWhen !== null
            ? (qo.showWhen as Rule)
            : undefined,
      });
    });

    rows.push({ id: rowId, fields });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, payload: { schemaVersion: 1, rows } };
}

// ---------------------------------------------------------------------------
// readFormPayload: the render path. Lenient, never throws.
// ---------------------------------------------------------------------------

function coerceConfig(type: QuestionType, raw: unknown): QuestionConfig {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || undefined;
  };

  switch (type) {
    case 'short_text':
      return { maxChars: num(o.maxChars) };
    case 'long_text':
      return { maxWords: num(o.maxWords), maxChars: num(o.maxChars) };
    case 'number':
      return { min: num(o.min), max: num(o.max), step: num(o.step) };
    case 'currency':
      return {
        currency: str(o.currency) ?? 'USD',
        min: num(o.min),
        max: num(o.max),
      };
    case 'date':
    case 'time':
    case 'datetime':
      return { min: str(o.min), max: str(o.max) };
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(o.options)
        ? (o.options as unknown[])
            .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
            .filter(Boolean)
            .slice(0, MAX_OPTIONS)
        : [];
      return { options };
    }
    case 'email':
    case 'phone':
    case 'yesno':
    default:
      return {};
  }
}

function coerceQuestion(
  raw: unknown,
  usedKeys: Set<string>,
  seenIds: Set<string>,
): Question | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const qo = raw as Record<string, unknown>;

  const key = typeof qo.key === 'string' ? qo.key.trim() : '';
  if (!key || usedKeys.has(key)) return null;

  const type = isQuestionType(qo.type) ? qo.type : null;
  if (!type) return null;

  const label = (typeof qo.label === 'string' ? qo.label.trim() : '').slice(0, MAX_LABEL);
  if (!label) return null;

  const id = (typeof qo.id === 'string' ? qo.id.trim() : '') || randomId();
  const help = typeof qo.help === 'string' ? qo.help.trim().slice(0, MAX_HELP) : '';

  let showWhen: Rule | undefined;
  if (typeof qo.showWhen === 'object' && qo.showWhen !== null) {
    const sw = qo.showWhen as Record<string, unknown>;
    const refId = typeof sw.questionId === 'string' ? sw.questionId.trim() : '';
    const op = sw.op === 'eq' || sw.op === 'neq' || sw.op === 'answered' ? sw.op : null;
    const valueOk = op !== 'eq' && op !== 'neq' ? true : typeof sw.value === 'string';
    if (refId && op && valueOk && seenIds.has(refId)) {
      showWhen = { questionId: refId, op, value: typeof sw.value === 'string' ? sw.value : undefined };
    }
    // Anything else about the rule is dropped, not the question: a question
    // with a broken rule should still render, just always shown.
  }

  usedKeys.add(key);

  return {
    id,
    key,
    type,
    label,
    help: help || undefined,
    required: qo.required === true,
    config: coerceConfig(type, qo.config),
    showWhen,
  };
}

export function readFormPayload(raw: unknown): FormPayload {
  if (typeof raw !== 'object' || raw === null) return emptyPayload();
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.rows)) return emptyPayload();

  const usedKeys = new Set<string>();
  const seenIds = new Set<string>();
  const rows: Row[] = [];
  let questionCount = 0;

  const rawRows = (o.rows as unknown[]).slice(0, MAX_ROWS);

  for (const rawRow of rawRows) {
    if (typeof rawRow !== 'object' || rawRow === null) continue;
    const ro = rawRow as Record<string, unknown>;
    const rawFields = Array.isArray(ro.fields) ? (ro.fields as unknown[]) : [];

    const fields: Question[] = [];
    for (const rawField of rawFields) {
      if (fields.length >= 3) break;
      if (questionCount >= MAX_QUESTIONS) break;
      const q = coerceQuestion(rawField, usedKeys, seenIds);
      if (!q) continue;
      seenIds.add(q.id);
      fields.push(q);
      questionCount += 1;
    }

    if (fields.length === 0) continue;

    const id = (typeof ro.id === 'string' ? ro.id.trim() : '') || randomId();
    rows.push({ id, fields });

    if (questionCount >= MAX_QUESTIONS) break;
  }

  return { schemaVersion: 1, rows };
}
