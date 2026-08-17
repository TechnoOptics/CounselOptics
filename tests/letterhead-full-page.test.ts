import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCUMENT_LAYOUT,
  normalizeDocumentLayout,
  resolveLetterheadArt,
  resolveLetterheadBandTop,
  type DocumentLayout,
  type PageSize,
} from '../lib/document-layout';
import {
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
} from '../lib/template-field-boxes';

/**
 * FULL-PAGE STATIONERY.
 *
 * WHAT WAS WRONG. The renderer scaled any letterhead into a 100pt band:
 * `drawW = min(W - 32, art.width * 100 / art.height)`. Fed a full-page sheet that
 * is not a defect of degree, it is a postage stamp: US Letter artwork came out
 * 77x100pt centred at the top of the page, with the address line an unreadable
 * grey smudge, on every page of every document. Measured by rendering it and
 * looking, not inferred. So the band path cannot render full-page stationery, and
 * `fit: 'page'` is the path that can.
 *
 * THE DEFAULT IS THE OLD BEHAVIOUR, EXACTLY. `fit` defaults to 'band', so a firm
 * that sets nothing gets the document it got last week, to the point. Asserted
 * here as arithmetic and in tests/letterhead-pdf-artwork.test.ts as bytes.
 *
 * THE PAGE IS STILL US LETTER, EVERYWHERE. An earlier draft of this work made the
 * page size a per-firm setting, because the first artwork to arrive was A4 on a
 * Letter renderer. Letter artwork was then supplied and that machinery was
 * discarded rather than left half-built. The A4-on-Letter case below is kept as a
 * test because resolveLetterheadArt still has to behave sanely when artwork does
 * not match the page: contain it, never crop or stretch it.
 */

const LETTER: PageSize = {
  widthPt: RENDERED_PAGE_WIDTH_PT,
  heightPt: RENDERED_PAGE_HEIGHT_PT,
};
/** Not a page this product renders. Artwork sized for one, which happens. */
const A4: PageSize = { widthPt: 595.2756, heightPt: 841.8898 };

/** The band numbers the renderer used before any of this was configurable. */
const BAND_TARGET_H = 100;
const BAND_SIDE_INSET = 32;
const BAND_GAP = 24;

function withLetterhead(patch: Record<string, unknown>): DocumentLayout {
  return normalizeDocumentLayout({ letterhead: patch });
}

describe('the page size stayed where it was', () => {
  it('has no page band on a layout, because a firm cannot set one', () => {
    // Pinned deliberately. A `page` key on a stored layout would be read by
    // nothing and would advertise a setting this renderer does not have.
    expect('page' in DEFAULT_DOCUMENT_LAYOUT).toBe(false);
    expect('page' in normalizeDocumentLayout({ page: { widthPt: 595, heightPt: 842 } })).toBe(false);
  });

  it('is US Letter, from the one module that owns it', () => {
    expect(RENDERED_PAGE_WIDTH_PT).toBe(612);
    expect(RENDERED_PAGE_HEIGHT_PT).toBe(792);
  });
});

describe('letterhead fit', () => {
  it('defaults to the band, so no existing firm document moves', () => {
    expect(DEFAULT_DOCUMENT_LAYOUT.letterhead.fit).toBe('band');
  });

  it('accepts page', () => {
    expect(withLetterhead({ fit: 'page' }).letterhead.fit).toBe('page');
  });

  it('falls back to the band for anything that is not a fit', () => {
    expect(withLetterhead({ fit: 'full-bleed' }).letterhead.fit).toBe('band');
    expect(withLetterhead({ fit: 7 }).letterhead.fit).toBe('band');
    expect(withLetterhead({}).letterhead.fit).toBe('band');
  });
});

describe('resolveLetterheadArt in band mode reproduces the renderer it replaces', () => {
  const layout = DEFAULT_DOCUMENT_LAYOUT;

  it('draws a wide strip 100pt tall, centred, and clear of the page edges', () => {
    // A 1000x200 strip: 100pt tall implies 500pt wide, which fits W - 32 = 580.
    const art = resolveLetterheadArt({ layout, page: LETTER, artWidthPt: 1000, artHeightPt: 200 });
    expect(art.heightPt).toBeCloseTo(BAND_TARGET_H, 6);
    expect(art.widthPt).toBeCloseTo(500, 6);
    expect(art.xPt).toBeCloseTo((LETTER.widthPt - 500) / 2, 6);
    const bandTop = resolveLetterheadBandTop(layout, LETTER);
    expect(art.yPt).toBeCloseTo(bandTop - BAND_GAP - art.heightPt, 6);
  });

  it('caps at the full measure for artwork too tall to fit at 100pt', () => {
    // A full page of A4 art: 100pt tall would be 70.7pt wide, well under the cap,
    // so this is the case the OLD code produced a postage stamp for. The width
    // cap only bites for art wider than 5.8:1.
    const art = resolveLetterheadArt({ layout, page: LETTER, artWidthPt: 4000, artHeightPt: 200 });
    expect(art.widthPt).toBeCloseTo(LETTER.widthPt - BAND_SIDE_INSET, 6);
    // Aspect is preserved even at the cap, which is what keeps a logo round.
    expect(art.widthPt / art.heightPt).toBeCloseTo(4000 / 200, 6);
  });

  it('is the postage stamp for full-page art, which is the defect page mode exists for', () => {
    // The delivered Letter stationery, through the band path: 77 x 100 points of
    // a 612 x 792 design. This is the measurement that justifies page mode.
    const art = resolveLetterheadArt({
      layout,
      page: LETTER,
      artWidthPt: LETTER.widthPt,
      artHeightPt: LETTER.heightPt,
    });
    expect(art.heightPt).toBeCloseTo(100, 6);
    expect(art.widthPt).toBeCloseTo(77.27, 2);
  });
});

