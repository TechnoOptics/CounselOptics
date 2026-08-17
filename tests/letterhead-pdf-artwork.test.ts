import { PDFDocument, rgb } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { normalizeDocumentLayout } from '../lib/document-layout';
import {
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
} from '../lib/template-field-boxes';

/**
 * A PDF LETTERHEAD, AND A FAILURE THAT SAYS SO.
 *
 * Firms have their stationery as a PDF, because that is what a designer delivers
 * and what a printer takes. Before this change the upload action allowed only
 * PNG, JPEG and WebP, and a PDF URL forced into firms.letterhead_url anyway went
 * down a worse path than a rejection: the renderer sniffed it, called embedPng,
 * threw, caught, and fell back to the text banner. The firm got a document with
 * no letterhead on it, no error anywhere, and no way to tell that from a firm
 * that had never uploaded one.
 *
 * That is why the failure is now returned. A document that should carry a firm's
 * stationery and does not is a defect the firm has to learn about, not one the
 * renderer papers over. It is still not a THROWN error: a document that renders
 * without its letterhead is recoverable and one that does not render at all is
 * not, which is the same trade every other fallback in this renderer makes.
 *
 * VECTOR, NOT RASTER. embedPdf keeps the artwork as vector. The address line on
 * the real article is about 6.5pt type, which is exactly the size where
 * rasterising shows, and rasterising would also put a canvas rasteriser into a
 * latency-sensitive serverless render path.
 */

const BODY = [
  'This Agreement is entered into as of the date last written below.',
  '',
  'The parties agree to the terms that follow, which are intended to be read as a',
  'single instrument and to survive the completion of the work described in it.',
  '',
  'Each party warrants that it has authority to enter into this Agreement and that',
  'the person signing below is empowered to bind it.',
].join('\n');

/**
 * A full US Letter sheet of "stationery": a coloured band across the head, so it
 * is visibly artwork and visibly full-page. The same shape as the delivered
 * article, which is 612 x 792 with its logo in the top left.
 */
async function letterheadPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([RENDERED_PAGE_WIDTH_PT, RENDERED_PAGE_HEIGHT_PT]);
  page.drawRectangle({
    x: 0,
    y: RENDERED_PAGE_HEIGHT_PT - 150,
    width: RENDERED_PAGE_WIDTH_PT,
    height: 150,
    color: rgb(0.05, 0.2, 0.12),
  });
  return doc.save();
}

async function pngLetterhead(): Promise<Uint8Array> {
  // A 1x1 PNG is a valid image the band path can embed and scale.
  return new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
}

function stubFetch(body: Uint8Array, contentType: string) {
  vi.stubGlobal('fetch', async () =>
    new Response(new Uint8Array(body).buffer as ArrayBuffer, {
      status: 200,
      headers: { 'content-type': contentType },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a PDF letterhead', () => {
  it('is embedded rather than silently dropped', async () => {
    stubFetch(await letterheadPdf(), 'application/pdf');
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/stationery.pdf',
      layout: normalizeDocumentLayout({
        letterhead: { fit: 'page' },
        margins: { topPt: 144 },
      }),
    });
    expect(out).not.toBeNull();
    expect(out?.letterheadError).toBeUndefined();
  });

  it('is recognised by its bytes, not only by the header a CDN happens to send', async () => {
    // Supabase storage serves what it was told at upload time, and an
    // octet-stream is what a mis-tagged upload becomes. The bytes are the truth.
    stubFetch(await letterheadPdf(), 'application/octet-stream');
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/stationery.pdf',
      layout: normalizeDocumentLayout({ letterhead: { fit: 'page' } }),
    });
    expect(out?.letterheadError).toBeUndefined();
  });

  it('renders on US Letter, the page the artwork was drawn for', async () => {
    stubFetch(await letterheadPdf(), 'application/pdf');
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/stationery.pdf',
      layout: normalizeDocumentLayout({
        letterhead: { fit: 'page' },
        margins: { topPt: 144 },
      }),
    });
    const doc = await PDFDocument.load(out!.bytes);
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(RENDERED_PAGE_WIDTH_PT, 2);
    expect(size.height).toBeCloseTo(RENDERED_PAGE_HEIGHT_PT, 2);
  });

  it('records the page size beside every blank it draws', async () => {
    stubFetch(await letterheadPdf(), 'application/pdf');
    const out = await buildBrandedDocumentPdf({
      document: `${BODY}\n\nEntity: _____<<entity_name>>_____`,
      title: 'Mutual Agreement',
      layout: normalizeDocumentLayout({ letterhead: { fit: 'page' } }),
    });
    expect(out!.fieldBoxes.length).toBeGreaterThan(0);
    for (const box of out!.fieldBoxes) {
      expect(box.pageWidthPt).toBeCloseTo(RENDERED_PAGE_WIDTH_PT, 2);
      expect(box.pageHeightPt).toBeCloseTo(RENDERED_PAGE_HEIGHT_PT, 2);
    }
  });
});

describe('a letterhead the renderer cannot use is reported, not swallowed', () => {
  it('names the unsupported type', async () => {
    stubFetch(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20]), 'image/svg+xml');
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/stationery.svg',
    });
    expect(out).not.toBeNull();
    expect(out?.letterheadError).toBeTruthy();
    expect(out?.letterheadError).toMatch(/svg/i);
  });

  it('still produces the document, because a render that fails is worse', async () => {
    stubFetch(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20]), 'image/svg+xml');
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/stationery.svg',
    });
    expect(out!.bytes.length).toBeGreaterThan(1000);
  });

  it('reports a letterhead that could not be fetched at all', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadUrl: 'https://cdn.example.test/gone.png',
    });
    expect(out?.letterheadError).toBeTruthy();
  });

  it('reports nothing when the firm has no letterhead, which is not a failure', async () => {
    const out = await buildBrandedDocumentPdf({ document: BODY, title: 'Mutual Agreement' });
    expect(out?.letterheadError).toBeUndefined();
  });
});

describe('band mode is untouched', () => {
  it('renders identically whether or not the new fields are spelled out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T12:00:00Z'));
    try {
      const png = await pngLetterhead();
      stubFetch(png, 'image/png');
      const implicit = await buildBrandedDocumentPdf({
        document: BODY,
        title: 'Mutual Agreement',
        letterheadUrl: 'https://cdn.example.test/banner.png',
      });
      stubFetch(png, 'image/png');
      const explicit = await buildBrandedDocumentPdf({
        document: BODY,
        title: 'Mutual Agreement',
        letterheadUrl: 'https://cdn.example.test/banner.png',
        layout: normalizeDocumentLayout({ letterhead: { fit: 'band' } }),
      });
      expect(Buffer.from(implicit!.bytes).equals(Buffer.from(explicit!.bytes))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
