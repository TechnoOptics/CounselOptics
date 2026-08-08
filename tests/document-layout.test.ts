import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  DOCUMENT_LAYOUT_METADATA_KEY,
  DOCUMENT_STATES,
  bandAppearsOnPage,
  composeFooterText,
  firmDocumentLayoutInput,
  normalizeDocumentLayout,
  resolveContentBox,
  resolveDocumentLayout,
  resolveFooterPlacement,
  resolveLetterheadBandTop,
  resolveWatermark,
  resolveWatermarkPlacement,
} from '../lib/document-layout';

/**
 * The page the renderer lays out. Imported rather than written out, because a
 * second copy of the page size is the drift lib/template-field-boxes.ts exists
 * to prevent, and lib/document-layout.ts deliberately takes the page as an
 * argument rather than declaring one of its own.
 */
import {
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
} from '../lib/template-field-boxes';

const PAGE = {
  widthPt: RENDERED_PAGE_WIDTH_PT,
  heightPt: RENDERED_PAGE_HEIGHT_PT,
};

describe('the default layout is the layout the renderer already had', () => {
  // These numbers are not preferences. They are what lib/branded-document-pdf.ts
  // drew before this module existed: M = 64 either side, a body floor at 60,
  // a footer baseline at 36, and a letterhead band flush to the top of every
  // page. A firm that never opens the builder must get the document it got
  // last week, down to the point, because the counterparty blanks recorded on
  // documents already out for signature were measured against these numbers.
  it('keeps the 64pt side margins', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.margins.leftPt).toBe(64);
    expect(DEFAULT_DOCUMENT_LAYOUT.margins.rightPt).toBe(64);
  });

  it('keeps the 60pt body floor and the 64pt top margin', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.margins.bottomPt).toBe(60);
    expect(DEFAULT_DOCUMENT_LAYOUT.margins.topPt).toBe(64);
  });

  it('keeps the letterhead band on every page, flush to the top edge', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.letterhead.show).toBe(true);
    expect(DEFAULT_DOCUMENT_LAYOUT.letterhead.pages).toBe('all');
    expect(DEFAULT_DOCUMENT_LAYOUT.letterhead.topPt).toBe(0);
  });

  it('keeps the footer that was always there', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.show).toBe(true);
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.pages).toBe('all');
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.align).toBe('left');
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.baselinePt).toBe(36);
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.pageNumbers).toBe(true);
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.generatedDate).toBe(true);
    expect(DEFAULT_DOCUMENT_LAYOUT.footer.text).toBe('');
  });

  it('leaves the watermark off, because no document carried one before', () => {
    // Turning it on by default would stamp DRAFT across every firm's next
    // document without anybody asking for it.
    expect(DEFAULT_DOCUMENT_LAYOUT.watermark.show).toBe(false);
  });

  it('still carries the owner rule ready for the moment it is switched on', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.watermark.states).toEqual(['unsigned']);
    expect(DEFAULT_DOCUMENT_LAYOUT.watermark.text.unsigned).toBe('DRAFT');
    expect(DEFAULT_DOCUMENT_LAYOUT.watermark.text.signed).toBe('');
  });
});

