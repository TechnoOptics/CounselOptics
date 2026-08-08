import { describe, expect, it } from 'vitest';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  normalizeDocumentLayout,
  resolveDocumentLayout,
} from '../lib/document-layout';

/**
 * The layout, on the page.
 *
 * tests/document-layout.test.ts pins the arithmetic. This pins the two things
 * only the renderer can answer, and both are ways this feature fails in
 * production rather than in review.
 *
 * 1. THE DEFAULT MUST NOT MOVE ANYTHING. A firm that never opens the builder
 *    has to get the document it got last week, to the point, because the
 *    counterparty blanks recorded on every document already out for signature
 *    were measured against those numbers. The field boxes below are the
 *    strongest available statement of that: they are the exact geometry the
 *    live signing overlay and the executed stamp read.
 *
 * 2. THE WATERMARK HAS TO STOP. The owner's rule is DRAFT until signed and
 *    nothing after, and the only honest way to assert it is to render both
 *    states and read the ink back.
 *
 * Read back through unpdf, which is already a dependency, so these describe
 * what is on the page rather than what the code meant.
 */

async function textOf(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const res = await extractText(pdf, { mergePages: true });
  return (Array.isArray(res.text) ? res.text.join('\n') : String(res.text ?? ''))
    .replace(/\s+/g, ' ');
}

const BODY =
  'This agreement is between the parties named below and takes effect on the date last signed. '.repeat(
    8,
  );

/** Long enough to run over onto a second and third page. */
const LONG_BODY = BODY.repeat(12);

const FIELD_BODY = [
  'The company legal name is _____<<company_legal_name>>_____ and its address',
  'is _____<<company_address>>_____ for all notices under this agreement.',
  BODY,
].join('\n');

describe('the layout the renderer had before it was configurable', () => {
  it('puts the counterparty blanks in exactly the same place with the default layout as without one', async () => {
    // THE RENDER-ONCE CONTRACT, asserted at the one place it can be measured.
    // These coordinates are recorded on the submission at first render and
    // read back by the live signing overlay and by the stamp on the executed
    // PDF. A default layout that shifted them by a point would mean every
    // document rendered after this change disagreed with every document
    // rendered before it.
    const before = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
    });
    const after = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
      layout: DEFAULT_DOCUMENT_LAYOUT,
    });
    expect(before?.fieldBoxes.length).toBeGreaterThan(0);
    expect(after?.fieldBoxes).toEqual(before?.fieldBoxes);
  });

  it('starts the blanks at the 64pt left margin the renderer always used', async () => {
    const out = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
    });
    expect(out?.fieldBoxes[0].x).toBeGreaterThan(64);
    expect(out?.fieldBoxes.every((b) => b.x >= 64)).toBe(true);
  });

  it('still draws the footer it always drew', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      brandName: 'Hartley and Vance LLP',
    });
    const text = await textOf(out!.bytes);
    expect(text).toContain('Page 1');
    expect(text).toContain('Hartley and Vance LLP');
  });

  it('draws no watermark, because no document carried one before', async () => {
    const out = await buildBrandedDocumentPdf({ document: BODY, title: 'Mutual Agreement' });
    expect(await textOf(out!.bytes)).not.toContain('DRAFT');
  });
});

describe('the margins move the body, and only for a render that has not happened yet', () => {
  it('moves the blanks when the firm widens its margins', async () => {
    const wide = normalizeDocumentLayout({ margins: { leftPt: 120 } });
    const out = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
      layout: wide,
    });
    expect(out?.fieldBoxes[0].x).toBeGreaterThan(120);
    const narrow = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
    });
    expect(out!.fieldBoxes[0].x).toBeGreaterThan(narrow!.fieldBoxes[0].x);
  });

  it('keeps every blank inside the measure it was given', async () => {
    const wide = normalizeDocumentLayout({ margins: { leftPt: 120, rightPt: 120 } });
    const out = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
      layout: wide,
    });
    for (const box of out!.fieldBoxes) {
      expect(box.x).toBeGreaterThanOrEqual(120);
      expect(box.x + box.widthPt).toBeLessThanOrEqual(612 - 120 + 0.001);
    }
  });
});

