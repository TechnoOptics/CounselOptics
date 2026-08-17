/**
 * Finding the firm's own standard document at the moment a request is filed,
 * as pure rules.
 *
 * A firm that has written its own NDA does not want an employee attaching a
 * counterparty's, and today the only way to know one exists is to already know
 * it exists. So the intake form offers a search over what the legal team has
 * prepared, and the id and name of whatever is chosen ride in the existing
 * `intake_answers` jsonb. No column, no migration: the same deliberate design
 * the rest of the in-house fields on that form use.
 *
 * WHAT THIS MODULE IS NOT. It is not a route into the template library. The
 * employee never uploads anything here and nothing on this path reaches
 * importTemplateDocumentAction, which is gated to FIRM_TEMPLATE_AUTHOR_ROLES
 * and feeds a document to a model instructed to rewrite its blanks into
 * placeholders and strip its ruled signature lines. Running a counterparty's
 * contract through that would rewrite their instrument. An employee attaches
 * their document to the request, which is what the attachment field already
 * does.
 *
 * The search is the shape lib/approval-queue.ts `matchesQuery` already uses on
 * this codebase's other client-side search: one needle, lower-cased once,
 * tested against the fields actually printed on the row. It is not reused
 * directly because that one is typed to ApprovalRow and reads a ticket
 * reference and two sets of names that a template does not have.
 */

import type { DeliveryMode } from './submission-dispatch';

/**
 * The little of a firm template this picker needs.
 *
 * A narrow shape rather than FirmTemplate so the pure rules can be tested with
 * a plain object, and so nothing here can start depending on a template's body
 * or its fields, neither of which the person filing a request should be
 * reading.
 */
export type PickableTemplate = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  deliveryMode: DeliveryMode;
};

/**
 * The request types where a standard document is not the question.
 *
 * An outside-client matter is the legal team opening a case, not asking for
 * paperwork, and a compliance question is a question. Everything else the form
 * offers could plausibly have a template behind it, so the step is offered.
 *
 * Spelled as the exclusions rather than the inclusions on purpose: these
 * strings are written verbatim to `matter_type`, and a list of the types that
 * DO qualify would silently drop the step from any type added later, which is
 * the failure nobody notices. An unrecognised type shows the step, and the
 * step's own empty branch already routes a person to the attachment field.
 */
const TYPES_WITHOUT_A_STANDARD_DOCUMENT: readonly string[] = [
  'New case / matter',
  'Compliance question',
];

/** Whether the chosen request type could plausibly involve a document. */
export function requestTypeInvolvesDocument(requestType: unknown): boolean {
  if (typeof requestType !== 'string') return false;
  const value = requestType.trim();
  if (!value) return false;
  return !TYPES_WITHOUT_A_STANDARD_DOCUMENT.includes(value);
}

/**
 * What the search box matches: the three things a result actually prints.
 *
 * Never the body. A template's wording is the legal team's work product, and a
 * search that reached into it would let a person filing a request find a
 * document by a clause they were never shown.
 */
export function matchesTemplateQuery(t: PickableTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [t.name, t.description, t.category].some((v) =>
    (v ?? '').toLowerCase().includes(needle),
  );
}

/** The results for a query, in the order they arrived. */
export function filterTemplates(
  rows: readonly PickableTemplate[],
  q: string,
): PickableTemplate[] {
  return rows.filter((t) => matchesTemplateQuery(t, q));
}

/**
 * How output from this template reaches the other side, in the words the
 * person filing the request would use. `share` is what a template does when
 * nothing was chosen, so this never reads as a claim the firm did not make.
 */
export function deliveryModeLabel(mode: DeliveryMode): string {
  return mode === 'signature' ? 'Sent for signature' : 'Sent as a share';
}

/** The step's heading. */
export const TEMPLATE_STEP_QUESTION = 'Is there a standard document for this?';

/** What sits under the heading. */
export const TEMPLATE_STEP_HELP =
  'Search what your legal team has prepared. If nothing fits, attach what you have and legal will work from that.';

/**
 * The end of the search that found nothing.
 *
 * It names the next thing to do rather than stopping, because a person who
 * searched and found nothing still has a request to file and a document in
 * their hand.
 */
export const TEMPLATE_STEP_EMPTY =
  'Nothing matched that. Attach the document you have below and your legal team will take it from there.';

/** Where the choice is stored on `intake_answers`. Named once. */
export const TEMPLATE_ID_KEY = 'template_id';
export const TEMPLATE_NAME_KEY = 'template_name';
