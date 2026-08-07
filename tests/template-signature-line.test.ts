import { describe, expect, it } from 'vitest';
import {
  counterpartyLabel,
  formatSignedOn,
  mergeTemplateDocument,
} from '../lib/firm-template-placeholders';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { detectSignatureAnchors } from '../lib/signature-anchors';

/**
 * The counterparty signature block in the merged document.
 *
 * A document sent for signature has to name the other side and give them a
 * place on the page, or the counterparty signs an instrument whose text
 * mentions only the employee. mergeTemplateDocument is the one function that
 * produces the employee's live preview and the copy stored for legal review
 * and the text the recipient's PDF is rendered from, so the block is added
 * here and nowhere else.
 *
 * It was also expected to earn something else, and it does not, which the last
 * block of this file measures rather than assumes. See the comment there.
 */

const BODY =
  'MUTUAL AGREEMENT\n\n' +
  'This Agreement is made on {{start_date}} between {{firm_name}} and the ' +
  'party named below. Each party agrees to keep the other party information ' +
  'in confidence for a period of three years from the date above, and to use ' +
  'it only for the purpose of evaluating a possible working relationship.\n\n' +
  'Neither party acquires any right in the other party materials beyond the ' +
  'limited permission stated here.';

const base = {
  body: BODY,
  fields: [{ key: 'start_date', label: 'Start date' }],
  values: { start_date: 'March 3, 2026' },
  firmName: 'Anderson Foundation',
  signatureName: 'Dana Lowell',
  signerEmail: 'dana@anderson.test',
  signedOn: formatSignedOn(new Date('2026-03-03T12:00:00.000Z')),
};

const EMPLOYEE_BLOCK =
  '\n\n\nSigned: Dana Lowell\nDate: March 3, 2026\nEmail: dana@anderson.test';

/** The body after substitution, which both cases must share exactly. */
const MERGED_BODY = BODY.replace('{{start_date}}', 'March 3, 2026').replace(
  '{{firm_name}}',
  'Anderson Foundation',
);

describe('mergeTemplateDocument without a counterparty', () => {
  /**
   * The whole returned string, not a substring match. Every existing caller
   * passes no counterparty, so this is the pin that says the change is
   * invisible to them: the live employee preview, the copy stored for legal
   * review and the PDF the recipient receives are all this one function's
   * output, and a byte that moved here would move in all three.
   */
  it('returns exactly what it returned before', () => {
    expect(mergeTemplateDocument(base)).toBe(MERGED_BODY + EMPLOYEE_BLOCK);
  });

  it('emits no Signature: label', () => {
    expect(mergeTemplateDocument(base)).not.toMatch(/^Signature:/m);
  });

  it('treats a blank or whitespace counterparty as no counterparty', () => {
    expect(mergeTemplateDocument({ ...base, counterpartyName: '' })).toBe(
      MERGED_BODY + EMPLOYEE_BLOCK,
    );
    expect(mergeTemplateDocument({ ...base, counterpartyName: '   ' })).toBe(
      MERGED_BODY + EMPLOYEE_BLOCK,
    );
  });
});

describe('mergeTemplateDocument with a counterparty', () => {
  const named = mergeTemplateDocument({ ...base, counterpartyName: 'Wren Supply Co.' });

  it('emits the Signature: label on a line of its own', () => {
    expect(named).toMatch(/^Signature:$/m);
  });

  it('leaves the employee block exactly as it was and puts the counterparty after it', () => {
    expect(named.startsWith(MERGED_BODY + EMPLOYEE_BLOCK)).toBe(true);
  });

  it('returns the whole document, pinned', () => {
    expect(named).toBe(
      MERGED_BODY +
        EMPLOYEE_BLOCK +
        '\n\n\nFor Wren Supply Co.:\nSignature:\nDate:',
    );
  });

  it('names the counterparty it was given, trimmed', () => {
    expect(
      mergeTemplateDocument({ ...base, counterpartyName: '  Wren Supply Co.  ' }),
    ).toBe(named);
  });
});

/**
 * The rule that keeps the two ends together.
 *
 * The employee's live preview and the copy stored for legal review are the
 * same function's output only if both call sites pass the same counterparty.
 * One is a client component and the other a server action, so nothing but a
 * shared rule can hold them together, and this is that rule.
 */
