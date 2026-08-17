/**
 * Whether a document on a ticket can be sent for signature from the ticket,
 * and what to say when it cannot.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT AN INLINE COMPARISON IN THE PANEL.
 *
 * The two kinds of file on a ticket look identical in the documents list and
 * are not the same thing at all:
 *
 *   origin 'chat'  a file shared in the conversation. lib/intake-conversation.ts
 *                  inserts it into `firm_documents` with the ticket's
 *                  `intake_id`, so it has a real row id and
 *                  createSigningRequestAction can resolve, authorize, download
 *                  and hash it.
 *
 *   origin 'filed' a file attached when the request was first submitted. It
 *                  lives on `intake_answers.attachments` and has NO
 *                  `firm_documents` row. The id the panel holds for it is the
 *                  synthetic `filed:<path>` string that same module makes up so
 *                  React has a key. Handing that to a signing request would
 *                  fail at the first lookup.
 *
 *   origin 'requested' is declared on the type and nothing produces it today.
 *                  It is treated as not sendable rather than as an oversight,
 *                  because a control that appears on a shape nobody has tested
 *                  is a control that fails in front of a lawyer.
 *
 * So the rule is an allowlist of one, not a denylist. It matches the gate
 * app/counsel/intake/[id]/page.tsx already applies to the AI analysis for the
 * same reason, and it lives here so it can be tested: vitest runs in
 * environment 'node' with no DOM, so a decision left inside JSX is a decision
 * no test can reach.
 */

import type { IntakeDocument } from './intake-conversation-types';

/**
 * What the panel says under a file that came in with the original request.
 *
 * Addressed to a colleague and short. It states the fact and the way round it
 * rather than apologising, because the way round it is one action the reader
 * can take: re-share the file in the conversation and it is filed as a real
 * document on the way through.
 */
export const FILED_ATTACHMENT_SEND_NOTE =
  'Came in with the request, so there is no document record to send yet. Share it in the conversation to send it for signature.';

/** What the control is called, in one place, so the guard and the UI agree. */
export const SEND_FOR_SIGNATURE_LABEL = 'Send for signature';

export type TicketDocumentSendState =
  | { canSend: true; documentId: string }
  | { canSend: false; note: string };

/**
 * The decision, for one document in a ticket's documents list.
 *
 * Takes the fields it reads rather than the whole row so a caller cannot pass
 * something that merely looks like a document.
 */
export function ticketDocumentSendState(
  doc: Pick<IntakeDocument, 'id' | 'origin'>,
): TicketDocumentSendState {
  if (doc.origin === 'chat') return { canSend: true, documentId: doc.id };
  return { canSend: false, note: FILED_ATTACHMENT_SEND_NOTE };
}
