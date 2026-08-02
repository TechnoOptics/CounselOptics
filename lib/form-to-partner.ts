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
import { isAnswered, validateAnswers } from './form-validate';

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
//    What IS recorded is `partner.formGoverned`, written from `governs` on
//    every ticket that reaches a published form. That boolean, not
//    `formVersionSource`, is the one an intake with no answers has to be read
//    against: three different outcomes reach `formVersionSource: 'inferred'`
//    and only `formGoverned` separates them.
//
// 4. A ticket that SUPPLIES a `formVersionId` which does not match is a 400,
//    not a downgrade. Rules 1 to 3 keep a client that never opted in from
//    seeing new errors; they do not, on their own, keep an opted-in client
//    from having its answers quietly discarded when a form is rebuilt with
//    new keys or the slug is wrong, because those answers then match no
//    question in either set. A client that sends the field has told us it
//    knows about versions, so it gets an error naming what to re-fetch
//    instead of a ticket with nothing on it. The shipped app does not send
//    the field, so this can never fire for it.
// ---------------------------------------------------------------------------

export type PartnerFormBinding = {
  payload: FormPayload;
  /** ALWAYS the version we read for this firm and request type, never one the
   *  ticket supplied. A version id arriving from outside is only ever compared
   *  against this, never looked up, so a stale id, another firm's id or
   *  another request type's id cannot bind anything. */
  versionId: string;
  /** How `versionId` was arrived at, and nothing more. 'echoed' means the
   *  ticket named this exact version; 'inferred' means we bound it to
   *  whatever was live on arrival. It does NOT say whether the form was
   *  applied: read `governs` for that. */
  source: 'echoed' | 'inferred';
  /** Whether the form actually judged this ticket's answers. False means the
   *  answers were checked against the firm-wide partner questions instead, so
   *  `versionId` records only what was live at the time. */
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
 *
 * `legacyQuestionIds` are the ids of the firm-wide
 * `partnerIntegration.questions`. An answer id that appears in BOTH sets is no
 * evidence of anything, because a ticket built from the firm-wide list would
 * carry it either way, so it is excluded rather than allowed to route a
 * legacy-only ticket onto the form path and discard its other answers.
 */
export function partnerFormBinding(
  published: { payload: FormPayload; versionId: string } | null | undefined,
  echoedVersionId: unknown,
  rawAnswers: unknown,
  legacyQuestionIds: readonly string[],
): PartnerFormBinding | null {
  if (!published) return null;

  const echoed =
    typeof echoedVersionId === 'string' && echoedVersionId.trim() === published.versionId;
  const keys = formKeys(published.payload);
  const legacy = new Set(legacyQuestionIds);
  const answersUseForm = submittedKeys(rawAnswers).some((k) => keys.has(k) && !legacy.has(k));

  return {
    payload: published.payload,
    versionId: published.versionId,
    source: echoed ? 'echoed' : 'inferred',
    governs: echoed || answersUseForm,
  };
}

/**
 * The error to return when a ticket supplied a `formVersionId` that did not
 * bind, or null when there is nothing to say.
 *
 * Separate from `partnerFormBinding` because it is a decision about the
 * CALLER, not about the form: a client that sends the field has opted in to
 * versioning, so a mismatch is worth an error, while a client that omits it is
 * left exactly as it is today. Both messages name the fetch that fixes it, so
 * a developer on the other end can act without our source.
 */
export function partnerFormVersionMismatch(
  binding: PartnerFormBinding | null,
  echoedVersionId: unknown,
  typeKey: string,
): string | null {
  const claimed = typeof echoedVersionId === 'string' ? echoedVersionId.trim() : '';
  if (!claimed) return null;
  if (binding?.source === 'echoed') return null;

  if (!typeKey) {
    return (
      'This ticket sent a formVersionId but no category, so there is no request ' +
      'type to match it against. Send the request type slug as "category", then ' +
      'fetch GET /api/partner/v1/config?type=<slug> and resend the answers with ' +
      'the formVersionId it returns.'
    );
  }
  if (!binding) {
    return (
      `No intake form is published for category "${typeKey}", so the ` +
      'formVersionId sent cannot apply. Check the request type slug, then fetch ' +
      `GET /api/partner/v1/config?type=${typeKey} and resend the answers with ` +
      'the formVersionId it returns.'
    );
  }
  return (
    `The formVersionId sent is not the version currently published for category ` +
    `"${typeKey}". Fetch GET /api/partner/v1/config?type=${typeKey} and resend ` +
    'the answers with the formVersionId it returns.'
  );
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
        isAnswered(answers[q.key])
          ? `Answer for "${q.label}" (question id ${q.key}) is not valid: ${message}`
          : `Missing required answer: "${q.label}" (question id ${q.key}).`,
      );
    }
  }
  // Defensive: validation failed but no error mapped onto a question, which
  // nothing can currently produce. Still a refusal, because "the check failed,
  // therefore accept" is the wrong way for this to break if it ever can.
  if (problems.length === 0) {
    return {
      ok: false,
      error:
        'Some answers could not be accepted. Fetch the current questions from ' +
        'GET /api/partner/v1/config and resend them.',
    };
  }

  const rest = problems.length - 1;
  const tail =
    rest === 0
      ? ''
      : rest === 1
        ? ' One other answer also needs attention.'
        : ` ${rest} other answers also need attention.`;
  return { ok: false, error: `${problems[0]}${tail}` };
}
