/**
 * What a ticket's analysis is allowed to read.
 *
 * The in-house counsel ticket used to embed AnalyzeStudio, a textarea and a
 * local file reader posting their contents to /api/counsel/analyze as a `text`
 * field. That endpoint accepted the text and nothing else: no intake id and no
 * document id, so there was nothing to authorize and no ownership check
 * existed or could exist. Counsel could analyse anything at all, and the
 * firm's tokens paid for it.
 *
 * The owner's instruction is that the analysis runs on the documents submitted
 * with the ticket and on nothing counsel supplies. So the target is derived
 * from the ticket row on the server, and the caller is given no parameter that
 * could name a document.
 *
 * This module holds the one decision that makes that true, kept apart from the
 * route so it can be tested directly rather than inferred from a query.
 */

/** The columns of `firm_documents` this decision needs. */
export type TicketDocumentRow = {
  id: string;
  firm_id: string;
  intake_id: string | null;
  name: string;
  file_path: string;
  mime_type: string | null;
  archived_at?: string | null;
};

/**
 * The attachments of one ticket, and nothing else.
 *
 * Both ids are compared here even though the query that feeds this is already
 * scoped. The listing the ticket page renders
 * (loadIntakeConversationAction) filters on `intake_id` alone, which is safe
 * there only because the intake row was authorized first; repeating that
 * shape in a path that spends money would make the money safe only by
 * inheritance. Comparing the firm as well costs one predicate and removes the
 * dependency.
 *
 * Archived attachments are excluded because the ticket does not show them, and
 * an analysis reading a file the reader cannot see is an analysis nobody can
 * check.
 */
export function selectTicketAnalysisDocuments(
  rows: readonly TicketDocumentRow[],
  scope: { intakeId: string; firmId: string },
): TicketDocumentRow[] {
  return rows.filter(
    (row) =>
      row.intake_id === scope.intakeId &&
      row.firm_id === scope.firmId &&
      !row.archived_at,
  );
}

/**
 * Why the analysis could not run.
 *
 * `NO_DOCUMENT` is a refusal and not an error: a ticket with no attachment has
 * nothing to analyse, and the UI hides the control in that case, so reaching
 * it means the request did not come from the UI.
 */
export const NO_DOCUMENT = 'NO_DOCUMENT';
