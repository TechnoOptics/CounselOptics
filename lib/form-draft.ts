/**
 * The pure logic behind the intake form builder's canvas.
 *
 * The builder holds one `FormPayload` in React state and rewrites it with the
 * functions here. They live outside the component for the same reason
 * lib/form-render-model.ts does: this repo's vitest environment is `node` with
 * no DOM (see vitest.config.ts), so a module with no React in it is testable
 * today and a component is not. These are also the parts of the builder that
 * can be got wrong quietly, which makes them the parts that most need it.
 *
 * Every function returns a NEW payload and mutates nothing, so React sees a
 * changed reference and the autosave effect fires. None of them validate:
 * `validateFormPayload` is the publish gate, and a draft is allowed to be
 * half-finished, which is the entire reason a draft exists separately from a
 * version.
 *
 * Two invariants the canvas holds that the payload alone does not:
 *
 *  1. A rule may only point at a question ABOVE it in document order.
 *     `questionsBefore` is what the rule editor offers, so the invariant is
 *     taught by the control rather than enforced by an error afterwards.
 *     `ruleProblems` catches the cases where a form gets into that state
 *     anyway, by a move or a delete.
 *
 *  2. At most three fields to a row, which is what the renderer's grid lays
 *     out. `addQuestion` refuses a fourth and `moveQuestion` opens a new row
 *     rather than overfilling one.
 */

import { QUESTION_TYPES } from './form-schema';
import type {
  FormPayload,
  Question,
  QuestionConfig,
  QuestionType,
  Rule,
  Row,
} from './form-schema';
import { safeRows } from './form-render-model';
import { projectType } from './form-to-partner';

/** What the renderer's grid lays out, and therefore what a row may hold. */
export const MAX_FIELDS_PER_ROW = 3;

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Reading the form
// ---------------------------------------------------------------------------

export type FlatQuestion = {
  question: Question;
  rowIndex: number;
  fieldIndex: number;
  /** 1-based position in document order, which is what the canvas prints. */
  number: number;
};

/**
 * Every question in document order: row by row, and left to right within a
 * row. This is the order the renderer resolves visibility in, so it is the
 * only order "above" and "below" can mean.
 */
export function flattenQuestions(payload: FormPayload): FlatQuestion[] {
  const flat: FlatQuestion[] = [];
  payload.rows.forEach((row, rowIndex) => {
    row.fields.forEach((question, fieldIndex) => {
      flat.push({ question, rowIndex, fieldIndex, number: flat.length + 1 });
    });
  });
  return flat;
}

/**
 * The questions a rule on `id` may legally point at. A question sharing a row
 * with `id` but sitting to its left counts: the grid puts them side by side,
 * but document order still puts it first, and that is what the renderer reads.
 */
export function questionsBefore(payload: FormPayload, id: string): FlatQuestion[] {
  const flat = flattenQuestions(payload);
  const at = flat.findIndex((f) => f.question.id === id);
  return at <= 0 ? [] : flat.slice(0, at);
}

