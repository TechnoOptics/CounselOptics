/**
 * Placeholder rules shared by the counsel template editor and the employee
 * fill-and-sign page. Both sides have to agree on which `{{keys}}` are the
 * firm's to fill in and which are the employee's, so they read the same file.
 */

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

export type MergeableField = { key: string; label: string };

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
}): string {
  let text = input.body;
  const declared = new Set(input.fields.map((f) => f.key));
  for (const key of RESERVED_FIRM_KEYS) {
    if (declared.has(key)) continue;
    text = text.split(`{{${key}}}`).join(input.firmName);
  }
  for (const f of input.fields) {
    const val = (input.values[f.key] ?? '').trim() || `[${f.label}]`;
    text = text.split(`{{${f.key}}}`).join(val);
  }
  const signature = input.signatureName.trim() || '____________________';
  return `${text}\n\n\nSigned: ${signature}\nDate: ${input.signedOn}\nEmail: ${input.signerEmail}`;
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