describe('the watermark, and the rule that makes it stop', () => {
  const layout = normalizeDocumentLayout({ watermark: { show: true } });

  it('says DRAFT across an unsigned document', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      layout,
      state: 'unsigned',
    });
    expect(await textOf(out!.bytes)).toContain('DRAFT');
  });

  it('says nothing at all once the document is signed', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      layout,
      state: 'signed',
    });
    expect(await textOf(out!.bytes)).not.toContain('DRAFT');
  });

  it('marks every page of a long unsigned document', async () => {
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      layout,
      state: 'unsigned',
    });
    const text = await textOf(out!.bytes);
    expect(text).toContain('Page 3');
    expect(text.split('DRAFT').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('marks only the first page when the firm asks for that', async () => {
    const firstOnly = normalizeDocumentLayout({
      watermark: { show: true, pages: 'first' },
    });
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      layout: firstOnly,
      state: 'unsigned',
    });
    expect((await textOf(out!.bytes)).split('DRAFT').length - 1).toBe(1);
  });

  it('draws the firm text for a downloaded copy when the firm asked for one', async () => {
    const copyMark = normalizeDocumentLayout({
      watermark: { show: true, states: ['copy'], text: { copy: 'COPY' } },
    });
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      layout: copyMark,
      state: 'copy',
    });
    expect(await textOf(out!.bytes)).toContain('COPY');
  });

  it('does not let an unprintable watermark take the whole document down', async () => {
    // pdf-lib's standard fonts do not drop a character WinAnsi cannot encode,
    // they THROW from inside drawText. A watermark of Cyrillic would otherwise
    // take down every document the firm produces.
    const cyrillic = normalizeDocumentLayout({
      watermark: { show: true, text: { unsigned: 'ЧЕРНОВИК' } },
    });
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      layout: cyrillic,
      state: 'unsigned',
    });
    expect(out).not.toBeNull();
    expect(await textOf(out!.bytes)).toContain('Page 1');
  });

  it('does not move a single counterparty blank', async () => {
    // The watermark is drawn behind the body and advances no cursor. If it
    // moved a blank, the overlay and the stamp would be reading a geometry
    // that no longer describes the page.
    const plain = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
    });
    const marked = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
      layout,
      state: 'unsigned',
    });
    expect(marked?.fieldBoxes).toEqual(plain?.fieldBoxes);
  });
});

describe('the footer', () => {
  it('carries the fixed firm text the firm typed', async () => {
    const layout = normalizeDocumentLayout({
      footer: { text: 'Privileged and confidential', generatedDate: false },
    });
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      brandName: 'Hartley and Vance LLP',
      layout,
    });
    const text = await textOf(out!.bytes);
    expect(text).toContain('Privileged and confidential');
    expect(text).not.toContain('Generated');
  });

  it('can be switched off entirely', async () => {
    const layout = normalizeDocumentLayout({ footer: { show: false } });
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      brandName: 'Hartley and Vance LLP',
      layout,
    });
    expect(await textOf(out!.bytes)).not.toContain('Page 1');
  });

  it('drops a character the PDF fonts cannot print rather than throwing', async () => {
    const layout = normalizeDocumentLayout({
      footer: { text: 'Конфиденциально and confidential', generatedDate: false },
    });
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      layout,
    });
    expect(out).not.toBeNull();
    expect(await textOf(out!.bytes)).toContain('and confidential');
  });

  it('keeps off the first page when the firm asks for that', async () => {
    const layout = normalizeDocumentLayout({ footer: { pages: 'all_except_first' } });
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      layout,
    });
    const text = await textOf(out!.bytes);
    expect(text).not.toContain('Page 1');
    expect(text).toContain('Page 2');
  });
});

describe('the letterhead band', () => {
  const design = {
    firmName: 'Hartley and Vance LLP',
    addressLines: ['400 Market Street', 'Philadelphia, PA 19106'],
    phone: '',
    email: '',
    website: '',
    admissionsLine: '',
    alignment: 'left' as const,
    showRule: true,
  };

  it('repeats on every page by default, as it always did', async () => {
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      letterheadDesign: design,
    });
    const text = await textOf(out!.bytes);
    expect(text.split('400 Market Street').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('appears on the first page only when the firm asks for that', async () => {
    const layout = normalizeDocumentLayout({ letterhead: { pages: 'first' } });
    const out = await buildBrandedDocumentPdf({
      document: LONG_BODY,
      title: 'Mutual Agreement',
      letterheadDesign: design,
      layout,
    });
    expect((await textOf(out!.bytes)).split('400 Market Street').length - 1).toBe(1);
  });

  it('is gone entirely when the firm switches the band off', async () => {
    const layout = normalizeDocumentLayout({ letterhead: { show: false } });
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Mutual Agreement',
      letterheadDesign: design,
      layout,
    });
    const text = await textOf(out!.bytes);
    expect(text).not.toContain('400 Market Street');
    // The body is still there. A band switched off is not a document lost.
    expect(text).toContain('Mutual Agreement');
  });
});