describe('normalizeDocumentLayout is the trust boundary over the jsonb', () => {
  it('returns the default layout for anything that is not an object', () => {
    for (const junk of [null, undefined, 'layout', 7, [], true]) {
      expect(normalizeDocumentLayout(junk)).toEqual(DEFAULT_DOCUMENT_LAYOUT);
    }
  });

  it('clamps a margin that would run off the page', () => {
    const layout = normalizeDocumentLayout({ margins: { leftPt: 900 } });
    expect(layout.margins.leftPt).toBeLessThanOrEqual(216);
    expect(layout.margins.leftPt).toBeGreaterThan(0);
  });

  it('clamps a negative margin up to the floor', () => {
    expect(normalizeDocumentLayout({ margins: { topPt: -40 } }).margins.topPt).toBe(18);
  });

  it('clamps an opacity of 4 into the visible range', () => {
    const watermark = normalizeDocumentLayout({ watermark: { opacity: 4 } }).watermark;
    expect(watermark.opacity).toBeGreaterThan(0);
    expect(watermark.opacity).toBeLessThanOrEqual(0.6);
  });

  it('refuses a NaN and keeps the default', () => {
    expect(normalizeDocumentLayout({ watermark: { opacity: NaN } }).watermark.opacity).toBe(
      DEFAULT_DOCUMENT_LAYOUT.watermark.opacity,
    );
    expect(
      normalizeDocumentLayout({ margins: { leftPt: Number.POSITIVE_INFINITY } }).margins.leftPt,
    ).toBe(64);
  });

  it('refuses a number that arrived as a string', () => {
    // A stored "64" is not a margin, it is a value some other writer put in a
    // shared bag. Coercing it would make this boundary guess.
    expect(normalizeDocumentLayout({ margins: { leftPt: '90' } }).margins.leftPt).toBe(64);
  });

  it('clamps a rotation to a quarter turn either way', () => {
    expect(normalizeDocumentLayout({ watermark: { rotationDeg: 400 } }).watermark.rotationDeg).toBe(90);
    expect(normalizeDocumentLayout({ watermark: { rotationDeg: -400 } }).watermark.rotationDeg).toBe(-90);
  });

  it('drops a page rule it does not recognise', () => {
    expect(normalizeDocumentLayout({ letterhead: { pages: 'every-other' } }).letterhead.pages).toBe(
      'all',
    );
  });

  it('drops a watermark state it does not recognise, and keeps the ones it does', () => {
    const states = normalizeDocumentLayout({
      watermark: { states: ['signed', 'shredded', 'unsigned', 'unsigned'] },
    }).watermark.states;
    expect(states).toEqual(['unsigned', 'signed']);
  });

  it('accepts an empty state list, which is how a firm silences the watermark', () => {
    expect(normalizeDocumentLayout({ watermark: { states: [] } }).watermark.states).toEqual([]);
  });

  it('caps the watermark and footer text rather than letting a paragraph through', () => {
    const long = 'x'.repeat(500);
    const layout = normalizeDocumentLayout({
      watermark: { text: { unsigned: long } },
      footer: { text: long },
    });
    expect(layout.watermark.text.unsigned.length).toBe(40);
    expect(layout.footer.text.length).toBe(120);
  });

  it('collapses a newline in the footer text, which a single drawText would eat', () => {
    // The same defect the letterhead normalizer was fixed for: the PDF draws
    // one line with one call, where a newline vanishes, while the preview
    // collapses it to a space. Two surfaces, two different strings.
    expect(normalizeDocumentLayout({ footer: { text: 'Privileged\nand confidential' } }).footer.text).toBe(
      'Privileged and confidential',
    );
  });

  it('is idempotent, so a stored layout read back is the layout that was stored', () => {
    const once = normalizeDocumentLayout({
      margins: { leftPt: 90 },
      watermark: { show: true, opacity: 0.2, text: { unsigned: 'DRAFT COPY' } },
    });
    expect(normalizeDocumentLayout(once)).toEqual(once);
  });
});

describe('resolveDocumentLayout: firm default, partial template override', () => {
  const firm = {
    margins: { leftPt: 90, rightPt: 90 },
    footer: { text: 'Privileged and confidential' },
  };

  it('uses the firm default when the template says nothing', () => {
    const layout = resolveDocumentLayout(firm, null);
    expect(layout.margins.leftPt).toBe(90);
    expect(layout.footer.text).toBe('Privileged and confidential');
  });

  it('inherits the firm margins and footer when the template sets only the watermark', () => {
    // The whole point of a PARTIAL override. A template that names one band
    // must not reset the other three to the product default.
    const layout = resolveDocumentLayout(firm, { watermark: { show: true } });
    expect(layout.margins.leftPt).toBe(90);
    expect(layout.footer.text).toBe('Privileged and confidential');
    expect(layout.watermark.show).toBe(true);
  });

  it('lets the template override one field of a band the firm also set', () => {
    const layout = resolveDocumentLayout(firm, { footer: { align: 'center' } });
    expect(layout.footer.align).toBe('center');
    expect(layout.footer.text).toBe('Privileged and confidential');
  });

  it('lets the template switch a band off entirely', () => {
    // PINNED DECISION. `show` is an ordinary field, so a template that sets it
    // false wins over a firm that set it true. The alternative, an override
    // that can only add and never remove, would mean a firm could never have
    // one template without the footer, and there is no way to express "off"
    // that an additive merge would honour.
    const layout = resolveDocumentLayout({ footer: { show: true } }, { footer: { show: false } });
    expect(layout.footer.show).toBe(false);
  });

  it('lets the template silence a watermark the firm switched on', () => {
    const layout = resolveDocumentLayout(
      { watermark: { show: true } },
      { watermark: { states: [] } },
    );
    expect(resolveWatermark(layout, 'unsigned')).toBeNull();
  });

  it('normalizes the merged result, not the two halves separately', () => {
    // A firm margin of 90 and a template margin of 900 must come out clamped,
    // not come out as 90 because the template half was thrown away.
    const layout = resolveDocumentLayout(firm, { margins: { leftPt: 900 } });
    expect(layout.margins.leftPt).toBe(216);
  });

  it('does not let a template array be merged element by element', () => {
    const layout = resolveDocumentLayout(
      { watermark: { states: ['unsigned', 'signed'] } },
      { watermark: { states: ['copy'] } },
    );
    expect(layout.watermark.states).toEqual(['copy']);
  });

  it('ignores an override that is not an object', () => {
    expect(resolveDocumentLayout(firm, 'off').margins.leftPt).toBe(90);
  });
});

