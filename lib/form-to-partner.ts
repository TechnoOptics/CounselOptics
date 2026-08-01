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

function projectType(type: QuestionType): PartnerQuestion['type'] {
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
