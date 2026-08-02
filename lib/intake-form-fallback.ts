/**
 * What the two intake surfaces ask, and what happens when nothing has been
 * built yet.
 *
 * Both `/portal/new` and the counsel-side create form now read their request
 * types from `firm_request_types` and render a published form where one
 * exists. Zero firms have published anything, so on the day this ships the
 * only visible change to anyone is whatever the seeded rows produce. That
 * makes the fallback the important half of this file, not an afterthought:
 *
 *   - no rows back from the table, for any reason at all (no service-role
 *     client, a failed query, a firm the backfill missed), falls back to
 *     `FALLBACK_REQUEST_TYPES`, which is the same twelve the migration seeds;
 *   - no published form for the selected type leaves the existing fixed
 *     fields exactly as they are.
 *
 * The logic lives here rather than in the component because this repo's test
 * environment is `node` with no DOM (see vitest.config.ts), so a module with
 * no React in it is testable today and a component is not. Every branch below
 * is one a firm feels on every request they file.
 */

import type { FormPayload } from './form-schema';
import { domId, formatAnswer } from './form-render-model';
import { computeVisibilityMap, validateAnswers, type Answers } from './form-validate';

export type IntakeMode = 'client' | 'inhouse';

/**
 * A request type as far as the picker is concerned. Structurally a subset of
 * `RequestType` in lib/form-queries.ts, so a row read from the table passes
 * straight in, but declared here so nothing on the client side has to import
 * from a `server-only` module.
 */
export type RequestTypeLike = {
  key: string;
  label: string;
  mode: IntakeMode;
  sortOrder: number;
  hidden: boolean;
};

/** One option in the picker. */
export type PickableType = {
  key: string;
  label: string;
  mode: IntakeMode;
};

/**
 * The twelve types this form hardcoded before the table existed, in the same
 * order, with the same modes. `label` is the string the old array called
 * `value`, because that is the string existing intakes store in `matter_type`
 * and the string the migration seeded, so the two paths agree.
 *
 * Keep this identical to the source-1 backfill in
 * supabase/migrations/20260801_intake_form_builder.sql. It is not a default to
 * be improved: its whole job is to be what the table already holds, so that a
 * firm whose read fails sees no difference.
 */
export const FALLBACK_REQUEST_TYPES: readonly RequestTypeLike[] = [
  { key: 'new_case_matter', label: 'New case / matter', mode: 'client', sortOrder: 0, hidden: false },
  { key: 'new_contract_agreement', label: 'New contract / agreement', mode: 'inhouse', sortOrder: 1, hidden: false },
  { key: 'internal_review_request', label: 'Internal review request', mode: 'inhouse', sortOrder: 2, hidden: false },
  { key: 'document_for_safekeeping', label: 'Document for safekeeping', mode: 'inhouse', sortOrder: 3, hidden: false },
  { key: 'trademark_ip_filing', label: 'Trademark / IP filing', mode: 'inhouse', sortOrder: 4, hidden: false },
  { key: 'nda_review', label: 'NDA review', mode: 'inhouse', sortOrder: 5, hidden: false },
  { key: 'vendor_msa_review', label: 'Vendor / MSA review', mode: 'inhouse', sortOrder: 6, hidden: false },
  { key: 'employment_matter', label: 'Employment matter', mode: 'inhouse', sortOrder: 7, hidden: false },
  { key: 'compliance_question', label: 'Compliance question', mode: 'inhouse', sortOrder: 8, hidden: false },
  { key: 'litigation_hold', label: 'Litigation hold', mode: 'inhouse', sortOrder: 9, hidden: false },
  { key: 'demand_letter', label: 'Demand letter', mode: 'inhouse', sortOrder: 10, hidden: false },
  { key: 'other', label: 'Other', mode: 'inhouse', sortOrder: 11, hidden: false },
];

function offer(types: readonly RequestTypeLike[], employeeMode: boolean): PickableType[] {
  return types
    .filter((t) => !t.hidden)
    // An employee never files an outside-client matter. This is the one
    // filter `mode` drove on this surface before the table existed, and it is
    // preserved exactly.
    .filter((t) => !employeeMode || t.mode === 'inhouse')
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((t) => ({ key: t.key, label: t.label, mode: t.mode }));
}