describe('firmDocumentLayoutInput reads one key out of the shared metadata bag', () => {
  it('finds the value under the one spelled key', () => {
    const value = { margins: { leftPt: 80 } };
    const metadata = { ticket_prefix: 'ZIN', [DOCUMENT_LAYOUT_METADATA_KEY]: value };
    expect(firmDocumentLayoutInput(metadata)).toBe(value);
  });

  it('returns null for a firm that has never configured one', () => {
    expect(firmDocumentLayoutInput({ ticket_prefix: 'ZIN' })).toBeNull();
    expect(firmDocumentLayoutInput(null)).toBeNull();
    expect(firmDocumentLayoutInput('metadata')).toBeNull();
  });
});

describe('resolveWatermark: the state rule the owner chose', () => {
  const on = normalizeDocumentLayout({ watermark: { show: true } });

  it('says DRAFT while the document is unsigned', () => {
    expect(resolveWatermark(on, 'unsigned')?.text).toBe('DRAFT');
  });

  it('says nothing once the document is signed', () => {
    expect(resolveWatermark(on, 'signed')).toBeNull();
  });

  it('says nothing on a downloaded copy unless the firm asks for it', () => {
    expect(resolveWatermark(on, 'copy')).toBeNull();
    const withCopy = normalizeDocumentLayout({
      watermark: { show: true, states: ['unsigned', 'copy'], text: { copy: 'COPY' } },
    });
    expect(resolveWatermark(withCopy, 'copy')?.text).toBe('COPY');
  });

  it('says nothing at all when the watermark is switched off', () => {
    expect(resolveWatermark(DEFAULT_DOCUMENT_LAYOUT, 'unsigned')).toBeNull();
  });

  it('says nothing for a state the firm did not list', () => {
    const layout = normalizeDocumentLayout({ watermark: { show: true, states: ['signed'] } });
    expect(resolveWatermark(layout, 'unsigned')).toBeNull();
  });

  it('says nothing for a listed state with no text behind it', () => {
    // A state on the list with an empty string is a control with nothing
    // behind it. Drawing an empty run at 8 percent opacity is not a watermark.
    const layout = normalizeDocumentLayout({
      watermark: { show: true, states: ['signed'], text: { signed: '' } },
    });
    expect(resolveWatermark(layout, 'signed')).toBeNull();
  });

  it('draws the firm logo for a listed state when that is the chosen source', () => {
    const layout = normalizeDocumentLayout({
      watermark: { show: true, source: 'logo', states: ['unsigned'], text: { unsigned: '' } },
    });
    const mark = resolveWatermark(layout, 'unsigned');
    expect(mark?.source).toBe('logo');
  });

  it('carries the opacity and rotation through to the caller', () => {
    const layout = normalizeDocumentLayout({
      watermark: { show: true, opacity: 0.3, rotationDeg: 45 },
    });
    const mark = resolveWatermark(layout, 'unsigned');
    expect(mark?.opacity).toBe(0.3);
    expect(mark?.rotationDeg).toBe(45);
  });

  it('names every state the product models', () => {
    expect(DOCUMENT_STATES).toEqual(['unsigned', 'signed', 'copy']);
  });
});

describe('bandAppearsOnPage', () => {
  it('puts a first-page band on page one only', () => {
    expect(bandAppearsOnPage('first', 1)).toBe(true);
    expect(bandAppearsOnPage('first', 2)).toBe(false);
  });

  it('puts an all-pages band on every page', () => {
    expect(bandAppearsOnPage('all', 1)).toBe(true);
    expect(bandAppearsOnPage('all', 9)).toBe(true);
  });

  it('keeps a continuation band off page one', () => {
    expect(bandAppearsOnPage('all_except_first', 1)).toBe(false);
    expect(bandAppearsOnPage('all_except_first', 2)).toBe(true);
  });
});