describe('the body floor is now the bottom margin, and everything that read 60 reads it', () => {
  /**
   * The other side's execution block, in the exact form
   * findCounterpartyBlockLine recognises. It is reserved as one unit so that
   * "Signature:" never ends a page with the "Date:" it belongs to at the head
   * of the next, on an agreement a company is being asked to execute.
   *
   * That reservation compared against a hardcoded 60 before the floor became
   * configurable. A firm setting a deep bottom margin would otherwise get the
   * block split again, which is the defect the reservation was added for.
   */
  const blockBody = (filler: string) =>
    [filler, '', 'For Northwind Materials LLC:', 'Signature:', 'Date:'].join('\n');

  async function splitAt(bottomPt: number, lines: number): Promise<boolean> {
    const filler = 'This clause continues at some length and takes one line. '.repeat(lines);
    const out = await buildBrandedDocumentPdf({
      document: blockBody(filler),
      title: 'Mutual Agreement',
      layout: normalizeDocumentLayout({ margins: { bottomPt } }),
    });
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(out!.bytes));
    const res = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(res.text) ? res.text : [String(res.text)]).map((p) =>
      String(p).replace(/\s+/g, ' '),
    );
    const head = pages.findIndex((p) => p.includes('For Northwind Materials LLC'));
    const tail = pages.findIndex((p) => p.includes('Date:'));
    return head !== tail;
  }

  /**
   * Swept rather than tuned to one length, and that is the difference between a
   * test and a coincidence. The block only splits when its head lands in the
   * one lead-height window just above the floor, so a single hand-picked filler
   * passes whether or not the reservation reads the floor at all. The first
   * version of this test did exactly that and survived the mutation it was
   * written to catch. This walks the block across the window.
   *
   * Verified by mutation: putting the old literal 60 back in the reservation,
   * while the page break itself still reads the configured floor, splits the
   * block at two of these lengths.
   */
  it('keeps the execution block together at every distance from a deep floor', async () => {
    const split: number[] = [];
    for (let lines = 42; lines <= 56; lines += 2) {
      if (await splitAt(200, lines)) split.push(lines);
    }
    expect(split).toEqual([]);
  });

  it('starts a new page sooner when the firm sets a deeper bottom margin', async () => {
    const long = 'This clause continues at some length and takes a line. '.repeat(60);
    const shallow = await buildBrandedDocumentPdf({
      document: long,
      title: 'Mutual Agreement',
      layout: normalizeDocumentLayout({ margins: { bottomPt: 18 } }),
    });
    const deep = await buildBrandedDocumentPdf({
      document: long,
      title: 'Mutual Agreement',
      layout: normalizeDocumentLayout({ margins: { bottomPt: 200 } }),
    });
    const pagesOf = async (bytes: Uint8Array) => {
      const { getDocumentProxy } = await import('unpdf');
      return (await getDocumentProxy(new Uint8Array(bytes))).numPages;
    };
    expect(await pagesOf(deep!.bytes)).toBeGreaterThan(await pagesOf(shallow!.bytes));
  });
});

describe('a template override reaches the page', () => {
  it('lays the document out on the merged layout, not on either half', async () => {
    const layout = resolveDocumentLayout(
      { margins: { leftPt: 120 }, footer: { text: 'Hartley and Vance LLP', generatedDate: false } },
      { watermark: { show: true } },
    );
    const out = await buildBrandedDocumentPdf({
      document: FIELD_BODY,
      title: 'Mutual Agreement',
      layout,
      state: 'unsigned',
    });
    const text = await textOf(out!.bytes);
    expect(text).toContain('DRAFT');
    expect(text).toContain('Hartley and Vance LLP');
    expect(out!.fieldBoxes[0].x).toBeGreaterThan(120);
  });
});
