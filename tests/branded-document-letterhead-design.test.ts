import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import type { LetterheadDesign } from '../lib/letterhead-design';

/**
 * The DESIGNED letterhead, on the page.
 *
 * tests/letterhead-design.test.ts pins what the block says and in what order.
 * This pins the two things only the renderer can answer, and both of them are
 * ways the feature fails in production rather than in review.
 *
 * 1. PRECEDENCE. A firm may have uploaded an image and also typed a design.
 *    Drawing both would print the address twice. The image wins, and the only
 *    honest way to assert that is to let the fetch succeed, so it is stubbed
 *    with a real one-pixel PNG rather than mocked away.
 *
 * 2. UNENCODABLE TEXT. pdf-lib's standard fonts do not silently drop a
 *    character WinAnsi cannot encode, they THROW, in the middle of a render,
 *    from inside drawText. A firm name pasted out of a document that carries
 *    one would take down every document the firm produces, and nothing in the
 *    designer stops a person pasting one.
 *
 * The assertions read the finished PDF back through unpdf, which is already a
 * dependency, so they describe the ink rather than the intent.
 */

async function textOf(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const res = await extractText(pdf, { mergePages: true });
  return (Array.isArray(res.text) ? res.text.join('\n') : String(res.text ?? ''))
    // The extractor emits per-glyph spacing that varies with the font metrics.
    // Collapsing runs of whitespace is what makes an assertion about a phrase
    // possible without asserting the kerning too.
    .replace(/\s+/g, ' ');
}

const DESIGN: LetterheadDesign = {
  firmName: 'Hartley and Vance LLP',
  addressLines: ['400 Market Street', 'Philadelphia, PA 19106'],
  phone: '(215) 555 0148',
  email: 'filings@hartleyvance.com',
  website: 'hartleyvance.com',
  admissionsLine: 'Admitted in Pennsylvania and New Jersey',
  alignment: 'left',
  showRule: true,
};

const BODY = 'This agreement is between the parties named below. '.repeat(6);

/** A valid one-pixel PNG, so the image branch can actually be taken. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildBrandedDocumentPdf: the designed letterhead', () => {
  it('draws the design when the firm has no uploaded image', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadDesign: DESIGN,
    });
    expect(out).not.toBeNull();
    const text = await textOf(out!.bytes);
    expect(text).toContain('Hartley and Vance LLP');
    expect(text).toContain('400 Market Street');
    expect(text).toContain('filings@hartleyvance.com');
    expect(text).toContain('Admitted in Pennsylvania and New Jersey');
  });

  it('lets the uploaded image win when the firm has both', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://example.test/letterhead.png',
      letterheadDesign: DESIGN,
    });
    expect(out).not.toBeNull();
    const text = await textOf(out!.bytes);
    expect(text).not.toContain('Hartley and Vance LLP');
    expect(text).not.toContain('400 Market Street');
  });

  it('renders rather than throwing when the design carries a character WinAnsi cannot encode', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadDesign: {
        ...DESIGN,
        firmName: 'Hartley and Vance LLP 律師',
        admissionsLine: '律師',
      },
    });
    expect(out).not.toBeNull();
    const text = await textOf(out!.bytes);
    // The encodable part survives; the rest is dropped rather than guessed at.
    expect(text).toContain('Hartley and Vance LLP');
    // A line that sanitized down to nothing is not drawn as a blank line.
    expect(text).not.toContain('Admitted in Pennsylvania');
  });

  it('keeps the text-only banner for a firm with neither an image nor a design', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      brandName: 'Hartley and Vance LLP',
    });
    expect(out).not.toBeNull();
    const text = await textOf(out!.bytes);
    expect(text).toContain('HARTLEY AND VANCE LLP');
  });
});