/**
 * The types to offer, in the order legal arranged them.
 *
 * Hidden types are withheld and the ordering is the table's `sort_order`, so
 * the seeded twelve stay first and a firm's partner slugs, seeded at 100 and
 * above, sort after them. Near duplicates are NOT merged: the migration left
 * `nda` and `nda_review` as two rows deliberately, because merging guesses at
 * intent and hiding one is a reversible click. Do not add merging here.
 *
 * Never returns an empty list. An empty picker is an employee who cannot
 * raise a legal problem at work, which is worse than offering the built-in
 * types, so an empty result falls back the same way an empty read does.
 */
export function pickableRequestTypes(
  types: readonly RequestTypeLike[] | null | undefined,
  employeeMode: boolean,
): PickableType[] {
  const offered = types && types.length > 0 ? offer(types, employeeMode) : [];
  if (offered.length > 0) return offered;
  return offer(FALLBACK_REQUEST_TYPES, employeeMode);
}

/**
 * Which flow a selected type puts the form into. Not cosmetic: `client` is an
 * outside-client matter, which captures the client's identity and contact
 * details for the conflict check, and `inhouse` is an internal request, which
 * captures who filed it and when it is due.
 *
 * Defaults to `client` for a key that is not in the list, which is what the
 * hardcoded lookup this replaces did.
 */
export function modeForType(types: readonly PickableType[], key: string): IntakeMode {
  return types.find((t) => t.key === key)?.mode ?? 'client';
}

/**
 * How two labels are compared: NFKC normalised, stripped of the characters
 * that render as nothing, then trimmed and case folded.
 *
 * Trim and lowercase alone are not enough. `trim` removes NBSP and U+FEFF but
 * not U+200B, and nothing about it reconciles a decomposed accent with a
 * precomposed one or a full-width letter with its plain form. All of those
 * render identically to a reader, so a matter type carrying one would look on
 * every screen exactly like the type it claims to be while matching no type at
 * all, which is the gate being dodged in the only way that still leaves the
 * intake looking legitimate.
 *
 * NFKC does not reconcile cross-script homoglyphs: a Cyrillic 'а' stays
 * distinct from a Latin 'a'. That residual is the same one as any other
 * deliberately mangled matter type, and it is bounded the same way, below.
 */
function foldLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * The request type a stored `matter_type` string was filed under, or null.
 *
 * `matter_type` holds the type's `label` verbatim, which is how the seeded
 * rows were backfilled and what both intake surfaces write. Resolving it back
 * is what stops a caller opting out of a published form by omitting the
 * request type key: the server can always work out which type an intake claims
 * to be from the string the intake itself carries.
 *
 * Compared through `foldLabel`, and nothing looser: a partial match would bind
 * an intake to a form it was not filed against.
 *
 * `preferKey` breaks a tie, and only a tie. A firm may rename two types to the
 * same wording, and the person who picked the second of them must have their
 * answers judged against the second one's form, not the first one's, or they
 * see errors they cannot clear or bind to a version they never saw. It cannot
 * override an unambiguous match, because that would hand the caller back the
 * ability to point the gate at a type with no form published.
 */
export function matchTypeKeyByLabel(
  types: readonly { key: string; label: string }[],
  label: string | null | undefined,
  preferKey?: string | null,
): string | null {
  const wanted = foldLabel(label ?? '');
  if (!wanted) return null;

  const matches = types.filter((t) => foldLabel(t.label) === wanted).map((t) => t.key);
  if (matches.length === 0) return null;

  const preferred = (preferKey ?? '').trim();
  if (matches.length > 1 && preferred && matches.includes(preferred)) return preferred;
  return matches[0];
}

/**
 * True while a type still carries the wording the migration seeded for it.
 *
 * The picker translates a seeded label, because it is Advottic's own copy and
 * a non-English employee should read it in their language, and renders a
 * firm-edited one raw, because that is the firm's own words and machine
 * translating user data is what `<T>` exists to avoid. The moment legal edits
 * a label, this goes false and stays false.
 */
export function isSeededLabel(type: { key: string; label: string }): boolean {
  return FALLBACK_REQUEST_TYPES.some(
    (seeded) => seeded.key === type.key && seeded.label === type.label,
  );
}