describe('counterpartyLabel', () => {
  it('emits nothing for a template that goes out as a read-only share', () => {
    expect(
      counterpartyLabel({
        deliveryMode: 'share',
        recipientName: 'Wren Supply Co.',
        recipientEmail: 'buyer@wren.test',
      }),
    ).toBeNull();
    // Absent is 'share', which is what an unmigrated database reads as.
    expect(
      counterpartyLabel({ deliveryMode: undefined, recipientName: 'Wren Supply Co.' }),
    ).toBeNull();
    expect(counterpartyLabel({ deliveryMode: null, recipientName: 'Wren Supply Co.' })).toBeNull();
  });

  it('prefers the name the employee typed', () => {
    expect(
      counterpartyLabel({
        deliveryMode: 'signature',
        recipientName: '  Wren Supply Co. ',
        recipientEmail: 'buyer@wren.test',
      }),
    ).toBe('Wren Supply Co.');
  });

  /**
   * The name is optional and the address is not, so the address is what an
   * agreement falls back to. It is lower-cased here because the server stores
   * it lower-cased and the employee types it however they like: without this,
   * the preview and the stored document would differ by a capital letter.
   */
  it('falls back to the address, normalised the way the server stores it', () => {
    expect(
      counterpartyLabel({
        deliveryMode: 'signature',
        recipientName: '   ',
        recipientEmail: '  Buyer@Wren.Test ',
      }),
    ).toBe('buyer@wren.test');
  });

  it('emits nothing when there is nobody to name yet', () => {
    expect(counterpartyLabel({ deliveryMode: 'signature' })).toBeNull();
    expect(
      counterpartyLabel({ deliveryMode: 'signature', recipientName: '', recipientEmail: '' }),
    ).toBeNull();
  });
});

/**
 * What the anchor detector actually does with a document we rendered.
 *
 * The plan behind this change expected the "Signature:" label to be found by
 * findTextSignatureAnchors, so that placeSignaturesIfMissing would append
 * nothing, no .signable.pdf would be written, and document_sha256 would be the
 * hash of exactly the bytes the signer is served. That was worth an assertion
 * rather than a comment, and the assertion says the opposite. The detector
 * finds nothing, in a document that plainly contains the label, for three
 * independent reasons found by reading the bytes back:
 *
 *   1. PDFPageLeaf.normalize() makes Contents a PDFArray before
 *      normalizedEntries() hands it over. `Array.isArray` is false for a
 *      PDFArray, so the scan wraps it in a one-element list and asks it for
 *      getContents(), which it does not have, and reads zero bytes. That is
 *      true of every PDF the scan is given, not only of ours.
 *   2. pdf-lib Flate-compresses the content stream.
 *   3. pdf-lib writes drawn text as a PDF hex string (<5369676E...> Tj), so
 *      even inflated the literal is not present.
 *
 * So the fallback box is appended, a rewritten copy is stored at
 * signable_file_path, and that copy is what the signer is served while
 * document_sha256 still describes file_path. That is pre-existing and true of
 * every signing request the product sends today; this block did not cause it
 * and does not repair it, because repairing the scan would relocate the
 * signature box on every firm's uploaded documents, which is a product
 * decision and not a slice of plumbing.
 *
 * These tests are therefore pinned to the world as it is. Whoever repairs the
 * scanner will find exactly two assertions here going red, and this comment
 * next to them.
 */
describe('the rendered PDF, as the anchor detector sees it', () => {
  it('finds no text anchor when no counterparty is named', async () => {
    const bytes = await buildBrandedDocumentPdf({
      document: mergeTemplateDocument(base),
      title: 'Mutual Agreement',
    });
    expect(bytes).not.toBeNull();
    expect(await detectSignatureAnchors(bytes as Uint8Array)).toEqual([]);
  });

  it('still finds no text anchor with the label plainly in the document', async () => {
    const document = mergeTemplateDocument({ ...base, counterpartyName: 'Wren Supply Co.' });
    // The label is unambiguously there in the text handed to the renderer.
    expect(document).toMatch(/^Signature:$/m);
    const bytes = await buildBrandedDocumentPdf({ document, title: 'Mutual Agreement' });
    expect(bytes).not.toBeNull();
    // And absent from the saved bytes as a readable literal, which is reason 2
    // and reason 3 above in one assertion.
    expect(Buffer.from(bytes as Uint8Array).toString('latin1')).not.toContain('Signature:');
    expect(await detectSignatureAnchors(bytes as Uint8Array)).toEqual([]);
  });

  /**
   * The consequence, stated as a fact rather than as a risk: creating a
   * signing request over this document rewrites the PDF, so the bytes the
   * signer is served are not the bytes document_sha256 was taken over.
   */
  it('falls back to an appended box, with or without the counterparty block', async () => {
    const { placeSignaturesIfMissing } = await import('../lib/signature-anchors');
    for (const counterpartyName of [null, 'Wren Supply Co.']) {
      const bytes = await buildBrandedDocumentPdf({
        document: mergeTemplateDocument({ ...base, counterpartyName }),
        title: 'Mutual Agreement',
      });
      const placed = await placeSignaturesIfMissing(bytes as Uint8Array, [
        { email: 'buyer@wren.test', name: 'Wren Supply Co.' },
      ]);
      expect(placed.pdfBytesChanged).toBe(true);
      expect(placed.signers[0].source).toBe('appended-fallback');
    }
  });
});
