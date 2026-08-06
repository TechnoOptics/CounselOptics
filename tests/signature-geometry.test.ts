import { describe, it, expect } from 'vitest';
import {
  computeSignatureBoxRect,
  resolveSignaturePageIndex,
  SIGNATURE_BOX_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_CAPTION_BAND_PT,
  SIGNATURE_DEFAULT_FRACTION,
} from '../lib/signature-geometry';

/**
 * Geometry for the executed-PDF signature stamp.
 *
 * The defect these cover: signature-render.ts bounded the 0-1 POSITION
 * FRACTION but never the resulting 220 x 64 point BOX, so any anchor
 * past x = 1 - 220/pageWidth had its overflow silently dropped by
 * pdf-lib and the signature was partly or wholly missing from the
 * executed instrument.
 *
 * The numbers in the overflow table below are the ones from the bug
 * report, recomputed here from the constants rather than transcribed,
 * so the test fails if the box size ever changes without the report
 * being revisited.
 */

const LETTER = { pageWidthPt: 612, pageHeightPt: 792 };
const A4_LANDSCAPE = { pageWidthPt: 842, pageHeightPt: 595 };

describe('computeSignatureBoxRect: horizontal clamp', () => {
  it('leaves an anchor that already fits exactly where it was asked for', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.1,
      positionY: 0.1,
      ...LETTER,
    });
    expect(rect.x).toBe(61.2);
    expect(rect.y).toBeCloseTo(79.2, 10);
    expect(rect.relocated).toBe(false);
    expect(rect.shrunk).toBe(false);
    expect(rect.dxPt).toBe(0);
    expect(rect.dyPt).toBe(0);
  });

  it.each([
    // [positionX, page width, un-clamped right edge, overflow]
    [0.7, 612, 648.4, 36.4],
    [0.75, 612, 679, 67],
    [0.95, 612, 801.4, 189.4],
  ])(
    'keeps a %s anchor on a %s pt page that would otherwise run to %s pt',
    (positionX, pageWidthPt, unclampedRight, overflow) => {
      const rect = computeSignatureBoxRect({
        positionX,
        positionY: 0.5,
        pageWidthPt,
        pageHeightPt: 792,
      });
      // The bug report's arithmetic, reproduced.
      expect(rect.requestedX + SIGNATURE_BOX_WIDTH_PT).toBeCloseTo(
        unclampedRight,
        10,
      );
      expect(rect.requestedX + SIGNATURE_BOX_WIDTH_PT - pageWidthPt).toBeCloseTo(
        overflow,
        10,
      );
      // The fix: the drawn box is fully on the page.
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(pageWidthPt);
      expect(rect.x).toBe(pageWidthPt - SIGNATURE_BOX_WIDTH_PT);
      expect(rect.relocated).toBe(true);
      expect(rect.dxPt).toBeCloseTo(-overflow, 10);
    },
  );

  it('clamps on A4 landscape, where the page width is not 612', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.95,
      positionY: 0.5,
      ...A4_LANDSCAPE,
    });
    expect(rect.requestedX).toBeCloseTo(799.9, 10);
    expect(rect.x).toBe(842 - SIGNATURE_BOX_WIDTH_PT);
    expect(rect.x + rect.width).toBeLessThanOrEqual(842);
  });

  it('pins the box flush to the right edge at the extreme, not off it', () => {
    const rect = computeSignatureBoxRect({
      positionX: 1,
      positionY: 0.5,
      ...LETTER,
    });
    expect(rect.x + rect.width).toBe(612);
  });

  it('never places the box left of the page for a zero anchor', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0,
      positionY: 0.5,
      ...LETTER,
    });
    expect(rect.x).toBe(0);
    expect(rect.relocated).toBe(false);
  });
});

describe('computeSignatureBoxRect: vertical clamp', () => {
  it('keeps a top-of-page anchor and its box below the page top', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.1,
      positionY: 0.98,
      ...LETTER,
    });
    // Un-clamped: 776.16 + 64 = 840.16 on a 792 pt page, 48.16 pt off.
    expect(rect.requestedY + SIGNATURE_BOX_HEIGHT_PT).toBeCloseTo(840.16, 10);
    expect(rect.y + rect.height).toBeLessThanOrEqual(792);
    expect(rect.y).toBe(792 - SIGNATURE_BOX_HEIGHT_PT);
    expect(rect.relocated).toBe(true);
    expect(rect.dyPt).toBeCloseTo(-48.16, 10);
  });

  it('pins the box flush to the page top at positionY = 1', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.1,
      positionY: 1,
      ...LETTER,
    });
    expect(rect.y + rect.height).toBe(792);
  });

  it('lifts a bottom-edge anchor so the caption stays on the page', () => {
    // The renderer draws the caption BELOW the box. At positionY = 0
    // the old code put the caption baseline at -10 pt, off the page.
    const rect = computeSignatureBoxRect({
      positionX: 0.1,
      positionY: 0,
      ...LETTER,
    });
    expect(rect.requestedY).toBe(0);
    expect(rect.y).toBe(SIGNATURE_CAPTION_BAND_PT);
    expect(rect.captionY).toBeGreaterThanOrEqual(0);
    expect(rect.relocated).toBe(true);
    expect(rect.dyPt).toBe(SIGNATURE_CAPTION_BAND_PT);
  });

  it('never puts the caption baseline below the page bottom, at any anchor', () => {
    for (let i = 0; i <= 100; i++) {
      const rect = computeSignatureBoxRect({
        positionX: 0.5,
        positionY: i / 100,
        ...LETTER,
      });
      expect(rect.captionY).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves an anchor clear of both edges untouched', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.5,
      positionY: 0.5,
      ...LETTER,
    });
    expect(rect.relocated).toBe(false);
    expect(rect.x).toBe(306);
    expect(rect.y).toBe(396);
  });
});

