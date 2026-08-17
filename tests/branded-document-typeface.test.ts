import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { LABEL_RE } from '../lib/signature-anchor-text';

/**
 * THE FIRM'S OWN FACE ON THE FIRM'S OWN DOCUMENTS.
 *
 * Every document this product has produced was set in Times, including for
 * firms whose stationery is now rendered correctly in their own brand. This
 * covers the body: the typeface travels the same route the letterhead does, and
 * falls back to Times whenever it cannot.
 *
 * THE FONT IS A REAL ONE. public/fonts/conquera.ttf is already committed (it is
 * the marketing display face), so these tests embed a genuine TrueType file
 * rather than a fabricated header. A synthesised font would prove the plumbing
 * and none of the things that actually go wrong: subsetting, metrics, and
 * whether the text can still be read back out of the finished document.
 */

const FONT = new Uint8Array(readFileSync(join(process.cwd(), 'public/fonts/conquera.ttf')));

const REGULAR_URL = 'https://branding.test/firm/regular.ttf';
const BOLD_URL = 'https://branding.test/firm/bold.ttf';

const LICENCE = {
  acknowledgedAt: '2026-08-17T10:00:00.000Z',
  acknowledgedBy: '00000000-0000-0000-0000-000000000001',
  holder: 'Zinpro Corporation',
};

/** A body long enough to clear the renderer's 100-character floor. */
const BODY = [
  'MUTUAL NONDISCLOSURE AGREEMENT',
  '',
  'This Agreement is entered into as of the date last written below between the',
  'parties identified in the signature blocks that follow.',
  '',
  '1. Confidential Information. Each party may disclose to the other information',
  'that it regards as confidential, and the receiving party agrees to protect it.',
  '',
  'IN WITNESS WHEREOF, the parties have executed this Agreement.',
  '',
  'Signed: Jane Partner',
  'Date:',
  'Email:',
].join('\n');

/** Serve font bytes for any URL the renderer asks for. */
function stubFontFetch(bytes: Uint8Array = FONT, contentType = 'font/ttf') {
  vi.stubGlobal('fetch', async () =>
    new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      status: 200,
      headers: { 'content-type': contentType },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Every /BaseFont name in the finished document.
 *
 * Read through pdf-lib's own parser rather than by scanning the bytes, because
 * the font dictionaries live inside compressed object streams and a byte scan
 * would report "not found" for a font that is present. That is the exact shape
 * of mistake lib/signature-anchors.ts is still making.
 */
async function baseFontNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const names: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of('Type'))?.toString() !== '/Font') continue;
    const base = obj.get(PDFName.of('BaseFont'));
    if (base) names.push(base.toString());
  }
  return names;
}

/**
 * How many distinct faces are embedded, counted by FontDescriptor.
 *
 * NOT by counting /Font dictionaries: pdf-lib writes a custom face as a
 * composite font, which is TWO /Font dicts (the Type0 and its CIDFont
 * descendant) sharing one BaseFont name. Counting those reported two faces for
 * one embedded file. A FontDescriptor is written once per embedded program, so
 * it is the thing that actually answers "how many faces are in here".
 */
async function embeddedFaceCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of('Type'))?.toString() === '/FontDescriptor') n += 1;
  }
  return n;
}

/** The size of each embedded font PROGRAM, which is what subsetting shrinks. */
async function embeddedFontProgramSizes(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const sizes: number[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue;
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const ref = obj.get(PDFName.of(key));
      if (!ref) continue;
      const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (stream instanceof PDFRawStream) sizes.push(stream.contents.length);
    }
  }
  return sizes;
}

/**
 * The control for the subsetting test: the same font, embedded WHOLE.
 *
 * Built with pdf-lib directly so the comparison is against what "no subsetting"
 * actually costs today, rather than against a constant that was measured once
 * and then rotted.
 */
async function wholeFontProgramSize(): Promise<number> {
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const face = await doc.embedFont(FONT, { subset: false });
  doc.addPage([612, 792]).drawText('Signed: Jane Partner', {
    x: 50,
    y: 700,
    size: 11,
    font: face,
  });
  const sizes = await embeddedFontProgramSizes(await doc.save());
  return sizes[0];
}

describe('a firm that has set no typeface', () => {
  it('still gets Times, so nothing changes for firms that never asked', async () => {
    const out = await buildBrandedDocumentPdf({ document: BODY, title: 'Mutual Agreement' });
    expect(out).not.toBeNull();
    const names = await baseFontNames(out!.bytes);
    expect(names.join(' ')).toMatch(/Times/);
    expect(out!.typefaceError).toBeUndefined();
  });
});

describe('a firm that has set a typeface', () => {
  it('has its documents set in its own face rather than in Times', async () => {
    stubFontFetch();
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: BOLD_URL,
        familyName: 'Conquera',
        licence: LICENCE,
      },
    });
    const names = (await baseFontNames(out!.bytes)).join(' ');
    expect(names).toMatch(/Conquera/i);
    expect(names).not.toMatch(/Times/);
    expect(out!.typefaceError).toBeUndefined();
  });

  it('embeds a SUBSET, so a document does not carry the whole font file', async () => {
    stubFontFetch();
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Conquera',
        licence: LICENCE,
      },
    });
    // MEASURED AGAINST A CONTROL THAT IS THE SAME FONT EMBEDDED WHOLE.
    //
    // The first version of this test asserted only that the embedded program
    // was smaller than the 76,396-byte source file, and it PASSED with
    // subsetting switched off, because embedding the whole font still produces
    // a 28,514-byte program. It proved nothing. Mutating `subset: true` to
    // `subset: false` is what exposed it.
    //
    // The control is built here rather than hard-coded, so the test calibrates
    // itself against whatever pdf-lib does today instead of against a number
    // that was true once.
    const programs = await embeddedFontProgramSizes(out!.bytes);
    expect(programs).toHaveLength(1);
    expect(programs[0]).toBeLessThan((await wholeFontProgramSize()) / 2);
  });
});

