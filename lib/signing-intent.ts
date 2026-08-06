/**
 * The canonical UETA intent-to-sign sentence.
 *
 * Lifted from the intent checkbox in app/sign/[token]/signature-capture.tsx
 * so the laptop pad and the phone pad cannot drift. Do NOT reword this in
 * one place only. Two devices in one ceremony asserting intent in two
 * different forms of words is the kind of discrepancy that gets a
 * signature challenged.
 *
 * Pure, and deliberately not server-only: the phone pad is a client
 * component and renders this sentence itself.
 */

/**
 * The sentence in two pieces, with the signer's name as the seam.
 *
 * The laptop does not render the sentence as one string. It renders the
 * signer's own name inside a `<strong data-no-translate>` in the middle
 * of it, because the runtime translation layer would otherwise
 * machine-translate a person's name in the operative clause of a legal
 * instrument. The phone is under the same translation layer and has to
 * do the same thing, so the pieces are exported rather than left to each
 * surface to cut the sentence up its own way.
 *
 * signingIntentSentence below is composed from these two, so the joined
 * form and the rendered form cannot say different things.
 */
export const SIGNING_INTENT_PREFIX = 'I, ';

export function signingIntentSuffix(documentName: string): string {
  return (
    `, intend that the mark above be my signature on ` +
    `"${documentName}", with the same legal effect as a handwritten ` +
    `signature. I am acting on my own behalf or as authorized for the ` +
    `entity I represent.`
  );
}

export function signingIntentSentence(
  signerLabel: string,
  documentName: string,
): string {
  return (
    SIGNING_INTENT_PREFIX + signerLabel + signingIntentSuffix(documentName)
  );
}
