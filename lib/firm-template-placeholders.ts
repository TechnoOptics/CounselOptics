/**
 * Placeholder rules shared by the counsel template editor and the employee
 * fill-and-sign page. Both sides have to agree on which `{{keys}}` are the
 * firm's to fill in and which are the employee's, so they read the same file.
 */

import { counterpartyMarker } from './template-field-boxes';

/**
 * Placeholders every template gets for free, resolved from the firm record at
 * render time rather than typed into the body.
 *
 * `firms.name` is the only name the employee has ever seen (it brands the
 * rail, the logo and the footer), so it is the only one an agreement they sign
 * should carry. A template that writes the name into its body freezes whatever
 * the firm was called the day it was drafted, which is how a Zinpro-branded
 * hub came to serve an NDA naming "Anderson Foundation" as the Company.
 *
 * These are deliberately excluded from the editor's field extraction: they are
 * not something an employee fills in, so they must not become an input.
 */
export const RESERVED_FIRM_KEYS = ['firm_name', 'company_name'] as const;

export function isReservedFirmKey(key: string): boolean {
  return (RESERVED_FIRM_KEYS as readonly string[]).includes(key);
}

/**
 * Which fields may be pre-filled with the signed-in employee's own name.
 *
 * This used to be `/name/.test(key)`, an unanchored substring test, so every
 * key containing "name" was filled with the employee: `counterparty_name`,
 * `recipient_name`, `party_b_name`. The live NDA opened with the employee as
 * their own counterparty. Only keys that clearly denote the signer are
 * pre-filled now; the other side of an agreement is never guessed.
 */
export function isSelfNameField(key: string): boolean {
  return /^(your|employee|signer|staff|my)_?(full_?)?name$|^(full_?)?name$/.test(
    key.trim().toLowerCase(),
  );
}

/**
 * `party` is optional and absent means the employee, which is what every
 * existing caller passes and what every template that exists today declares.
 * A counterparty field is not filled here at all: it is rendered as a ruled
 * blank the renderer can measure, and the other side types into it later.
 */
export type MergeableField = {
  key: string;
  label: string;
  party?: 'employee' | 'counterparty';
};

/**
 * The name the counterparty block carries, or null when there is no block.
 *
 * The employee's live preview and the copy stored for legal review are both
 * mergeTemplateDocument's output, and they agree only if both call sites pass
 * the same counterparty. So the rule lives here, next to the function it feeds,
 * rather than being written out twice and drifting the first time one of them
 * is edited.
 *
 * The block appears only for a template the legal team set to go out for
 * signature. It is labelled with the recipient's name when the employee gave
 * one and with their address when they did not, because an agreement has to
 * say who the other side is and the address is the one thing always present.
 */
export function counterpartyLabel(input: {
  /** The template's delivery mode. Anything but 'signature' means no block. */
  deliveryMode: string | null | undefined;
  recipientName?: string | null;
  recipientEmail?: string | null;
}): string | null {
  if (input.deliveryMode !== 'signature') return null;
  // The address is lower-cased here rather than at either call site, because
  // the server stores it lower-cased and the employee types it however they
  // like. Normalising in one place is what stops the preview and the stored
  // document differing by a capital letter.
  return (
    (input.recipientName ?? '').trim() ||
    (input.recipientEmail ?? '').trim().toLowerCase() ||
    null
  );
}

/**
 * Substitute a template body into the finished document, then append the
 * signature block.
 *
 * The employee's live preview and the copy stored for legal review are
 * produced by this one function, so the reviewer reads exactly what the
 * employee saw, and the recipient receives exactly what the reviewer approved.
 * An unfilled field renders as its bracketed label, which is what makes a
 * half-finished document obvious on the page rather than silently blank.
 */
export function mergeTemplateDocument(input: {
  body: string;
  fields: readonly MergeableField[];
  values: Record<string, string>;
  firmName: string;
  signatureName: string;
  signerEmail: string;
  signedOn: string;
  /**
   * The outside party who will sign this, when the template is sent for
   * signature rather than as a read-only share. Absent or blank means no
   * counterparty block, which is every template that exists today, so their
   * output is unchanged to the byte.
   */
  counterpartyName?: string | null;
}): string {
  let text = input.body;
  // Whether this document has an other side at all. See the counterparty
  // branch below, and buildCounterpartyBlock, which reads the same answer.
  const hasCounterparty = Boolean((input.counterpartyName ?? '').trim());
  const declared = new Set(input.fields.map((f) => f.key));
  for (const key of RESERVED_FIRM_KEYS) {
    if (declared.has(key)) continue;
    text = text.split(`{{${key}}}`).join(input.firmName);
  }
  for (const f of input.fields) {
    // A counterparty field is never merged from `values`, whatever `values`
    // happens to contain. The employee does not answer for the other side,
    // and a value that reached this map for a counterparty key would be
    // either a stale draft or a caller pushing one in.
    //
    // WHO THE BLANK IS FOR DECIDES WHETHER THERE IS ONE. A blank belongs to
    // somebody: the marker is what lib/branded-document-pdf.ts measures as it
    // draws, so the other side's typed value has one recorded place to land
    // (lib/template-field-boxes.ts). On a read-only encrypted share there is
    // no other side. No signer, no ceremony, and nobody who will ever type
    // into it, so a marker there would be a blank left open on a document
    // that is already final, and lib/template-release.ts drops the recorded
    // geometry on that path for exactly that reason.
    //
    // counterpartyName is the mode: counterpartyLabel returns null for every
    // delivery mode but 'signature'. So this is where the premise that path
    // relied on is actually made true, rather than asserted in a comment. A
    // field with nobody to fill it falls through to the ordinary branch and
    // renders as its bracketed label, which is what every unanswered field on
    // this product renders as: visible to the employee on their preview and to
    // the reviewer before they approve it, and recoverable by either of them.
    // It renders the label DIRECTLY rather than falling through to the branch
    // below, because that branch consults `values`, and there is no share on
    // which the employee gets to answer for the other side either.
    if (f.party === 'counterparty') {
      text = text
        .split(`{{${f.key}}}`)
        .join(hasCounterparty ? counterpartyMarker(f.key) : `[${f.label}]`);
      continue;
    }
    const val = (input.values[f.key] ?? '').trim() || `[${f.label}]`;
    text = text.split(`{{${f.key}}}`).join(val);
  }
  const signature = input.signatureName.trim() || '____________________';
  return (
    `${text}\n\n\nSigned: ${signature}\nDate: ${input.signedOn}\nEmail: ${input.signerEmail}` +
    buildCounterpartyBlock(input.counterpartyName)
  );
}