describe('the bold weight', () => {
  it('is used for headings when the firm uploaded one', async () => {
    stubFontFetch();
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: BOLD_URL,
        familyName: 'Conquera',
        licence: LICENCE,
      },
    });
    // Two separately embedded faces: a regular and a bold.
    expect(await embeddedFaceCount(out!.bytes)).toBe(2);
  });

  it('falls back to the regular weight when the firm uploaded only one file', async () => {
    stubFontFetch();
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Conquera',
        licence: LICENCE,
      },
    });
    // ONE face, used for both body and headings. Not Times for the headings:
    // mixing the firm's face with Times inside one document is worse than a
    // document with no bold in it.
    expect(await embeddedFaceCount(out!.bytes)).toBe(1);
    expect((await baseFontNames(out!.bytes)).join(' ')).not.toMatch(/Times/);
    // And it is not an error. A firm with one weight has a working typeface.
    expect(out!.typefaceError).toBeUndefined();
  });
});

describe('a typeface that cannot be used', () => {
  it('falls back to Times and SAYS SO when the file is a WOFF', async () => {
    // 'wOFF' magic, which is what a brand kit actually ships.
    stubFontFetch(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]));
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Gotham',
        licence: LICENCE,
      },
    });
    expect((await baseFontNames(out!.bytes)).join(' ')).toMatch(/Times/);
    expect(out!.typefaceError).toMatch(/WOFF/);
  });

  it('falls back to Times and says so when the font cannot be fetched', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Gotham',
        licence: LICENCE,
      },
    });
    expect((await baseFontNames(out!.bytes)).join(' ')).toMatch(/Times/);
    expect(out!.typefaceError).toMatch(/404|could not/i);
  });

  it('falls back to Times and says so when the font file is damaged', async () => {
    // A REAL TrueType header and table directory, cut off partway. This is the
    // one failure the magic-byte sniff cannot catch by construction: the bytes
    // that identify the format are all present and correct, so it can only fail
    // deeper in, inside fontkit. Without the try/catch around embedFont this
    // takes the whole document down, and the counterparty is waiting on it.
    stubFontFetch(FONT.slice(0, 2048));
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Gotham',
        licence: LICENCE,
      },
    });
    expect(out).not.toBeNull();
    expect(out!.typefaceError).toBeTruthy();
    expect((await baseFontNames(out!.bytes)).join(' ')).toMatch(/Times/);
    // Readable, not a half-embedded wreck.
    const reloaded = await PDFDocument.load(new Uint8Array(out!.bytes));
    expect(reloaded.getPageCount()).toBeGreaterThan(0);
  });

  it('never renders a document in a face the firm did not choose', async () => {
    stubFontFetch(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: null,
        familyName: 'Gotham',
        licence: LICENCE,
      },
    });
    // The document still renders. A document that fails to render is not
    // recoverable and the counterparty is waiting on it.
    expect(out).not.toBeNull();
    expect(out!.bytes.length).toBeGreaterThan(0);
    expect(out!.typefaceError).toBeTruthy();
  });
});

describe('signature-line detection survives a subset-embedded font', () => {
  /**
   * THE HIGHEST-RISK PART OF THE CHANGE, tested against a real embedded font.
   *
   * components/DocumentPdfDeck.tsx decides which page to turn to by reading
   * getTextContent() and matching LABEL_RE. A subset font stores text as glyph
   * indices, so if pdf-lib did not also write a ToUnicode CMap the reader would
   * find nothing and a signed document would open on page one with the
   * signature block somewhere the signer never sees. That failure has happened
   * in this product before, which is why lib/signature-anchor-text.ts exists.
   *
   * This runs the deck's own check, with the deck's own vocabulary, over a
   * document rendered in a real subset-embedded font.
   */
  async function labelsFoundByTheViewer(bytes: Uint8Array): Promise<string[]> {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = (await getDocumentProxy(new Uint8Array(bytes))) as {
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    };
    const found: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      for (const item of content.items) {
        const text = (item.str ?? '').trim();
        if (text && LABEL_RE.test(text)) found.push(text);
      }
    }
    return found;
  }

  it('finds the signature label on a document set in Times', async () => {
    const out = await buildBrandedDocumentPdf({ document: BODY, title: 'Mutual Agreement' });
    expect(await labelsFoundByTheViewer(out!.bytes)).not.toHaveLength(0);
  });

  it('still finds it on the same document set in the firm subset-embedded face', async () => {
    stubFontFetch();
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      typeface: {
        regularUrl: REGULAR_URL,
        boldUrl: BOLD_URL,
        familyName: 'Conquera',
        licence: LICENCE,
      },
    });
    // Proven to be the custom face, so this test cannot pass by silently
    // falling back to Times and testing nothing.
    expect((await baseFontNames(out!.bytes)).join(' ')).not.toMatch(/Times/);
    const labels = await labelsFoundByTheViewer(out!.bytes);
    expect(labels).not.toHaveLength(0);
    expect(labels.join(' ')).toMatch(/Signed:/);
  });
});