function findFlat(payload: FormPayload, id: string): FlatQuestion | undefined {
  return flattenQuestions(payload).find((f) => f.question.id === id);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * A question's key is what answers are stored against, so it is derived from
 * the label while the question is still only a draft and frozen the moment it
 * has been published. Same shape as the request type slug in lib/form-actions.
 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  const root = base || `q_${Math.random().toString(36).slice(2, 8)}`;
  if (!taken.has(root)) return root;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${root.slice(0, 36)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 30)}_${Math.random().toString(36).slice(2, 8)}`;
}

function keysExcept(payload: FormPayload, id: string): Set<string> {
  const keys = new Set<string>();
  for (const { question } of flattenQuestions(payload)) {
    if (question.id !== id) keys.add(question.key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Per-type defaults
// ---------------------------------------------------------------------------

/**
 * What a question of this type needs in `config` before its editor has
 * anything to edit. Select starts with an empty options list rather than a
 * sample option, because a sample the author forgets to remove publishes.
 */
export function defaultConfigFor(type: QuestionType): QuestionConfig {
  if (type === 'select' || type === 'multiselect') return { options: [] };
  if (type === 'currency') return { currency: 'USD' };
  return {};
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type AddTarget = { kind: 'row'; rowIndex: number } | { kind: 'newRow' };

/**
 * Add a question to a row, or to a new row at the bottom. The question is
 * created unlabelled: the builder focuses its label input, so the author's
 * first keystroke is the label rather than an acknowledgement of a placeholder.
 */
export function addQuestion(
  payload: FormPayload,
  target: AddTarget,
  type: QuestionType,
): { payload: FormPayload; question: Question } {
  const taken = new Set(flattenQuestions(payload).map((f) => f.question.key));
  const question: Question = {
    id: newId(),
    key: uniqueKey(type, taken),
    type,
    label: '',
    required: false,
    config: defaultConfigFor(type),
  };

  if (target.kind === 'row') {
    const row = payload.rows[target.rowIndex];
    if (!row || row.fields.length >= MAX_FIELDS_PER_ROW) {
      return { payload, question };
    }
    const rows = payload.rows.map((r, i) =>
      i === target.rowIndex ? { ...r, fields: [...r.fields, question] } : r,
    );
    return { payload: { schemaVersion: 1, rows }, question };
  }

  return {
    payload: {
      schemaVersion: 1,
      rows: [...payload.rows, { id: newId(), fields: [question] }],
    },
    question,
  };
}

export type QuestionPatch = Partial<
  Pick<Question, 'label' | 'help' | 'required' | 'type' | 'config' | 'showWhen'>
>;

/**
 * Apply a patch to one question.
 *
 * `frozenKeys` is the set of keys the published version already uses. A key in
 * that set is never rewritten, because answers already filed are stored
 * against it; a key outside it tracks the label, so the partner API and the
 * stored answers read as words rather than as `short_text_2`.
 *
 * Changing the type replaces the config with the new type's defaults, except
 * between select and multiselect, which are the same question asked once or
 * many times and share their options.
 */
export function updateQuestion(
  payload: FormPayload,
  id: string,
  patch: QuestionPatch,
  frozenKeys: ReadonlySet<string>,
): FormPayload {
  const taken = keysExcept(payload, id);

  const rows = payload.rows.map((row) => ({
    ...row,
    fields: row.fields.map((q) => {
      if (q.id !== id) return q;
      const next: Question = { ...q, ...patch };

      if (patch.type !== undefined && patch.type !== q.type) {
        const optionTypes = patch.type === 'select' || patch.type === 'multiselect';
        const wasOptions = q.type === 'select' || q.type === 'multiselect';
        next.config =
          optionTypes && wasOptions
            ? { options: q.config.options ?? [] }
            : defaultConfigFor(patch.type);
      }

      if (patch.label !== undefined && !frozenKeys.has(q.key)) {
        next.key = uniqueKey(slug(patch.label) || slug(next.type), taken);
      }

      return next;
    }),
  }));

  return { schemaVersion: 1, rows };
}

/**
 * Remove a question, and the row if that emptied it.
 *
 * Rules pointing at the removed question are deliberately LEFT in place.
 * Stripping them would quietly turn a conditional question into an
 * unconditional one, which is a change to the form the author never asked for
 * and would not be told about. `ruleProblems` reports the dangling rule
 * instead, and the builder offers to remove it by name.
 */
export function deleteQuestion(payload: FormPayload, id: string): FormPayload {
  const rows = payload.rows
    .map((row) => ({ ...row, fields: row.fields.filter((q) => q.id !== id) }))
    .filter((row) => row.fields.length > 0);
  return { schemaVersion: 1, rows };
}

/** Take the rule off one question, leaving it always shown. */
export function clearRule(payload: FormPayload, id: string): FormPayload {
  const rows = payload.rows.map((row) => ({
    ...row,
    fields: row.fields.map((q) => {
      if (q.id !== id) return q;
      const { showWhen: _dropped, ...rest } = q;
      return rest as Question;
    }),
  }));
  return { schemaVersion: 1, rows };
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Move one field. Every direction is available from the keyboard, because a
 * builder that only reorders by drag is unusable without a mouse.
 *
 * Left and right reorder within the row. Up and down move between rows, and
 * mean the same thing whatever the row holds: the question ends up one row
 * earlier or later. When it is alone in its row that is a row swap; when the
 * neighbouring row has space it joins that row; when it does not, the question
 * takes a row of its own, which is also the only way to split a full row.
 */
export function moveQuestion(
  payload: FormPayload,
  id: string,
  direction: MoveDirection,
): FormPayload {
  const at = findFlat(payload, id);
  if (!at) return payload;

  const rows: Row[] = payload.rows.map((r) => ({ ...r, fields: [...r.fields] }));
  const { rowIndex, fieldIndex } = at;
  const fields = rows[rowIndex].fields;

  if (direction === 'left' || direction === 'right') {
    const swapWith = direction === 'left' ? fieldIndex - 1 : fieldIndex + 1;
    if (swapWith < 0 || swapWith >= fields.length) return payload;
    [fields[fieldIndex], fields[swapWith]] = [fields[swapWith], fields[fieldIndex]];
    return { schemaVersion: 1, rows };
  }

  const targetIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
  const alone = fields.length === 1;

  if (alone) {
    if (targetIndex < 0 || targetIndex >= rows.length) return payload;
    [rows[rowIndex], rows[targetIndex]] = [rows[targetIndex], rows[rowIndex]];
    return { schemaVersion: 1, rows };
  }

  const [moved] = fields.splice(fieldIndex, 1);
  const target = rows[targetIndex];

  if (target && target.fields.length < MAX_FIELDS_PER_ROW) {
    // Up joins the row above at its end and down joins the row below at its
    // start, so in both cases the question crosses exactly one boundary
    // rather than jumping past the whole row it lands in.
    if (direction === 'up') target.fields.push(moved);
    else target.fields.unshift(moved);
    return { schemaVersion: 1, rows };
  }

  const insertAt = direction === 'up' ? rowIndex : rowIndex + 1;
  rows.splice(insertAt, 0, { id: newId(), fields: [moved] });
  return { schemaVersion: 1, rows };
}

// ---------------------------------------------------------------------------
// Problems the canvas surfaces
// ---------------------------------------------------------------------------

export type RuleProblemKind =
  /** The rule points at a question that comes later in the form. */
  | 'forward'
  /** The rule points at a question that is no longer in the form at all. */
  | 'missing'
  /** An is / is not rule with nothing to compare against. */
  | 'value';

export type RuleProblem = {
  questionId: string;
  questionLabel: string;
  questionNumber: number;
  kind: RuleProblemKind;
  /** Absent on a `missing` problem: the question it named is gone. */
  targetLabel?: string;
  targetNumber?: number;
};

/**
 * Every rule the form cannot honour, in document order.
 *
 * `missing` is the one that would otherwise be silent. `coerceRule` in
 * lib/form-render-model keeps a rule whose target has been deleted (unlike
 * `readFormPayload`, which drops it), `computeVisibilityMap` resolves a rule
 * with no controller to hidden, and the author's question disappears from
 * their own preview with no explanation. The builder is where that dangling
 * rule gets created, so it is where it gets named.
 */
export function ruleProblems(payload: FormPayload): RuleProblem[] {
  const flat = flattenQuestions(payload);
  const byId = new Map(flat.map((f) => [f.question.id, f]));
  const problems: RuleProblem[] = [];

  for (const { question, number } of flat) {
    const rule = question.showWhen;
    if (!rule) continue;

    const base = {
      questionId: question.id,
      questionLabel: question.label,
      questionNumber: number,
    };
    const target = byId.get(rule.questionId);

    if (!target) {
      problems.push({ ...base, kind: 'missing' });
      continue;
    }
    if (target.number >= number) {
      problems.push({
        ...base,
        kind: 'forward',
        targetLabel: target.question.label,
        targetNumber: target.number,
      });
      continue;
    }
    if ((rule.op === 'eq' || rule.op === 'neq') && !rule.value) {
      problems.push({
        ...base,
        kind: 'value',
        targetLabel: target.question.label,
        targetNumber: target.number,
      });
    }
  }

  return problems;
}

/** `renderedAs` is whatever `projectType` returns, never a restatement of it. */
export type PartnerDegradation = {
  type: QuestionType;
  renderedAs: ReturnType<typeof projectType>;
};

/**
 * The one question type each partner type is a faithful rendering of. A
 * question degrades exactly when `projectType` sends it somewhere other than
 * its own entry here: a `short_text` becomes a partner `text` and loses
 * nothing, a `date` becomes the same `text` and loses its calendar.
 *
 * Deliberately not a second list of "supported types". The projection itself
 * stays the single source of what a type becomes; this only says which pairing
 * is lossless.
 */
const PARTNER_FAITHFUL: Record<'text' | 'select' | 'yesno', QuestionType> = {
  text: 'short_text',
  select: 'select',
  yesno: 'yesno',
};

/**
 * What an older partner employee app will make of this form. It parses three
 * types and cannot evaluate a rule (see lib/form-to-partner.ts), so anything
 * else is shown as something simpler, and every conditional question is shown
 * to everyone and never required.
 *
 * The mapping is `projectType` itself rather than a second copy of it, so the
 * warning cannot drift away from what the API actually sends.
 */
export function partnerDegradations(payload: FormPayload): {
  types: PartnerDegradation[];
  conditional: number;
} {
  const types: PartnerDegradation[] = [];
  const seen = new Set<QuestionType>();
  let conditional = 0;

  for (const { question } of flattenQuestions(payload)) {
    if (question.showWhen) conditional += 1;

    const renderedAs = projectType(question.type);
    if (PARTNER_FAITHFUL[renderedAs] === question.type) continue;
    if (seen.has(question.type)) continue;
    seen.add(question.type);
    types.push({ type: question.type, renderedAs });
  }

  return { types, conditional };
}

// ---------------------------------------------------------------------------
// What the canvas opens with
// ---------------------------------------------------------------------------

export type DraftSource = 'draft' | 'published' | 'empty';

/**
 * What the builder loads: the saved draft if there is one, otherwise the
 * published form as a starting point to edit, otherwise nothing.
 *
 * The `source` matters as much as the payload. Opening on the published form
 * must NOT save a draft, or merely visiting the page would flag the type as
 * having unpublished changes. The builder only autosaves once the author has
 * changed something.
 *
 * The draft goes through `safeRows`, not `readFormPayload`: the lenient reader
 * drops a question with no label yet, which is exactly the question the author
 * left half-written.
 */
export function startingDraft(
  draft: unknown,
  published: FormPayload | null,
): { payload: FormPayload; source: DraftSource } {
  const rows = safeRows(draft);
  if (rows.length > 0) return { payload: { schemaVersion: 1, rows }, source: 'draft' };
  if (published && published.rows.length > 0) {
    return { payload: { schemaVersion: 1, rows: published.rows }, source: 'published' };
  }
  return { payload: { schemaVersion: 1, rows: [] }, source: 'empty' };
}

// ---------------------------------------------------------------------------
// Labels for the type picker and the field summary
// ---------------------------------------------------------------------------

/**
 * The picker's two groups. Text types differ only in the keyboard an employee
 * gets; structured types change what an answer means, which is the division an
 * author actually reasons about.
 */
export const TYPE_GROUPS: { group: 'text' | 'structured'; types: QuestionType[] }[] = [
  { group: 'text', types: ['short_text', 'long_text', 'email', 'phone'] },
  {
    group: 'structured',
    types: ['number', 'currency', 'date', 'time', 'datetime', 'yesno', 'select', 'multiselect'],
  },
];

export const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email address',
  phone: 'Phone number',
  number: 'Number',
  currency: 'Amount',
  date: 'Date',
  time: 'Time',
  datetime: 'Date and time',
  yesno: 'Yes or no',
  select: 'Choose one',
  multiselect: 'Choose several',
};

export const RULE_OP_LABELS: Record<Rule['op'], string> = {
  eq: 'is',
  neq: 'is not',
  answered: 'has any answer',
};
