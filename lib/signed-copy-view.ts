/**
 * What an employee is shown of the document they signed, and what to say when
 * the letterheaded version of it cannot be drawn.
 *
 * WHY THIS IS A MODULE. Both decisions belong to a React surface that this
 * repo cannot render in a test: vitest runs in the node environment here and
 * jsdom is deliberately absent. Pulling the two decisions out means the rules
 * are exercised for real even though the markup around them is not.
 *
 * THE DEFECT THIS EXISTS FOR. The employee's own record of a filed document
 * rendered the reflowed plain text with no mark, so the one person who is
 * always entitled to their own copy was the only one in the chain shown
 * neither the firm's letterhead nor their own signature. The colleague who
 * filled a document in "always reads it, because it is their own words and
 * their own signature" (canReadSubmissionDocument in lib/template-approval.ts);
 * that entitlement is the reason the notices below never leave a reader with a
 * blank frame or a silent downgrade they would have to diagnose themselves.
 */

/** What the Document section of a filed submission renders. */
export type SignedCopyView =
  /** The reader may not see the wording at all. Nothing is drawn. */
  | { kind: 'withheld' }
  /**
   * There is no letterheaded version to ask for, so the text stands alone and
   * no notice is owed: nothing was refused and nothing failed.
   */
  | { kind: 'text' }
  /** Ask the server for the real pages; the text is the fallback under them. */
  | { kind: 'branded' };

/**
 * Which of the three this submission gets.
 *
 * The wording gate comes first and is not re-derived here: `documentVisible`
 * is already the answer canReadSubmissionDocument gave when the row was read,
 * and a second spelling of that rule is exactly the drift this codebase has
 * been bitten by before.
 *
 * An empty document is the only other case that cannot produce pages. The
 * renderer answers a document with nothing in it with a refusal rather than
 * bytes, so asking for one would spend a round trip to arrive at the text
 * anyway, and would owe the reader an explanation for a failure that is not
 * one.
 */
export function resolveSignedCopyView(input: {
  documentVisible: boolean;
  documentText: string;
}): SignedCopyView {
  if (!input.documentVisible) return { kind: 'withheld' };
  if (input.documentText.trim() === '') return { kind: 'text' };
  return { kind: 'branded' };
}

/**
 * The line printed above the plain text when the letterheaded version could
 * not be produced.
 *
 * SAY IT RATHER THAN DEGRADE QUIETLY. A person is entitled to see the document
 * they signed. If they are handed the reflowed text with no word about it,
 * they have no way to tell it apart from the real thing, which is the failure
 * that was already shipped on this page. So a fallback here always names
 * itself as a fallback and says what happened.
 *
 * The status is the server's own, so the sentence tracks the actual reason.
 * Anything that is not one of the two known refusals is treated as "not just
 * now", which covers a timeout, a hang, a 400 and a network error alike: the
 * reader cannot act differently on any of them and a taxonomy would only make
 * the sentence longer.
 */
export function brandedCopyNotice(status: number | null): string {
  if (status === 409) {
    return 'This record changed while the page was open, so the letterhead version is not being shown against wording that may be out of date. Reload the page to see the current one. The full wording below is the version this page loaded.';
  }
  if (status === 403) {
    return 'The letterhead version of this document is not open to you here. The full wording below is what you signed, and your legal team can send you the letterhead copy.';
  }
  return 'The letterhead version could not be prepared just now, so this is the plain text of the same document. Reload the page to try again, and if it stays this way your legal team can send you the letterhead copy.';
}