describe('computeSignatureBoxRect: containment is total', () => {
  it('keeps the whole box inside the page for every anchor on every common page size', () => {
    const sizes = [
      { pageWidthPt: 612, pageHeightPt: 792 }, // US Letter
      { pageWidthPt: 792, pageHeightPt: 612 }, // US Letter landscape
      { pageWidthPt: 595, pageHeightPt: 842 }, // A4
      { pageWidthPt: 842, pageHeightPt: 595 }, // A4 landscape
      { pageWidthPt: 612, pageHeightPt: 1008 }, // US Legal
      { pageWidthPt: 297, pageHeightPt: 420 }, // A6
    ];
    for (const size of sizes) {
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const rect = computeSignatureBoxRect({
            positionX: i / 20,
            positionY: j / 20,
            ...size,
          });
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(size.pageWidthPt);
          expect(rect.y + rect.height).toBeLessThanOrEqual(size.pageHeightPt);
          expect(rect.captionY).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('computeSignatureBoxRect: degenerate pages', () => {
  it('shrinks the box onto a page narrower than the box itself', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.9,
      positionY: 0.5,
      pageWidthPt: 180,
      pageHeightPt: 400,
    });
    expect(rect.width).toBe(180);
    expect(rect.x).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(180);
    expect(rect.shrunk).toBe(true);
  });

  it('shrinks the box onto a page shorter than the box plus caption', () => {
    const rect = computeSignatureBoxRect({
      positionX: 0.1,
      positionY: 0.9,
      pageWidthPt: 400,
      pageHeightPt: 60,
    });
    expect(rect.height).toBeLessThanOrEqual(60);
    expect(rect.y + rect.height).toBeLessThanOrEqual(60);
    expect(rect.shrunk).toBe(true);
  });

  it('reports zero height on a page too short to hold the caption band, so the renderer skips it', () => {
    // Below the caption band there is no arrangement that puts a
    // legible mark on the page. Returning a zero-height rect is the
    // signal renderFinalSignedPdf uses to skip and record a reason,
    // rather than stamping a 1 pt smear.
    const rect = computeSignatureBoxRect({
      positionX: 0.5,
      positionY: 0.5,
      pageWidthPt: 400,
      pageHeightPt: 8,
    });
    expect(rect.height).toBe(0);
    expect(rect.captionY).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(8);
  });

  it('emits no negative coordinate at any anchor on any page from 1 pt upward', () => {
    for (const ph of [1, 2, 5, 8, 11, 12, 13, 20, 60, 72, 200]) {
      for (const px of [0, 0.5, 1]) {
        for (const py of [0, 0.5, 1]) {
          const rect = computeSignatureBoxRect({
            positionX: px,
            positionY: py,
            pageWidthPt: 100,
            pageHeightPt: ph,
          });
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.captionY).toBeGreaterThanOrEqual(0);
          expect(rect.height).toBeGreaterThanOrEqual(0);
          expect(rect.y + rect.height).toBeLessThanOrEqual(ph);
        }
      }
    }
  });

  it.each([
    ['zero size', 0, 0],
    ['negative width', -612, 792],
    ['negative height', 612, -792],
    ['non-finite width', Number.NaN, 792],
    ['non-finite height', 612, Number.NaN],
    ['infinite width', Number.POSITIVE_INFINITY, 792],
  ])(
    'returns a collapsed rect rather than NaN coordinates for a %s page',
    (_label, pageWidthPt, pageHeightPt) => {
      const rect = computeSignatureBoxRect({
        positionX: 0.5,
        positionY: 0.5,
        pageWidthPt,
        pageHeightPt,
      });
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
      // pdf-lib writes whatever number it is given straight into the
      // content stream, so a NaN here becomes a corrupt PDF operator.
      for (const n of [rect.x, rect.y, rect.captionY, rect.dxPt, rect.dyPt]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    },
  );
});

describe('computeSignatureBoxRect: unusable stored positions', () => {
  it('falls back to the default fraction for a null position', () => {
    const rect = computeSignatureBoxRect({
      positionX: null,
      positionY: null,
      ...LETTER,
    });
    expect(rect.x).toBeCloseTo(SIGNATURE_DEFAULT_FRACTION * 612, 10);
    expect(rect.y).toBeCloseTo(SIGNATURE_DEFAULT_FRACTION * 792, 10);
  });

  it('falls back to the default fraction for NaN rather than drawing at NaN', () => {
    const rect = computeSignatureBoxRect({
      positionX: Number.NaN,
      positionY: Number.NaN,
      ...LETTER,
    });
    expect(Number.isNaN(rect.x)).toBe(false);
    expect(Number.isNaN(rect.y)).toBe(false);
    expect(rect.x).toBeCloseTo(SIGNATURE_DEFAULT_FRACTION * 612, 10);
  });

  it('bounds an out-of-range fraction to 0-1 before scaling it to points', () => {
    // Observable in the audit record, not just in the drawn box: the
    // relocation event reports requested_x_pt and dx_pt, and a corrupt
    // fraction of 4 must report "the page edge, 2448 pt past it" as a
    // page-relative point rather than as a raw multiple of the page.
    const high = computeSignatureBoxRect({
      positionX: 4,
      positionY: 4,
      ...LETTER,
    });
    expect(high.requestedX).toBe(612);
    expect(high.requestedY).toBe(792);
    expect(high.x + high.width).toBeLessThanOrEqual(612);
    expect(high.y + high.height).toBeLessThanOrEqual(792);

    const low = computeSignatureBoxRect({
      positionX: -3,
      positionY: -3,
      ...LETTER,
    });
    expect(low.requestedX).toBe(0);
    expect(low.requestedY).toBe(0);
    expect(low.x).toBeGreaterThanOrEqual(0);
    expect(low.y).toBeGreaterThanOrEqual(0);
  });
});

describe('computeSignatureBoxRect: the five production anchors are unchanged', () => {
  /**
   * Every signature row in the production database at the time of this
   * fix sits at one of these two anchors, both on 612 x 792 pages.
   * They are the appended-fallback layout from signature-anchors.ts
   * (PAGE_MARGIN_PT = 54 on both axes) and the pre-fallback default.
   * The fix must not move any of them, or already-executed documents
   * would render differently than they were originally stamped.
   */
  it.each([
    [0.1, 0.1, 61.2, 79.2],
    [0.0882352941176471, 0.0681818181818182, 54, 54],
  ])(
    'renders (%s, %s) at (%s, %s) pt with no relocation',
    (positionX, positionY, expectedX, expectedY) => {
      const rect = computeSignatureBoxRect({
        positionX,
        positionY,
        ...LETTER,
      });
      expect(rect.x).toBeCloseTo(expectedX, 6);
      expect(rect.y).toBeCloseTo(expectedY, 6);
      expect(rect.relocated).toBe(false);
      expect(rect.shrunk).toBe(false);
      expect(rect.width).toBe(SIGNATURE_BOX_WIDTH_PT);
      expect(rect.height).toBe(SIGNATURE_BOX_HEIGHT_PT);
      // The caption baseline is where it always was: 10 pt below the box.
      expect(rect.captionY).toBeCloseTo(expectedY - 10, 6);
    },
  );
});

describe('resolveSignaturePageIndex', () => {
  it('maps a 1-indexed page onto a 0-indexed array', () => {
    expect(resolveSignaturePageIndex(3, 5)).toEqual({
      index: 2,
      requestedPage: 3,
      relocated: false,
    });
  });

  it('reports the fallback when the requested page does not exist', () => {
    expect(resolveSignaturePageIndex(9, 2)).toEqual({
      index: 0,
      requestedPage: 9,
      relocated: true,
    });
  });

  it('treats page 0 and negatives as page 1 without calling it a relocation', () => {
    expect(resolveSignaturePageIndex(0, 3).index).toBe(0);
    expect(resolveSignaturePageIndex(0, 3).relocated).toBe(false);
    expect(resolveSignaturePageIndex(-4, 3).index).toBe(0);
  });

  it('defaults a null page to the first page', () => {
    expect(resolveSignaturePageIndex(null, 3)).toEqual({
      index: 0,
      requestedPage: 1,
      relocated: false,
    });
  });

  it('always returns an addressable index for a non-empty document', () => {
    for (const p of [null, 0, 1, 2, 7, 1000, Number.NaN, -1]) {
      const r = resolveSignaturePageIndex(p, 4);
      expect(r.index).toBeGreaterThanOrEqual(0);
      expect(r.index).toBeLessThan(4);
    }
  });
});