describe('resolveContentBox is the one place the measure is computed', () => {
  it('reproduces the measure the renderer used before it was configurable', () => {
    const box = resolveContentBox(DEFAULT_DOCUMENT_LAYOUT, PAGE);
    expect(box.xPt).toBe(64);
    expect(box.widthPt).toBe(RENDERED_PAGE_WIDTH_PT - 128);
    expect(box.rightXPt).toBe(RENDERED_PAGE_WIDTH_PT - 64);
    expect(box.topYPt).toBe(RENDERED_PAGE_HEIGHT_PT - 64);
    expect(box.bottomYPt).toBe(60);
  });

  it('keeps a positive measure even when the margins do not fit the page', () => {
    // Not reachable through the normalizer on a Letter page, but the page is
    // an argument and a caller may hand this a narrow one. A zero or negative
    // measure would make the renderer's word wrap loop forever.
    const layout = normalizeDocumentLayout({ margins: { leftPt: 216, rightPt: 216 } });
    const box = resolveContentBox(layout, { widthPt: 300, heightPt: 300 });
    expect(box.widthPt).toBeGreaterThan(0);
    expect(box.topYPt).toBeGreaterThan(box.bottomYPt);
  });

  it('collapses to nothing rather than producing NaN on a page that is not a page', () => {
    const box = resolveContentBox(DEFAULT_DOCUMENT_LAYOUT, { widthPt: 0, heightPt: NaN });
    expect(Number.isFinite(box.widthPt)).toBe(true);
    expect(box.widthPt).toBe(0);
  });
});

describe('resolveLetterheadBandTop', () => {
  it('leaves the band flush to the top edge by default', () => {
    expect(resolveLetterheadBandTop(DEFAULT_DOCUMENT_LAYOUT, PAGE)).toBe(RENDERED_PAGE_HEIGHT_PT);
  });

  it('drops the band down the page by the offset the firm set', () => {
    const layout = normalizeDocumentLayout({ letterhead: { topPt: 24 } });
    expect(resolveLetterheadBandTop(layout, PAGE)).toBe(RENDERED_PAGE_HEIGHT_PT - 24);
  });
});

describe('resolveWatermarkPlacement', () => {
  const layout = normalizeDocumentLayout({ watermark: { show: true, rotationDeg: 0 } });

  /**
   * The watermark is centred on the MEASURE, not on the sheet.
   *
   * The two differ by a point here, because the default top margin is 64 and
   * the default body floor is 60. They differ a great deal for a firm that sets
   * a three inch top margin, and the measure is the right answer there: a mark
   * centred on the sheet would sit high in the body text it is supposed to sit
   * behind. One rule for all six positions, rather than margins for the edges
   * and the sheet for the middle.
   */
  const CENTRE_X = (64 + (RENDERED_PAGE_WIDTH_PT - 64)) / 2;
  const CENTRE_Y = (RENDERED_PAGE_HEIGHT_PT - 64 + 60) / 2;

  it('centres an unrotated mark on the measure', () => {
    const at = resolveWatermarkPlacement({
      layout,
      page: PAGE,
      markWidthPt: 100,
      markHeightPt: 20,
    });
    expect(at.xPt).toBeCloseTo(CENTRE_X - 50, 6);
    expect(at.yPt).toBeCloseTo(CENTRE_Y - 10, 6);
  });

  it('centres a quarter-turned mark on the same point', () => {
    // pdf-lib rotates a text run about its own anchor, so the anchor for a
    // rotated mark is not the anchor for an upright one. Getting this wrong
    // does not throw: it slides the watermark off the corner of the page,
    // which is exactly the kind of defect a green test suite misses and a
    // rendered page shows.
    const turned = normalizeDocumentLayout({ watermark: { show: true, rotationDeg: 90 } });
    const at = resolveWatermarkPlacement({
      layout: turned,
      page: PAGE,
      markWidthPt: 100,
      markHeightPt: 20,
    });
    expect(at.xPt).toBeCloseTo(CENTRE_X + 10, 6);
    expect(at.yPt).toBeCloseTo(CENTRE_Y - 50, 6);
  });

  it('sits the mark against the left margin when the firm asks for left', () => {
    const left = normalizeDocumentLayout({
      watermark: { show: true, rotationDeg: 0, align: 'left' },
    });
    const at = resolveWatermarkPlacement({
      layout: left,
      page: PAGE,
      markWidthPt: 100,
      markHeightPt: 20,
    });
    expect(at.xPt).toBeCloseTo(64, 6);
  });

  it('sits the mark against the right margin when the firm asks for right', () => {
    const right = normalizeDocumentLayout({
      watermark: { show: true, rotationDeg: 0, align: 'right' },
    });
    const at = resolveWatermarkPlacement({
      layout: right,
      page: PAGE,
      markWidthPt: 100,
      markHeightPt: 20,
    });
    expect(at.xPt).toBeCloseTo(RENDERED_PAGE_WIDTH_PT - 64 - 100, 6);
  });

  it('sits the mark under the top margin when the firm anchors it to the top', () => {
    const top = normalizeDocumentLayout({
      watermark: { show: true, rotationDeg: 0, anchor: 'top' },
    });
    const at = resolveWatermarkPlacement({
      layout: top,
      page: PAGE,
      markWidthPt: 100,
      markHeightPt: 20,
    });
    expect(at.yPt).toBeCloseTo(RENDERED_PAGE_HEIGHT_PT - 64 - 20, 6);
  });

  it('never hands the renderer a NaN coordinate', () => {
    const at = resolveWatermarkPlacement({
      layout,
      page: PAGE,
      markWidthPt: Number.NaN,
      markHeightPt: -3,
    });
    expect(Number.isFinite(at.xPt)).toBe(true);
    expect(Number.isFinite(at.yPt)).toBe(true);
  });
});