describe('page mode on the delivered Letter stationery', () => {
  const pageFit = normalizeDocumentLayout({ letterhead: { fit: 'page' } });

  it('is exact full bleed, because the artwork is the page', () => {
    const art = resolveLetterheadArt({
      layout: pageFit,
      page: LETTER,
      artWidthPt: LETTER.widthPt,
      artHeightPt: LETTER.heightPt,
    });
    expect(art).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: LETTER.widthPt,
      heightPt: LETTER.heightPt,
    });
  });
});

describe('resolveLetterheadArt in page mode', () => {
  const pageFit = withLetterhead({ fit: 'page' });

  it('fills the whole page when the artwork was drawn for it', () => {
    const art = resolveLetterheadArt({
      layout: pageFit,
      page: A4,
      artWidthPt: A4.widthPt,
      artHeightPt: A4.heightPt,
    });
    expect(art.xPt).toBeCloseTo(0, 6);
    expect(art.yPt).toBeCloseTo(0, 6);
    expect(art.widthPt).toBeCloseTo(A4.widthPt, 6);
    expect(art.heightPt).toBeCloseTo(A4.heightPt, 6);
  });

  it('never distorts the artwork, because a stretched trademark is a wrong document', () => {
    // The owner's file measures 595.25 x 842 against an ISO A4 page. Nearly but
    // not exactly the same aspect, which is the case a naive full-bleed stretch
    // would silently distort.
    const art = resolveLetterheadArt({
      layout: pageFit,
      page: A4,
      artWidthPt: 595.25,
      artHeightPt: 842,
    });
    expect(art.widthPt / art.heightPt).toBeCloseTo(595.25 / 842, 9);
  });

  it('never crops, and never runs off the page', () => {
    // Letter page, A4 art: the aspects differ by 9%, the case the owner was told
    // not to paint. Contained rather than cropped, so the address line survives.
    const art = resolveLetterheadArt({
      layout: pageFit,
      page: LETTER,
      artWidthPt: 595.25,
      artHeightPt: 842,
    });
    expect(art.widthPt / art.heightPt).toBeCloseTo(595.25 / 842, 9);
    expect(art.xPt).toBeGreaterThanOrEqual(0);
    expect(art.yPt).toBeGreaterThanOrEqual(0);
    expect(art.xPt + art.widthPt).toBeLessThanOrEqual(LETTER.widthPt + 1e-6);
    expect(art.yPt + art.heightPt).toBeLessThanOrEqual(LETTER.heightPt + 1e-6);
    // Height-limited on a Letter page, so it reaches top and bottom and is
    // centred left to right.
    expect(art.heightPt).toBeCloseTo(LETTER.heightPt, 6);
    expect(art.xPt).toBeCloseTo((LETTER.widthPt - art.widthPt) / 2, 6);
  });

  it('centres artwork that is limited by the width instead', () => {
    const art = resolveLetterheadArt({
      layout: pageFit,
      page: LETTER,
      artWidthPt: 1000,
      artHeightPt: 500,
    });
    expect(art.widthPt).toBeCloseTo(LETTER.widthPt, 6);
    expect(art.heightPt).toBeCloseTo(LETTER.widthPt / 2, 6);
    expect(art.yPt).toBeCloseTo((LETTER.heightPt - art.heightPt) / 2, 6);
  });

  it('ignores the band top, because a full page has no band to hang from', () => {
    const pushedDown = normalizeDocumentLayout({ letterhead: { fit: 'page', topPt: 200 } });
    const art = resolveLetterheadArt({
      layout: pushedDown,
      page: A4,
      artWidthPt: A4.widthPt,
      artHeightPt: A4.heightPt,
    });
    expect(art.yPt).toBeCloseTo(0, 6);
    expect(art.heightPt).toBeCloseTo(A4.heightPt, 6);
  });

  it('collapses rather than producing NaN for artwork with no dimensions', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const art = resolveLetterheadArt({
        layout: pageFit,
        page: A4,
        artWidthPt: bad,
        artHeightPt: bad,
      });
      expect(Number.isFinite(art.widthPt)).toBe(true);
      expect(Number.isFinite(art.heightPt)).toBe(true);
      expect(art.widthPt).toBe(0);
      expect(art.heightPt).toBe(0);
    }
  });
});
