/**
 * Whose paper a stored document is, as pure rules.
 *
 * WHY THE READ IS ONE FUNCTION AND NOT A COMPARISON AT EACH SURFACE.
 *
 * `firm_documents.paper_origin` arrives with
 * supabase/migrations/20260822_document_paper_origin.sql, which is NOT
 * applied. So a reader will meet three things: the column absent entirely,
 * the column present and null on every row that predates the one writer, and
 * eventually the two real values. All three of the first sort have to read
 * the same way, and a check spelled out at each reader is a check that will
 * eventually disagree with itself.
 *
 * NULL IS 'third_party', AND THAT IS THE FAIL-SAFE DIRECTION.
 *
 * The protection this column exists to carry is that a counterparty's
 * document is never re-rendered and never rewritten. Reading an unlabelled
 * document as the firm's own would drop that protection on exactly the rows
 * nobody knows about. Reading it as somebody else's costs nothing but a
 * preserved file. It is also true of the whole existing table: every row in
 * it today was either uploaded by a member, which is paper the firm did not
 * render, or produced by lib/submission-document.ts, which is the one writer
 * taught to say 'firm'.
 *
 * Nothing here touches a database or React, so all of it is exercised by
 * tests/document-provenance.test.ts.
 */

/** The column, named once so no caller spells it. */
export const PAPER_ORIGIN_COLUMN = 'paper_origin';

export type PaperOrigin = 'firm' | 'third_party';

/**
 * Whose paper this is.
 *
 * Absent, null, empty, a number, a typo, a value some future writer invents:
 * all of them are 'third_party'. There is no "unknown" return, deliberately,
 * because an unknown would force every caller to decide again and the whole
 * point of this module is that the decision is made once.
 */
export function readPaperOrigin(raw: unknown): PaperOrigin {
  return raw === 'firm' ? 'firm' : 'third_party';
}

/** Whether this document came out of the firm's own renderer. */
export function isFirmPaper(raw: unknown): boolean {
  return readPaperOrigin(raw) === 'firm';
}

/**
 * Whether this document is somebody else's and must be preserved as it
 * stands. The named opposite of isFirmPaper, so a caller reads the rule it
 * means rather than a negation of the other one.
 */
export function isThirdPartyPaper(raw: unknown): boolean {
  return readPaperOrigin(raw) === 'third_party';
}

/**
 * The header shown over a document the firm did not write, on both the
 * counsel surface and the employee's.
 *
 * Two sentences and no adjectives. The first says where it came from, which
 * is the fact a reader needs before they read a word of it. The second is a
 * promise about what the product did to it, which is nothing, and it is
 * there because a reader who has watched this product brand and re-render
 * documents has every reason to wonder.
 *
 * The counterparty's name is interpolated when it is known and the sentence
 * falls back to a form that is still true when it is not, rather than
 * printing an empty space or the word "unknown" where a party name goes.
 */
export function thirdPartyPaperHeader(counterparty: string | null | undefined): string {
  const name = (counterparty ?? '').trim();
  return name
    ? `Sent to us by ${name}. Kept exactly as received.`
    : 'Sent to us by the other party. Kept exactly as received.';
}

/**
 * The header for a document, or null when there is none to show.
 *
 * The firm's own paper gets nothing. A banner on every document is a banner
 * nobody reads, and the whole value of this one is that its presence means
 * something.
 */
export function paperOriginHeader(
  raw: unknown,
  counterparty: string | null | undefined,
): string | null {
  return isThirdPartyPaper(raw) ? thirdPartyPaperHeader(counterparty) : null;
}

export type PaperOriginColumnFallback =
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error'
  /** The column is missing and the write must not proceed. */
  | 'abort-origin-unsaved';

/** The wording for the abort, kept beside the decision that causes it. */
export const PAPER_ORIGIN_UNSAVED_ERROR =
  'This document was not filed. Recording that the firm wrote it needs a ' +
  'database update that has not been applied yet, and filing it now would ' +
  'label a document the firm wrote as one the other party sent. Ask your ' +
  'administrator to apply the pending update, then approve this again.';

/**
 * What to do when a write carrying `paper_origin` fails.
 *
 * Same shape as resolveDeliveryModeColumnFallback in lib/submission-dispatch.ts
 * and resolveDocumentLayoutColumnFallback in lib/template-document-layout.ts,
 * and the same narrow scope: only a missing column is handled here, so a
 * permission or constraint failure still surfaces to the caller untouched.
 *
 * THE ASYMMETRY THOSE TWO HAVE, THIS ONE DOES NOT, so the reasoning is
 * written out rather than assumed.
 *
 * Both of those retry without the column when the value being dropped is
 * what an absent column already means. Here that test would pass: an absent
 * column reads 'third_party', and a document dropped to 'third_party' is
 * PRESERVED rather than exposed, so the never-rewrite protection is
 * over-applied and never weakened. On the protection alone a retry would be
 * safe.
 *
 * It aborts regardless, because of what the row would then say rather than
 * what it would allow. There is no backfill and nothing later re-derives
 * provenance, so a document the firm rendered itself would be labelled as
 * the counterparty's permanently, and the surfaces would tell a reader, on a
 * legal document, that it was sent to them by the other party and kept
 * exactly as received. That is a false statement nobody would ever discover.
 *
 * A loud, recoverable failure beats a silent, permanent falsehood. The
 * submission stays approved and retryable, and applying the migration makes
 * the retry succeed.
 *
 * The only value this module ever writes is 'firm'. There is no
 * 'retry-without-column' branch at all, rather than one no caller reaches:
 * an unreachable permissive branch is the thing a later edit widens.
 */
export function resolvePaperOriginColumnFallback(input: {
  error: { code?: string | null; message?: string | null } | null | undefined;
  /**
   * The same predicate the rest of the repo uses, passed in rather than
   * imported, so this module keeps its promise of importing nothing. The
   * caller passes isUnknownColumnError from lib/signer-view.ts.
   */
  isUnknownColumn: (
    error: { code?: string | null; message?: string | null } | null | undefined,
    column: string,
  ) => boolean;
}): PaperOriginColumnFallback {
  return input.isUnknownColumn(input.error, PAPER_ORIGIN_COLUMN)
    ? 'abort-origin-unsaved'
    : 'surface-error';
}