describe('resolveFooterPlacement', () => {
  it('reproduces the footer the renderer already drew', () => {
    const at = resolveFooterPlacement({
      layout: DEFAULT_DOCUMENT_LAYOUT,
      page: PAGE,
      textWidthPt: 200,
    });
    expect(at.xPt).toBe(64);
    expect(at.yPt).toBe(36);
  });

  it('centres the footer within the measure', () => {
    const layout = normalizeDocumentLayout({ footer: { align: 'center' } });
    const at = resolveFooterPlacement({ layout, page: PAGE, textWidthPt: 200 });
    expect(at.xPt).toBeCloseTo(64 + (RENDERED_PAGE_WIDTH_PT - 128 - 200) / 2, 6);
  });

  it('ends a right-aligned footer at the right margin', () => {
    const layout = normalizeDocumentLayout({ footer: { align: 'right' } });
    const at = resolveFooterPlacement({ layout, page: PAGE, textWidthPt: 200 });
    expect(at.xPt).toBeCloseTo(RENDERED_PAGE_WIDTH_PT - 64 - 200, 6);
  });

  it('never lets a wide footer start left of the margin', () => {
    const layout = normalizeDocumentLayout({ footer: { align: 'right' } });
    const at = resolveFooterPlacement({ layout, page: PAGE, textWidthPt: 9000 });
    expect(at.xPt).toBe(64);
  });
});

describe('composeFooterText', () => {
  const on = '2026-08-08';

  it('reproduces the line the renderer already drew', () => {
    expect(
      composeFooterText({
        layout: DEFAULT_DOCUMENT_LAYOUT,
        brandName: 'Hartley and Vance LLP',
        pageNo: 3,
        generatedOn: on,
      }),
    ).toBe('Hartley and Vance LLP  -  Generated 2026-08-08  -  Page 3');
  });

  it('puts the firm fixed text in place of the brand name', () => {
    const layout = normalizeDocumentLayout({
      footer: { text: 'Privileged and confidential', generatedDate: false },
    });
    expect(
      composeFooterText({ layout, brandName: 'Hartley and Vance LLP', pageNo: 1, generatedOn: on }),
    ).toBe('Privileged and confidential  -  Page 1');
  });

  it('drops the page number when the firm does not want one', () => {
    const layout = normalizeDocumentLayout({
      footer: { pageNumbers: false, generatedDate: false },
    });
    expect(
      composeFooterText({ layout, brandName: 'Hartley and Vance LLP', pageNo: 2, generatedOn: on }),
    ).toBe('Hartley and Vance LLP');
  });

  it('returns nothing when there is nothing left to say', () => {
    // Rather than a lone separator, which is what the letterhead contact line
    // did before it was composed from cleaned fields.
    const layout = normalizeDocumentLayout({
      footer: { pageNumbers: false, generatedDate: false },
    });
    expect(composeFooterText({ layout, brandName: '', pageNo: 1, generatedOn: on })).toBe('');
  });
});
