/**
 * Projects a built intake form down to the question format the shipped
 * partner employee app already understands.
 *
 * The partner app fetches its questions from GET /api/partner/v1/config and
 * parses exactly three types: text, select, yesno (see PartnerQuestion in
 * lib/partner-config-core.ts). It cannot evaluate showWhen rules and it
 * cannot be changed, so every question our builder can produce has to land
 * on one of those three, and conditional questions have to be flattened
 * into something it can render unconditionally.
 *
 * Two things this module deliberately does NOT do:
 *   - Preserve maxWords, min, max, currency: the partner format has no slot
 *     for them. That is expected; Task 9 enforces those constraints
 *     server-side when the ticket arrives.
 *   - Require a conditional question, even if the form marks it required.
 *     The partner app would otherwise block an employee on a question that
 *     may not even apply to them. Real requiredness for those is enforced
 *     on our side once the answers arrive.
 */

import type { FormPayload, Question, QuestionType } from './form-schema';
import type { PartnerQuestion } from './partner-config-core';
import { buildQuestionAnswers, readAnswers, type QuestionAnswer } from './intake-form-fallback';
import { validateAnswers, type Answers } from './form-validate';

/**
 * Exported because the builder warns legal which of their question types an
 * older partner app cannot render, and how each one degrades. That warning has
 * to be derived from this mapping rather than from a second copy of it, or the
 * warning and the projection drift and legal is told the wrong thing.
 */
export function projectType(type: QuestionType): PartnerQuestion['type'] {
  switch (type) {
    case 'yesno':
      return 'yesno';
    case 'select':
    case 'multiselect':
      return 'select';
    default:
      return 'text';
  }
}

function projectQuestion(question: Question): PartnerQuestion {
  const partnerType = projectType(question.type);
  const partner: PartnerQuestion = {
    id: question.key,
    label: question.label,
    type: partnerType,
    // Conditional questions are emitted unconditionally and never required:
    // the partner app cannot evaluate showWhen, so it must always show the
    // question, and it cannot gate the employee on an answer that may not
    // apply to them.
    required: question.showWhen ? false : question.required,
  };
  if (partnerType === 'select' && question.config.options) {
    partner.options = question.config.options;
  }
  return partner;
}

export function projectToPartnerQuestions(payload: FormPayload): PartnerQuestion[] {
  return payload.rows.flatMap((row) => row.fields.map(projectQuestion));
}

// ---------------------------------------------------------------------------
// Arrival: the other half of the projection.
//
// Everything above is what we SEND the partner app. Everything below is what
// happens when a ticket comes back, and it is written around one fact: the
// shipped app on the other end cannot be changed, redeployed, or inspected.
// So the rules below are deliberately conservative about when a built form is
// allowed to judge a ticket at all.
//
// The three decisions, and why:
//
// 1. A value that breaks a constraint the projection could not carry
//    (currency decimals, a number or date range, a max length, an email or
//    phone shape) is REJECTED, with an error naming the question. The value
//    was sent, so it can be checked; the message says exactly what to change;
//    the employee can retype it; and this endpoint already answers 400 with a
//    named question for a missing required answer, so the partner app already
//    has a place to show it. Accepting instead would mean the rule the legal
//    team published is decorative, and would file an answer their own intake
//    surfaces would have refused, with nothing on the record to say so.
//
// 2. Requiredness IS enforced, including for a conditional question the
//    projection advertised as `required: false`. That is safe only because of
//    rule 3: a form judges a ticket only when the ticket shows it has the
//    form, and the projection emits every question unconditionally, so the
//    controller of any conditional question is always on screen and the
//    employee can always clear the error. A conditional question whose
//    controller is missing from the submitted answers is not visible, so
//    `validateAnswers` skips it entirely and it is never required.
//
// 3. A published form governs a ticket ONLY when the ticket carries evidence
//    that the partner fetched it: it echoes the currently published
//    `formVersionId`, or at least one answer is keyed to one of the form's
//    question keys. Without that evidence the ticket was composed against the
//    firm-wide `partnerIntegration.questions` list, and judging it against a
//    form it was never served would reject or silently discard answers for a
//    reason no one on the other end could diagnose.
//
//    The cost of 3 is stated plainly rather than engineered away: until the
//    partner app is updated to fetch GET /config?type=<slug>, publishing a
//    form does not change what its employees are asked, and nobody is told.
//    The intake still records `partner.formVersionSource: 'inferred'`, which
//    is where that answer lives when someone asks why.
// ---------------------------------------------------------------------------