/**
 * The block the outside party signs.
 *
 * A document sent for signature has to name the other side and offer them a
 * place on the page, or the counterparty is asked to sign an instrument whose
 * text mentions only the employee. That is the whole of why this exists.
 *
 * It is NOT here to be found by the anchor scanner, and the plan this was
 * built from expected it to be. findTextSignatureAnchors
 * (lib/signature-anchors.ts) looks for the literal "Signature:" in a page
 * content stream, and it cannot find one in anything pdf-lib writes, for three
 * independent reasons, each verified by running it:
 *
 *   1. PDFPageLeaf.normalize() turns Contents into a PDFArray before
 *      normalizedEntries() returns it. `Array.isArray` is false for a
 *      PDFArray, so the scan wraps it in a one-element list and asks it for
 *      getContents(), which a PDFArray does not have. It reads zero bytes from
 *      every PDF, not only ours.
 *   2. pdf-lib Flate-compresses the content stream, so the bytes are binary
 *      even when they are read.
 *   3. pdf-lib writes drawn text as a PDF hex string (<5369676E...> Tj), so
 *      the literal is not present after inflating either.
 *
 * The consequence is pre-existing and is not made worse by this block:
 * placeSignaturesIfMissing appends a fallback signature box, rewrites the PDF
 * and stores the rewritten copy at signable_file_path, and that copy is what
 * the signer is served while document_sha256 still describes file_path.
 * tests/template-signature-line.test.ts pins that today, so whoever repairs
 * the scanner sees exactly which assertion changes and why.
 *
 * Nothing here is drawn as a ruled blank. The mark is stamped by
 * lib/signature-render.ts at the recorded geometry, and a second place that
 * decides where a signature belongs is exactly what lib/signature-geometry.ts
 * exists to prevent.
 */
function buildCounterpartyBlock(counterpartyName: string | null | undefined): string {
  const name = (counterpartyName ?? '').trim();
  if (!name) return '';
  return `\n\n\nFor ${name}:\nSignature:\nDate:`;
}

/** How many lines buildCounterpartyBlock emits, before any wrapping. */
export const COUNTERPARTY_BLOCK_LINES = 3;

/**
 * The line the other side's execution block starts on, or null when there is
 * none.
 *
 * The counterpart of findSignatureBlockLine, and it exists for the same
 * reason: the renderer has to keep a block together across a page break, and
 * only the function that wrote the block knows what it looks like. The
 * employee's own block has been reserved as a unit since the mark shipped;
 * this one had nothing, and a real render put "For Northwind Materials LLC: /
 * Signature:" at the foot of one page and "Date:" alone at the head of the
 * next, on an agreement a company was being asked to execute.
 *
 * Matched on all three lines rather than on the "For" alone, because a body
 * may legitimately begin a sentence with "For". Scanned from the end for the
 * same reason findSignatureBlockLine is: a body may quote an earlier
 * agreement's execution block, and the last one is this document's own.
 *
 * Returning null is a supported outcome. A reviewer may rewrite the block
 * while editing the wording, and the renderer then lays it out as ordinary
 * text, which is what it did for every document before this.
 */
export function findCounterpartyBlockLine(documentText: string): number | null {
  if (typeof documentText !== 'string' || documentText === '') return null;
  const lines = documentText.split('\n');
  for (let i = lines.length - COUNTERPARTY_BLOCK_LINES; i >= 0; i -= 1) {
    const head = lines[i].trimStart();
    if (!head.startsWith('For ') || !head.endsWith(':')) continue;
    if (lines[i + 1].trim() !== 'Signature:') continue;
    if (lines[i + 2].trim() !== 'Date:') continue;
    return i;
  }
  return null;
}

/**
 * Where the signature mark belongs: the index of the line the mark is drawn
 * directly above, or null when there is no such line.
 *
 * This path generates the document rather than parsing one, so there is no
 * anchor to detect. The block is fixed, `mergeTemplateDocument` puts it there,
 * and this function is the one place that says where it is. The employee's
 * preview, the reviewer's copy and the delivered PDF all call this on the text
 * they are about to render, so they cannot put the mark in three places.
 *
 * The scan runs from the end because a body may legitimately quote a signature
 * line of its own (an exhibit, a recital of an earlier agreement). The last one
 * is the block this document is signed on.
 *
 * Returning null is a supported outcome, not a failure. A reviewer may rewrite
 * the block while editing the wording, and the renderer then draws the mark at
 * the end of the body under a hairline rule. The mark is never dropped.
 */
export function findSignatureBlockLine(documentText: string): number | null {
  if (typeof documentText !== 'string' || documentText === '') return null;
  const lines = documentText.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trimStart().startsWith('Signed: ')) return i;
  }
  return null;
}

/** The date format the signature block uses, on both sides. */
export function formatSignedOn(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
