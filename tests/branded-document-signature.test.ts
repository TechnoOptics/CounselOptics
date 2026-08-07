import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { mergeTemplateDocument } from '../lib/firm-template-placeholders';

/** Every string drawn on one page, in order. */
function pageText(doc: PDFDocument, index: number): string[] {
  const contents = doc.getPages()[index].node.Contents();
  const parts: unknown[] = contents instanceof PDFArray ? contents.asArray() : [contents];
  let out = '';
  for (const part of parts) {
    const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
    if (!(stream instanceof PDFRawStream)) continue;
    let raw: Uint8Array = stream.asUint8Array();
    try {
      raw = zlib.inflateSync(Buffer.from(raw));
    } catch {
      /* not deflated: use it as it stands */
    }
    out += Buffer.from(raw).toString('latin1');
  }
  return [...out.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1], 'hex').toString('latin1'),
  );
}

/**
 * The renderer draws the signer's mark above the signature block.
 *
 * Where the mark lands is decided by findSignatureBlockLine, which is pure and
 * tested on its own. What is tested here is the part that only the renderer
 * can answer: that a mark is actually embedded, that a document whose block a
 * reviewer rewrote still carries the mark rather than dropping it, and above
 * all that a bad PNG cannot stop the document going out.
 */

/**
 * The smallest valid PNG: one 8-bit RGBA pixel. Written as bytes rather than a
 * base64 blob so the magic number and the IHDR, IDAT and IEND chunks are
 * visible in the source of the test that depends on them.
 */
function samplePng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

const BODY = `MUTUAL NON-DISCLOSURE AGREEMENT

${'This agreement is between Acme Corporation and Beta LLC. '.repeat(12)}

The parties agree to the terms above.`;

function signed(body: string): string {
  return `${body}\n\n\nSigned: Jane Doe\nDate: August 6, 2026\nEmail: jane@acme.com`;
}

/**
 * How many images the pages actually draw. Counted from each page's own
 * XObject resources rather than from every indirect object in the file,
 * because an RGBA PNG also produces a soft-mask image object that no page
 * draws directly, and counting that would report one mark as two.
 */
function drawnImages(doc: PDFDocument): number[] {
  return doc.getPages().map((page) => {
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return xobjects ? xobjects.keys().length : 0;
  });
}

async function imageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return drawnImages(doc).reduce((a, b) => a + b, 0);
}

/**
 * The renderer now returns the bytes together with the counterparty blanks it
 * recorded (lib/template-field-boxes.ts). These tests are about the bytes, so
 * they unwrap here rather than at every call site, and a null render still
 * reads as null.
 */
async function renderBytes(
  input: Parameters<typeof buildBrandedDocumentPdf>[0],
): Promise<Uint8Array | null> {
  const out = await buildBrandedDocumentPdf(input);
  return out ? out.bytes : null;
}

describe('buildBrandedDocumentPdf with a signature mark', () => {
  it('embeds no image when no mark is supplied', async () => {
    const bytes = await renderBytes({ document: signed(BODY), title: 'NDA' });
    expect(bytes).not.toBeNull();
    expect(await imageCount(bytes as Uint8Array)).toBe(0);
  });

  it('embeds the mark when one is supplied', async () => {
    const bytes = await renderBytes({
      document: signed(BODY),
      title: 'NDA',
      signatureImage: { png: samplePng() },
    });
    expect(bytes).not.toBeNull();
    expect(await imageCount(bytes as Uint8Array)).toBe(1);
  });

  it('still carries the mark when a reviewer rewrote the signature block', async () => {
    const rewritten = `${BODY}\n\n\nSignature of the undersigned: Jane Doe\nDated: August 6, 2026`;
    const bytes = await renderBytes({
      document: rewritten,
      title: 'NDA',
      signatureImage: { png: samplePng() },
    });
    expect(bytes).not.toBeNull();
    expect(await imageCount(bytes as Uint8Array)).toBe(1);
  });

  it('renders the document anyway when the mark is not a usable PNG', async () => {
    const bytes = await renderBytes({
      document: signed(BODY),
      title: 'NDA',
      signatureImage: { png: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
    });
    // The document goes out without a squiggle, which is recoverable. A
    // document that failed to render at all would not be.
    expect(bytes).not.toBeNull();
    expect(await imageCount(bytes as Uint8Array)).toBe(0);
  });

  // Both lengths put the signature block within a line or two of a page
  // break, which is where a mark that reserves no space ends up at the foot of
  // one page with the name it belongs to at the head of the next. 36 sections
  // splits the block itself, 38 splits the mark from the whole block.
  for (const sections of [36, 38]) {
    it(`keeps the mark with its signature block across a page break (${sections} sections)`, async () => {
      const long = Array.from(
        { length: sections },
        (_, i) => `Section ${i + 1}. ${'Filler text. '.repeat(6)}`,
      ).join('\n\n');
      const bytes = await renderBytes({
        document: signed(long),
        title: 'NDA',
        signatureImage: { png: samplePng() },
      });
      expect(bytes).not.toBeNull();
      const doc = await PDFDocument.load(bytes as Uint8Array);
      expect(doc.getPageCount()).toBeGreaterThan(1);
      // The mark is drawn exactly once, on the last page, which is the page
      // the whole Signed / Date / Email block is on.
      const perPage = drawnImages(doc);
      expect(perPage[perPage.length - 1]).toBe(1);
      expect(perPage.slice(0, -1).every((n) => n === 0)).toBe(true);
    });
  }
});

/**
 * The other side's execution block does not straddle a page break either.
 *
 * The employee's own block has been reserved since the mark was added
 * (SIG_BLOCK_LINES), and the counterparty's had nothing. Observed on a real
 * render: "For Northwind Materials LLC: / Signature:" at the foot of one page
 * and a bare "Date:" alone at the head of the next, on an agreement a company
 * is being asked to execute.
 *
 * Sixteen lengths, because the split only happens when the block lands within
 * a line or two of the break, and a single fixture would stop exercising it
 * the first time anything upstream changed the layout by a line.
 */
describe('the counterparty execution block', () => {
  const lines = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `Clause ${i + 1}. The parties agree to the terms set out in this paragraph.`,
    ).join('\n');

  for (let n = 28; n <= 43; n += 1) {
    it(`stays on one page (${n} clauses)`, async () => {
      const document = mergeTemplateDocument({
        deliveryMode: 'signature',
        body: lines(n),
        fields: [],
        values: {},
        firmName: 'Anderson',
        signatureName: 'Jane Doe',
        signerEmail: 'jane@acme.test',
        signedOn: 'August 6, 2026',
        counterpartyName: 'Northwind Materials LLC',
      });
      const bytes = await renderBytes({ document, title: 'NDA' });
      const doc = await PDFDocument.load(bytes as Uint8Array);
      const texts = Array.from({ length: doc.getPageCount() }, (_, i) => pageText(doc, i));
      const pageOf = (match: (line: string) => boolean) =>
        texts.findIndex((page) => page.some(match));
      const forLine = pageOf((l) => l.startsWith('For Northwind'));
      const signatureLine = pageOf((l) => l.trim() === 'Signature:');
      // The employee's own block carries "Date: August 6, 2026"; the bare one
      // is the counterparty's.
      const dateLine = pageOf((l) => l.trim() === 'Date:');
      expect(forLine).toBeGreaterThanOrEqual(0);
      expect(signatureLine).toBe(forLine);
      expect(dateLine).toBe(forLine);
    });
  }
});
