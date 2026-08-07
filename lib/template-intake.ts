import 'server-only';

import { bellaGenerate } from './bella';
import { parseTemplateProposal, type TemplateProposal } from './template-proposal';

/**
 * Ask Bella to read a document the legal team already has and propose the
 * template it would become.
 *
 * Server-only, because it spends the firm's AI budget. The judgement about
 * what the answer is allowed to say lives next door in lib/template-proposal.ts,
 * which is pure and tested; this file only asks the question and hands the
 * reply over to be checked. Nothing here saves a template, and nothing here
 * returns raw model output to a caller.
 */

/**
 * How much of the document is sent.
 *
 * Past this the text is cut and the model is told, in the prompt, that it was
 * cut. That is the honest failure: the proposal then covers the opening of the
 * document and the reviewer sees the rest is missing, which is recoverable.
 * Silently truncating would produce a template that looks complete and is not.
 *
 * 60k characters is roughly 25 pages of an agreement, which covers every firm
 * template in the product today, and sits inside the model's context alongside
 * a reply that has to restate the whole body.
 */
export const MAX_TEMPLATE_INTAKE_CHARS = 60000;

/** Below this there is nothing worth a model call. */
const MIN_TEMPLATE_INTAKE_CHARS = 40;

const SYSTEM = [
  'You are a careful legal-operations assistant preparing a reusable document',
  'template for an in-house legal team.',
  '',
  'You are given the text of a document the team already uses. Return the same',
  'document with its blanks turned into placeholders, so it can be filled in',
  'again and again.',
  '',
  'Return ONLY a JSON object and nothing else. No commentary, no explanation',
  'outside the JSON. The shape is exactly:',
  '{"body": string, "fields": [{"key": string, "label": string, "type": "text"|"date"|"textarea", "required": boolean, "party": "employee"|"counterparty"}], "notes": [string]}',
  '',
  'Rules:',
  '1. Keep the document\'s own wording exactly as it is. You are not redrafting',
  '   it. Change only the blanks: a ruled line, a bracketed prompt such as',
  '   [Insert name], a run of dots, or a value that plainly differs for each',
  '   use, such as a party name, a date, an amount or an address.',
  '2. Replace each blank with a {{snake_case}} placeholder. Keys use lowercase',
  '   letters, digits and underscores only. Use the same key everywhere the',
  '   same value belongs, so it is filled in once.',
  '3. Every key in "fields" must appear as {{key}} in "body". Do not list a',
  '   field you did not place.',
  '4. Choose "date" for a date, "textarea" for an answer that runs to several',
  '   lines such as a description of services, and "text" for everything else.',
  '5. Set "party" to "employee" for a blank the person sending the document',
  '   fills in, and "counterparty" for one the outside party fills in when they',
  '   receive it. If you are unsure, leave "party" out.',
  '6. THE PLATFORM ADDS THE EXECUTION BLOCK ITSELF. When a document goes out',
  '   for signature it is given a signature line and a date line for EVERY',
  '   party, automatically. So the proposal must not carry its own. Do not',
  '   create a placeholder or a field for a signature, for initials, or for the',
  '   date a party signs. Remove the ruled lines the source uses for signing,',
  '   such as "By: ______" and "Signature: ______", leaving the words and',
  '   taking out the rule. Anything you leave behind becomes a second place to',
  '   sign, or a second date, on a document that already has one of each.',
  '7. When you find signing furniture of any kind, that is how you report that',
  '   the document needs signing: say so plainly in "notes".',
  '8. {{firm_name}} and {{company_name}} are reserved. They fill themselves in',
  '   with OUR OWN firm name. Never use either for the other party, however the',
  '   source labels them. Name the other side {{counterparty_name}} or',
  '   something equally clear.',
  '9. Never invent a clause, a party or an obligation that is not in the text',
  '   you were given.',
  '10. Page numbers and repeated running headers left behind by the PDF reader',
  '    are not part of the document\'s wording. Leave them out of "body".',
  '11. Use "notes" for short, plain sentences about anything a reviewer should',
  '    look at: a blank you were unsure about, a passage that seemed to be',
  '    missing, or a value you left as fixed text on purpose.',
].join('\n');

/**
 * Propose a template from extracted document text.
 *
 * Returns null when there is nothing usable: too little text, or a reply that
 * survives none of the checks in parseTemplateProposal. The caller tells the
 * reviewer to write the template by hand, which is what they did before this
 * existed, so a null costs them nothing they had.
 *
 * AiUnavailableError is deliberately NOT caught here. It carries the calm,
 * branded wording the product shows when the model is out of budget or
 * unreachable, and swallowing it here would turn "the assistant is
 * unavailable, try again shortly" into "we found nothing in your document",
 * which sends the reviewer looking for a fault in their own file. The server
 * action above catches it and surfaces its message.
 */
export async function proposeTemplateFromText(text: string): Promise<TemplateProposal | null> {
  const source = String(text ?? '').trim();
  if (source.length < MIN_TEMPLATE_INTAKE_CHARS) return null;

  const truncated = source.length > MAX_TEMPLATE_INTAKE_CHARS;
  const body = source.slice(0, MAX_TEMPLATE_INTAKE_CHARS);
  const prompt = [
    'DOCUMENT TEXT:',
    body,
    '',
    truncated
      ? 'This document was longer than could be read in one pass and the text ' +
        'above stops part way through. Propose a template for the part you can ' +
        'see, and say in "notes" that the document was cut short and the rest ' +
        'has to be added by hand.'
      : '',
    'Return the JSON now.',
  ]
    .filter(Boolean)
    .join('\n');

  // maxTokens has to carry the whole body back, not just the field list, so it
  // is generous. A reply cut off mid-body is unparseable JSON, which
  // parseTemplateProposal reports as null.
  const raw = await bellaGenerate({ system: SYSTEM, prompt, maxTokens: 8000 });
  // The source goes in alongside the reply. Rule 6 above is advice and a model
  // can decline it silently: on a real mutual NDA it dropped no execution page
  // but reported no signature either. The source is the unedited account of
  // what the document contains, so signature detection reads it as well as the
  // reply rather than trusting what the model chose to emit.
  return parseTemplateProposal(raw, body);
}