/**
 * The DOM id of the first question carrying an error, in document order, or
 * null.
 *
 * Errors arrive as an object keyed by question `key`, whose enumeration order
 * has nothing to do with the form's, so the form has to be walked. The caller
 * moves focus there on a failed submit: each message is bound to its input by
 * `aria-describedby`, so focusing the input is what reads the reason aloud.
 * Built with the same `domId` the renderer uses, or focus would land nowhere.
 */
export function firstErrorFieldId(
  payload: FormPayload,
  errors: Record<string, string>,
  idPrefix: string,
): string | null {
  for (const [rowIndex, row] of payload.rows.entries()) {
    for (const [fieldIndex, q] of row.fields.entries()) {
      if (errors[q.key]) return domId(idPrefix, q.key, rowIndex, fieldIndex);
    }
  }
  return null;
}

/** Longest single answer stored. Well above the validator's own ceilings. */
const MAX_ANSWER_CHARS = 20000;
const MAX_ANSWER_VALUES = 100;
const MAX_ANSWERS = 200;

/**
 * Answers as they arrive at a server action: an unknown value off the wire.
 * Anything that is not a string or an array of strings is dropped rather than
 * coerced, so a caller cannot smuggle an object into a stored answer, and
 * every value is capped so a single request cannot write an unbounded row.
 */
export function readAnswers(raw: unknown): Answers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const answers: Answers = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_ANSWERS) break;
    if (typeof value === 'string') {
      answers[key] = value.slice(0, MAX_ANSWER_CHARS);
    } else if (Array.isArray(value)) {
      answers[key] = value
        .filter((v): v is string => typeof v === 'string')
        .slice(0, MAX_ANSWER_VALUES)
        .map((v) => v.slice(0, MAX_ANSWER_CHARS));
    } else {
      continue;
    }
    count += 1;
  }
  return answers;
}

/**
 * The answers to a built form in the shape intakes have always stored them,
 * `{id, label, value}`, with the label snapshotted next to the answer.
 *
 * That snapshot is why renaming a question later cannot mislabel a historical
 * request, and it is why losing the version binding degrades an old intake to
 * today's behaviour rather than to nothing. The counsel intake page reads this
 * array and nothing else, so the shape is fixed.
 *
 * A question the employee never saw is left out entirely, including any stale
 * answer still sitting under its key from before the controlling answer was
 * flipped back. So is a question they saw and left blank: the counsel page
 * drops an empty value anyway, and writing it would only pad the record.
 */
export type QuestionAnswer = { id: string; label: string; value: string };

export type FormBinding =
  | { ok: true; questionAnswers: QuestionAnswer[]; formVersionId: string | null }
  | { ok: false; errors: Record<string, string> };

/**
 * The whole published-versus-not decision in one place: what a submitted
 * intake carries once the form it was filed on has been resolved.
 *
 * `form` null is the path every firm is on today, and it must add nothing at
 * all. No answers, no version binding, so the row written is the row this
 * surface has always written.
 *
 * `form` present validates against THAT payload, not against anything the
 * caller sent. The answers arrive as `unknown` because on the server they come
 * straight off the wire.
 */
export function bindFormAnswers(
  form: { payload: FormPayload; versionId: string } | null,
  rawAnswers: unknown,
): FormBinding {
  if (!form) return { ok: true, questionAnswers: [], formVersionId: null };

  const answers = readAnswers(rawAnswers);
  const checked = validateAnswers(form.payload, answers);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  return {
    ok: true,
    questionAnswers: buildQuestionAnswers(form.payload, answers),
    formVersionId: form.versionId,
  };
}

export function buildQuestionAnswers(
  payload: FormPayload,
  answers: Answers,
): QuestionAnswer[] {
  const visible = computeVisibilityMap(payload, answers);
  const list: QuestionAnswer[] = [];

  for (const row of payload.rows) {
    for (const q of row.fields) {
      if (!visible.get(q.id)) continue;
      const value = formatAnswer(q, answers[q.key]).trim();
      if (!value) continue;
      list.push({ id: q.id, label: q.label, value });
    }
  }

  return list;
}