export type PartnerFormBinding = {
  payload: FormPayload;
  /** ALWAYS the version we read for this firm and request type, never one the
   *  ticket supplied. A version id arriving from outside is only ever compared
   *  against this, never looked up, so a stale id, another firm's id or
   *  another request type's id cannot bind anything. */
  versionId: string;
  /** 'echoed' means the ticket named this exact version. 'inferred' means we
   *  bound it to whatever was live on arrival; with `governs` false it also
   *  means the answers were NOT judged against it. */
  source: 'echoed' | 'inferred';
  governs: boolean;
};

function submittedKeys(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>);
}

function formKeys(payload: FormPayload): Set<string> {
  const keys = new Set<string>();
  for (const row of payload.rows) {
    for (const q of row.fields) keys.add(q.key);
  }
  return keys;
}

/**
 * Whether a published form applies to an arriving ticket, and on what basis.
 * Null means no form is published for the ticket's request type, which is the
 * path every firm is on today and must stay unchanged.
 */
export function partnerFormBinding(
  published: { payload: FormPayload; versionId: string } | null | undefined,
  echoedVersionId: unknown,
  rawAnswers: unknown,
): PartnerFormBinding | null {
  if (!published) return null;

  const echoed =
    typeof echoedVersionId === 'string' && echoedVersionId.trim() === published.versionId;
  const keys = formKeys(published.payload);
  const answersUseForm = submittedKeys(rawAnswers).some((k) => keys.has(k));

  return {
    payload: published.payload,
    versionId: published.versionId,
    source: echoed ? 'echoed' : 'inferred',
    governs: echoed || answersUseForm,
  };
}

function isMissing(value: Answers[string] | undefined): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) ? value.length === 0 : value === '';
}

/**
 * Validate an arriving ticket's answers against the real payload and return
 * them in the `{id, label, value}` shape every intake stores.
 *
 * The error is one sentence a developer on the other end can act on without
 * our source: it names the question as the employee sees it, gives the
 * question id they sent it under (which is the id GET /config returned), and
 * states what to change. Only the first failure in document order is spelled
 * out, matching what this endpoint has always done for a missing required
 * answer; the rest are counted so nobody fixes one and is surprised.
 */
export function bindPartnerFormAnswers(
  form: { payload: FormPayload; versionId: string },
  rawAnswers: unknown,
): { ok: true; list: QuestionAnswer[] } | { ok: false; error: string } {
  const answers = readAnswers(rawAnswers);
  const checked = validateAnswers(form.payload, answers);
  if (checked.ok) return { ok: true, list: buildQuestionAnswers(form.payload, answers) };

  const problems: string[] = [];
  for (const row of form.payload.rows) {
    for (const q of row.fields) {
      const message = checked.errors[q.key];
      if (!message) continue;
      problems.push(
        isMissing(answers[q.key])
          ? `Missing required answer: "${q.label}" (question id ${q.key}).`
          : `Answer for "${q.label}" (question id ${q.key}) is not valid: ${message}`,
      );
    }
  }
  if (problems.length === 0) return { ok: true, list: buildQuestionAnswers(form.payload, answers) };

  const rest = problems.length - 1;
  const tail =
    rest === 0
      ? ''
      : rest === 1
        ? ' One other answer also needs attention.'
        : ` ${rest} other answers also need attention.`;
  return { ok: false, error: `${problems[0]}${tail}` };
}
