import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplateField } from './firm-templates';
import {
  counterpartyFieldsOnDocument,
  parseTemplateFields,
  sanitizeCounterpartyValues,
  type CounterpartyValues,
} from './counterparty-fields';
import { parseFieldBoxes, type FieldBox } from './template-field-boxes';

/**
 * What this signing request asks the counterparty to fill in, and where those
 * blanks are on the document.
 *
 * Not a server action. Nothing here is an HTTP endpoint, for the same reason
 * lib/submission-document.ts is not: the only callers are the signing page,
 * which has already resolved the token, and the action beside it, which does
 * the same.
 *
 * THE LOOKUP RUNS BACKWARDS, as lib/submission-completion.ts explains at
 * length: the pointer lives on the submission so that firm_signing_requests
 * stays a generic row that knows nothing about templates, and
 * 20260807_flow_join.sql pays for the direction with a partial index.
 *
 * WHAT AN UNAPPLIED MIGRATION DOES: nothing. PostgREST refuses the whole
 * statement when a filter or a select names a column the table does not have,
 * so a firm without the migration gets an error here and this returns null,
 * which reads as "this request asks the signer for nothing" and is exactly
 * the behaviour the product had last week. It must stay that way: this runs
 * on the signing path, and a firm that has not migrated must not have a
 * signature blocked because of it.
 *
 * WHY THE FIELD DEFINITIONS COME FROM THE TEMPLATE BUT THE AUTHORIZATION
 * COMES FROM THE BOXES. The template is read for labels, types and whether an
 * answer is required, all of which are how the question is ASKED. What may be
 * ANSWERED is the set of blanks the renderer actually drew on the approved
 * document, because a value with nowhere to go on the page would be a
 * recorded fact the instrument does not carry. A template edited between the
 * render and the signature therefore changes the wording of a question, never
 * the set of them.
 */

export type CounterpartyIntake = {
  submissionId: string;
  /** Where every blank is. Read by the live overlay and by the stamp. */
  boxes: FieldBox[];
  /** The counterparty fields this document actually carries blanks for.
   *  Possibly empty when the template can no longer be read: the blanks are
   *  still on the document and still have to be filled in on the executed
   *  copy, they simply cannot be labelled or typed any more. */
  fields: TemplateField[];
};

/**
 * The blanks and, where the template can still be read, the questions.
 *
 * The stamp uses this. It needs the boxes whatever became of the template,
 * because a document that went out with blanks in it has to come back with
 * those blanks filled; the field definitions are only used to know that a
 * date is a date, and a stamp that loses that formats the value the way the
 * signer typed it, which is a worse-looking instrument rather than a wrong
 * one.
 */
export async function loadCounterpartyStamp(
  admin: SupabaseClient,
  signingRequestId: string,
): Promise<CounterpartyIntake | null> {
  if (!signingRequestId) return null;
  const { data, error } = await admin
    .from('firm_template_submissions')
    .select('id, firm_id, template_id, field_boxes')
    .eq('signing_request_id', signingRequestId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    firm_id: string;
    template_id: string | null;
    field_boxes?: unknown;
  };

  const boxes = parseFieldBoxes(row.field_boxes);
  // No blanks means nothing to ask and nothing to stamp, which is every
  // document this product has produced so far and every document under a
  // template whose fields are all the employee's.
  if (boxes.length === 0) return null;

  let fields: TemplateField[] = [];
  if (row.template_id) {
    // Read by id and firm, NOT through loadPublishedTemplate. That helper
    // requires status 'published', and a template archived or unpublished
    // while its document sat out for signature would strand a counterparty in
    // front of a document full of blanks with no labels on them. The document
    // is already approved and already out; the template is consulted only to
    // name the questions it asks.
    const { data: templateData } = await admin
      .from('firm_templates')
      .select('fields')
      .eq('id', row.template_id)
      .eq('firm_id', row.firm_id)
      .maybeSingle();
    if (templateData) {
      fields = counterpartyFieldsOnDocument(
        parseTemplateFields((templateData as { fields?: unknown }).fields),
        boxes,
      );
    }
  }
  return { submissionId: row.id, boxes, fields };
}

/**
 * The same, for the surface that has to ASK the questions.
 *
 * Null when there is nothing answerable, because a form with blanks it cannot
 * label is not a form: the signer would be asked to type into boxes with no
 * names on them.
 */
export async function loadCounterpartyIntake(
  admin: SupabaseClient,
  signingRequestId: string,
): Promise<CounterpartyIntake | null> {
  const intake = await loadCounterpartyStamp(admin, signingRequestId);
  if (!intake || intake.fields.length === 0) return null;
  return intake;
}

/**
 * What this signer has already typed, read back and re-sanitized.
 *
 * Re-sanitized rather than trusted, because the column is jsonb and what is
 * in it is whatever was written by whichever version of this code wrote it.
 * The signer coming back to a half-filled link is the ordinary case: they
 * open it, start typing, and finish on their phone.
 *
 * An error, including the column not existing yet, reads as "nothing typed",
 * which is the state a signer who has typed nothing is in and is safe: the
 * form opens empty and the values they submit are written or refused on their
 * own merits.
 */
export async function loadStoredCounterpartyValues(
  admin: SupabaseClient,
  signatureId: string,
  fields: readonly TemplateField[],
): Promise<CounterpartyValues> {
  const { data, error } = await admin
    .from('firm_signatures')
    .select('counterparty_values')
    .eq('id', signatureId)
    .maybeSingle();
  if (error || !data) return {};
  return sanitizeCounterpartyValues(
    fields,
    (data as { counterparty_values?: unknown }).counterparty_values,
  );
}
