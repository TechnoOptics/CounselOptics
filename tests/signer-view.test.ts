import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ASSUMED_PAGE_HEIGHT_PT,
  ASSUMED_PAGE_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_BOX_WIDTH_PT,
  SIGNATURE_CAPTION_BAND_PT,
  SIGNER_CANVAS_MAX_PIXELS,
  SIGNER_CANVAS_MAX_SIDE_PX,
  SIGNER_COPY_REFUSAL_COPY,
  SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY,
  SIGNER_DOCUMENT_MAX_BYTES,
  SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS,
  SIGNER_DOCUMENT_REFUSAL_COPY,
  SIGNER_DOCUMENT_RENDER_COPY,
  SIGNER_DOCUMENT_TOO_LARGE_STATUS,
  SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR,
  canLeaveDisclosureStep,
  classifyDocumentRequestPurpose,
  clampSignerPageNumber,
  firstDroppedRenderObject,
  isDocumentPresented,
  isUnknownColumnError,
  needsPromiseWithResolvers,
  parseSignerDownloadPermission,
  projectSignerConsentMetadata,
  resolveCanvasRenderScale,
  resolveDocumentResponseFailure,
  resolveDocumentSizeAcceptance,
  resolveDocumentSizeRefusal,
  resolveDownloadColumnFallback,
  resolveSignatureLinePlacement,
  resolveSignerCopyAccess,
  resolveSignerDocumentAccess,
  resolveSignerDocumentDelivery,
  rotateSignatureRectForDisplay,
  signatureRelocationNote,
  signaturePreviewGeometryNote,
  signerWatermarkStamp,
  INTERNAL_SIGNER_GATE_COPY,
  maskSignerEmail,
  resolveInternalSignerGate,
  type SignatureLinePlacement,
} from '../lib/signer-view';
import { computeSignatureBoxRect } from '../lib/signature-geometry';
import { resolveNativeBrowserUrl } from '../lib/platform';

describe('canLeaveDisclosureStep', () => {
  const base = {
    electronicRecordsAgreed: true,
    hardwareSoftwareAgreed: true,
    documentPresented: true,
    documentReviewed: true,
  };

  it('passes when all three affirmations are given', () => {
    expect(canLeaveDisclosureStep(base)).toBe(true);
  });

  it('still requires the electronic-records consent', () => {
    expect(
      canLeaveDisclosureStep({ ...base, electronicRecordsAgreed: false }),
    ).toBe(false);
  });

  it('still requires the hardware and software confirmation', () => {
    expect(
      canLeaveDisclosureStep({ ...base, hardwareSoftwareAgreed: false }),
    ).toBe(false);
  });

  it('blocks the pad until a presented document is acknowledged', () => {
    expect(canLeaveDisclosureStep({ ...base, documentReviewed: false })).toBe(
      false,
    );
  });

  // A document that failed to load is the exact case where the signer
  // has not read what they are being asked to sign, so the step does
  // not open. It is not softened by the review checkbox being absent.
  it('does not open at all when the document never loaded', () => {
    expect(
      canLeaveDisclosureStep({
        ...base,
        documentPresented: false,
        documentReviewed: false,
      }),
    ).toBe(false);
  });

  it('stays shut on a failed load even if review is somehow claimed', () => {
    expect(
      canLeaveDisclosureStep({
        ...base,
        documentPresented: false,
        documentReviewed: true,
      }),
    ).toBe(false);
  });
});

/**
 * The invariant this file exists to hold: what the signer is shown and
 * what lib/signature-render.ts stamps are the same rectangle.
 *
 * This used to write the renderer's arithmetic out again by hand, on
 * the reasoning that importing it would let one bug satisfy both
 * sides. That reasoning applied to a preview that reimplemented the
 * renderer, and it was right about the risk: the two DID drift, twice,
 * in opposite directions.
 *
 * The preview no longer reimplements anything. Both surfaces call
 * computeSignatureBoxRect out of lib/signature-geometry.ts, so a
 * hand-written third copy here would only test itself. What is left to
 * check, and what these cases now check, is the one piece of
 * arithmetic that is still unique to the preview: the conversion from
 * PDF points with the origin at the bottom-left into CSS percentages
 * with the origin at the top-left. That flip is easy to get wrong and
 * would put the box on screen somewhere the signer never signs.
 *
 * The geometry itself is covered on its own terms, including a
 * mutation pass, in tests/signature-geometry.test.ts.
 */
function rendererBoxInPoints(
  positionX: number,
  positionY: number,
  pageWidthPt: number,
  pageHeightPt: number,
) {
  const rect = computeSignatureBoxRect({
    positionX,
    positionY,
    pageWidthPt,
    pageHeightPt,
  });
  return {
    leftPt: rect.x,
    bottomPt: rect.y,
    widthPt: rect.width,
    heightPt: rect.height,
  };
}

/** Read a placement back out as points on the page it was measured on. */
function placementInPoints(
  placement: SignatureLinePlacement,
  pageWidthPt: number,
  pageHeightPt: number,
) {
  if (placement.mode !== 'placed') throw new Error('expected a placed signature');
  const widthPt = (placement.widthPct / 100) * pageWidthPt;
  const heightPt = (placement.heightPct / 100) * pageHeightPt;
  const topPt = (placement.topPct / 100) * pageHeightPt;
  return {
    leftPt: (placement.leftPct / 100) * pageWidthPt,
    // CSS top measured down, converted back to a PDF bottom measured up.
    bottomPt: pageHeightPt - topPt - heightPt,
    widthPt,
    heightPt,
  };
}

const PAGE_SIZES = [
  { name: 'US Letter', w: 612, h: 792 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A4 landscape', w: 841.89, h: 595.28 },
];

describe('the drawn signature agrees with renderFinalSignedPdf', () => {
  // Includes the positions the review measured the old clamp at: the
  // threshold itself (1 - 220/612 = 0.6405), and 0.70 and 0.75 above
  // it, where the clamped preview was wrong by up to 11% of the page.
  const positions = [
    [0, 0],
    [0.07, 0.07],
    [0.25, 0.5],
    [0.5, 0.5],
    [1 - SIGNATURE_BOX_WIDTH_PT / ASSUMED_PAGE_WIDTH_PT, 0.1],
    [0.7, 0.1],
    [0.75, 0.1],
    [0.95, 0.02],
    [1, 1],
    [1.4, -0.3],
  ];

  for (const page of PAGE_SIZES) {
    for (const [x, y] of positions) {
      it(`matches on ${page.name} at x=${x}, y=${y}`, () => {
        const placement = resolveSignatureLinePlacement({
          positionPage: 1,
          positionX: x,
          positionY: y,
          pageWidthPt: page.w,
          pageHeightPt: page.h,
          pageCount: 1,
        });
        const drawn = placementInPoints(placement, page.w, page.h);
        const stamped = rendererBoxInPoints(x, y, page.w, page.h);
        expect(drawn.leftPt).toBeCloseTo(stamped.leftPt, 6);
        expect(drawn.bottomPt).toBeCloseTo(stamped.bottomPt, 6);
        expect(drawn.widthPt).toBeCloseTo(stamped.widthPt, 6);
        expect(drawn.heightPt).toBeCloseTo(stamped.heightPt, 6);
      });
    }
  }

  // The same anchor this file used to assert hung off the page. It no
  // longer does, because the renderer no longer lets it: the box is
  // pulled back to the right edge and the whole mark lands on the
  // page. The preview has to move with it, or it shows the signer a
  // position the executed copy will not use.
  //
  // The threshold is derived from the REAL page width, not an assumed
  // Letter one. That was the second half of the original bug and it is
  // checked on a page that is not Letter.
  it('pulls an anchor near the right edge back onto the page, as the renderer does', () => {
    const placement = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.95,
      positionY: 0.1,
      pageWidthPt: 612,
      pageHeightPt: 792,
      pageCount: 1,
    });
    if (placement.mode !== 'placed') throw new Error('expected a placed signature');
    expect(placement.leftPct).toBeCloseTo(
      ((612 - SIGNATURE_BOX_WIDTH_PT) / 612) * 100,
      6,
    );
    expect(placement.leftPct + placement.widthPct).toBeCloseTo(100, 6);
    expect(placement.relocatedToFit).toBe(true);
    expect(placement.relocationDxPt).toBeCloseTo(612 - 220 - 0.95 * 612, 6);
  });

  it('uses the real page width for that threshold, not an assumed Letter one', () => {
    // A4 landscape is 842 pt wide. A Letter-derived threshold would
    // pin the box at 612 - 220 = 392; the real one pins it at 622.
    const placement = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.95,
      positionY: 0.5,
      pageWidthPt: 841.89,
      pageHeightPt: 595.28,
      pageCount: 1,
    });
    if (placement.mode !== 'placed') throw new Error('expected a placed signature');
    const leftPt = (placement.leftPct / 100) * 841.89;
    expect(leftPt).toBeCloseTo(841.89 - SIGNATURE_BOX_WIDTH_PT, 6);
    expect(leftPt).toBeGreaterThan(612 - SIGNATURE_BOX_WIDTH_PT);
  });

  it('never draws the box outside its own frame on any page or anchor', () => {
    for (const page of PAGE_SIZES) {
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const p = resolveSignatureLinePlacement({
            positionPage: 1,
            positionX: i / 20,
            positionY: j / 20,
            pageWidthPt: page.w,
            pageHeightPt: page.h,
            pageCount: 1,
          });
          if (p.mode !== 'placed') throw new Error('expected a placed signature');
          expect(p.leftPct).toBeGreaterThanOrEqual(0);
          expect(p.topPct).toBeGreaterThanOrEqual(-1e-9);
          expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100 + 1e-9);
          expect(p.topPct + p.heightPct).toBeLessThanOrEqual(100 + 1e-9);
        }
      }
    }
  });

  it('reports the same page the renderer will stamp on', () => {
    // pages[pageIdx] ?? pages[0]: past the end lands on page one.
    const past = resolveSignatureLinePlacement({
      positionPage: 9,
      positionX: 0.1,
      positionY: 0.1,
      pageCount: 4,
    });
    if (past.mode !== 'placed') throw new Error('expected a placed signature');
    expect(past.page).toBe(1);
    expect(past.pageFellBackToFirst).toBe(true);

    const inside = resolveSignatureLinePlacement({
      positionPage: 3,
      positionX: 0.1,
      positionY: 0.1,
      pageCount: 4,
    });
    if (inside.mode !== 'placed') throw new Error('expected a placed signature');
    expect(inside.page).toBe(3);
    expect(inside.pageFellBackToFirst).toBe(false);
  });

  it('leaves the page alone until the document has been counted', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 9,
      positionX: 0.1,
      positionY: 0.1,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.page).toBe(9);
    expect(p.pageFellBackToFirst).toBe(false);
  });
});

describe('signaturePreviewGeometryNote', () => {
  const assumed = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.7,
    positionY: 0.1,
  });
  const measured = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.7,
    positionY: 0.1,
    pageWidthPt: 595,
    pageHeightPt: 842,
  });

  it('admits the guess when the page was never measured', () => {
    const note = signaturePreviewGeometryNote(assumed);
    expect(note).toBeTruthy();
    expect(note).toMatch(/letter-size/i);
  });

  it('says nothing when the page WAS measured', () => {
    expect(signaturePreviewGeometryNote(measured)).toBeNull();
  });

  it('says nothing when there is no placement to qualify', () => {
    expect(
      signaturePreviewGeometryNote({
        mode: 'deferred',
        reason: 'no-recorded-position',
      }),
    ).toBeNull();
  });

  it('is calm and carries no em dash', () => {
    expect(signaturePreviewGeometryNote(assumed)).not.toMatch(/[—–]/);
  });

  // The note covers two distinct inaccuracies, and both are real.
  //
  // Vertical: the box height is a fraction of the page height, so the
  // top edge moves with the assumed page. 64/792 on Letter against
  // 64/595 on A4 landscape.
  it('covers a vertical position the assumed page size actually moves', () => {
    const assumedTop = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.5,
      positionY: 0.1,
    });
    const landscape = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.5,
      positionY: 0.1,
      pageWidthPt: 841.89,
      pageHeightPt: 595.28,
    });
    if (assumedTop.mode !== 'placed' || landscape.mode !== 'placed') {
      throw new Error('expected placed signatures');
    }
    expect(Math.abs(assumedTop.topPct - landscape.topPct)).toBeGreaterThan(1);
    expect(signaturePreviewGeometryNote(assumedTop)).toBeTruthy();
  });

  // Horizontal: true again, and this is the case that says so. Now
  // that the placement keeps the box on the page, the clamp threshold
  // is 1 - 220/pageWidth, and on an unmeasured page that is computed
  // from Letter. At x = 0.7 the Letter-derived clamp engages and the
  // A4-landscape one does not, so the two disagree. The note is what
  // stops that from being presented as a measured fact.
  it('covers a horizontal position the assumed page size actually moves', () => {
    const assumedRight = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.7,
      positionY: 0.1,
    });
    const landscape = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.7,
      positionY: 0.1,
      pageWidthPt: 841.89,
      pageHeightPt: 595.28,
    });
    if (assumedRight.mode !== 'placed' || landscape.mode !== 'placed') {
      throw new Error('expected placed signatures');
    }
    expect(assumedRight.relocatedToFit).toBe(true);
    expect(landscape.relocatedToFit).toBe(false);
    expect(Math.abs(assumedRight.leftPct - landscape.leftPct)).toBeGreaterThan(1);
    expect(signaturePreviewGeometryNote(assumedRight)).toBeTruthy();
  });

  it('says so in the note itself, so the admission is not silent', () => {
    const note = signaturePreviewGeometryNote(assumed);
    expect(note).toBeTruthy();
    expect(note).toMatch(/letter-size/i);
  });
});

describe('signatureRelocationNote', () => {
  const relocated = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.95,
    positionY: 0.1,
    pageWidthPt: 612,
    pageHeightPt: 792,
  });
  const contained = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.1,
    positionY: 0.1,
    pageWidthPt: 612,
    pageHeightPt: 792,
  });

  it('tells the signer when the box had to move to fit', () => {
    const note = signatureRelocationNote(relocated);
    expect(note).toBeTruthy();
    expect(note).toMatch(/moved just inside the page/i);
  });

  // The reason this note was rewritten rather than left alone. It used
  // to tell the signer part of their signature would not be visible on
  // the signed copy. That was true of a renderer that let pdf-lib drop
  // the overflow, and it is false of the one that clamps. Telling
  // someone their signature is about to be cut in half, when it is
  // not, is the kind of thing this product cannot afford to say.
  it('does not claim any of the signature will be invisible', () => {
    const note = signatureRelocationNote(relocated) ?? '';
    expect(note).not.toMatch(/not be visible|will not appear|cut off|missing/i);
    expect(note).toMatch(/all of it will be visible/i);
  });

  it('says the adjustment reaches the audit trail', () => {
    expect(signatureRelocationNote(relocated)).toMatch(/audit trail/i);
  });

  it('says nothing when the box sits exactly where the document asked', () => {
    expect(signatureRelocationNote(contained)).toBeNull();
  });

  it('says nothing when there is no placement to qualify', () => {
    expect(
      signatureRelocationNote({
        mode: 'deferred',
        reason: 'no-recorded-position',
      }),
    ).toBeNull();
  });

  it('catches a box pushed off the TOP of the page too', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.1,
      positionY: 0.99,
      pageWidthPt: 612,
      pageHeightPt: 792,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    // Pulled down to the page top rather than pushed above it.
    expect(p.topPct).toBeCloseTo(0, 6);
    expect(p.relocatedToFit).toBe(true);
    expect(signatureRelocationNote(p)).toBeTruthy();
  });

  it('catches a box whose CAPTION would fall off the bottom', () => {
    // The renderer draws the signer name and date below the box. An
    // anchor at y = 0 used to put that caption at -10 pt, off the
    // page, with the box itself fully visible. The placement reserves
    // the band, so this is a move the signer is told about.
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.1,
      positionY: 0,
      pageWidthPt: 612,
      pageHeightPt: 792,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.relocatedToFit).toBe(true);
    expect(p.relocationDyPt).toBeGreaterThan(0);
    expect(signatureRelocationNote(p)).toBeTruthy();
  });

  it('says nothing for a box that fits exactly against both edges', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 1 - SIGNATURE_BOX_WIDTH_PT / 612,
      positionY: 1 - SIGNATURE_BOX_HEIGHT_PT / 792,
      pageWidthPt: 612,
      pageHeightPt: 792,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.relocatedToFit).toBe(false);
    expect(signatureRelocationNote(p)).toBeNull();
  });

  it('has its own sentence for a page too small for a full-size box', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.5,
      positionY: 0.5,
      pageWidthPt: 180,
      pageHeightPt: 400,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.shrunkToFit).toBe(true);
    expect(signatureRelocationNote(p)).toMatch(/reduced to fit/i);
  });

  it('is calm and carries no em dash', () => {
    for (const note of [
      signatureRelocationNote(relocated),
      signatureRelocationNote(
        resolveSignatureLinePlacement({
          positionPage: 1,
          positionX: 0.5,
          positionY: 0.5,
          pageWidthPt: 180,
          pageHeightPt: 400,
        }),
      ),
    ]) {
      expect(note).toBeTruthy();
      expect(note).not.toMatch(/[—–]/);
    }
  });
});

describe('resolveSignatureLinePlacement', () => {
  it('defers when no position was recorded', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: null,
        positionX: null,
        positionY: null,
      }),
    ).toEqual({ mode: 'deferred', reason: 'no-recorded-position' });
  });

  it('defers when only part of the position was recorded', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 2,
        positionX: 0.1,
        positionY: null,
      }).mode,
    ).toBe('deferred');
    expect(
      resolveSignatureLinePlacement({
        positionPage: null,
        positionX: 0.1,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('defers on a non-finite coordinate rather than drawing NaN', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 1,
        positionX: Number.NaN,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('defers on a page number below one', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 0,
        positionX: 0.1,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('converts a recorded anchor from PDF space to CSS space', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 3,
      positionX: 0.25,
      positionY: 0.5,
      pageWidthPt: 600,
      pageHeightPt: 800,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.page).toBe(3);
    expect(p.leftPct).toBeCloseTo(25, 6);
    // PDF y is the bottom edge measured up; CSS top is the top edge
    // measured down, so top = 1 - (y + boxHeight/pageHeight).
    const heightFrac = SIGNATURE_BOX_HEIGHT_PT / 800;
    expect(p.topPct).toBeCloseTo((1 - (0.5 + heightFrac)) * 100, 6);
    expect(p.widthPct).toBeCloseTo((SIGNATURE_BOX_WIDTH_PT / 600) * 100, 6);
    expect(p.heightPct).toBeCloseTo(heightFrac * 100, 6);
    expect(p.pageGeometry).toBe('measured');
    expect(p.pageAspect).toBeCloseTo(600 / 800, 6);
  });

  it('falls back to Letter geometry when the page was not measured', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.1,
      positionY: 0.1,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.pageGeometry).toBe('assumed');
    expect(p.widthPct).toBeCloseTo(
      (SIGNATURE_BOX_WIDTH_PT / ASSUMED_PAGE_WIDTH_PT) * 100,
      6,
    );
    expect(p.heightPct).toBeCloseTo(
      (SIGNATURE_BOX_HEIGHT_PT / ASSUMED_PAGE_HEIGHT_PT) * 100,
      6,
    );
  });

  it('ignores a page size that is not a page size', () => {
    for (const [w, h] of [
      [0, 800],
      [600, 0],
      [-600, 800],
      [Number.NaN, 800],
    ]) {
      const p = resolveSignatureLinePlacement({
        positionPage: 1,
        positionX: 0.1,
        positionY: 0.1,
        pageWidthPt: w,
        pageHeightPt: h,
      });
      if (p.mode !== 'placed') throw new Error('expected a placed signature');
      expect(p.pageGeometry).toBe('assumed');
    }
  });

  it('clamps an out-of-range anchor into the page the way the renderer does', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 1.4,
      positionY: -0.3,
      pageWidthPt: 600,
      pageHeightPt: 800,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    // The fraction bounds to 1, then the box is pulled back so its
    // RIGHT edge sits on the page edge. It used to be left starting at
    // 100% and hanging off, which is where the renderer used to put it.
    expect(p.leftPct).toBeCloseTo(((600 - SIGNATURE_BOX_WIDTH_PT) / 600) * 100, 6);
    expect(p.leftPct + p.widthPct).toBeCloseTo(100, 6);
    // The fraction bounds to 0, then the box lifts by the caption band
    // so the name and date printed under it stay on the page.
    expect(p.topPct).toBeCloseTo(
      (1 - (SIGNATURE_CAPTION_BAND_PT + SIGNATURE_BOX_HEIGHT_PT) / 800) * 100,
      6,
    );
  });
});

describe('rotateSignatureRectForDisplay', () => {
  const rect = {
    leftFrac: 0.1,
    topFrac: 0.2,
    widthFrac: 0.3,
    heightFrac: 0.4,
  };

  it('leaves an unrotated page alone', () => {
    expect(rotateSignatureRectForDisplay(rect, 0)).toEqual(rect);
    expect(rotateSignatureRectForDisplay(rect, 360)).toEqual(rect);
    expect(rotateSignatureRectForDisplay(rect, null)).toEqual(rect);
  });

  it('turns the box with the page at 90 degrees', () => {
    // Clockwise: (u, v) -> (1 - v, u), and the box's width and height
    // trade places with the dimensions they are fractions of.
    expect(rotateSignatureRectForDisplay(rect, 90)).toEqual({
      leftFrac: 1 - 0.2 - 0.4,
      topFrac: 0.1,
      widthFrac: 0.4,
      heightFrac: 0.3,
    });
  });

  it('turns the box with the page at 180 and 270 degrees', () => {
    expect(rotateSignatureRectForDisplay(rect, 180)).toEqual({
      leftFrac: 1 - 0.1 - 0.3,
      topFrac: 1 - 0.2 - 0.4,
      widthFrac: 0.3,
      heightFrac: 0.4,
    });
    expect(rotateSignatureRectForDisplay(rect, 270)).toEqual({
      leftFrac: 0.2,
      topFrac: 1 - 0.1 - 0.3,
      widthFrac: 0.4,
      heightFrac: 0.3,
    });
  });

  it('reads a negative rotation the same way a viewer does', () => {
    expect(rotateSignatureRectForDisplay(rect, -90)).toEqual(
      rotateSignatureRectForDisplay(rect, 270),
    );
  });

  it('four quarter turns is where it started', () => {
    let out = rect;
    for (let i = 0; i < 4; i++) out = rotateSignatureRectForDisplay(out, 90);
    expect(out.leftFrac).toBeCloseTo(rect.leftFrac, 9);
    expect(out.topFrac).toBeCloseTo(rect.topFrac, 9);
    expect(out.widthFrac).toBeCloseTo(rect.widthFrac, 9);
    expect(out.heightFrac).toBeCloseTo(rect.heightFrac, 9);
  });

  it('treats a rotation that is not a right angle as no rotation', () => {
    // /Rotate is defined to be a multiple of 90. Inventing a shear for
    // a malformed value would be worse than drawing it unrotated.
    expect(rotateSignatureRectForDisplay(rect, Number.NaN)).toEqual(rect);
    expect(rotateSignatureRectForDisplay(rect, 37)).toEqual(rect);
  });
});

describe('resolveCanvasRenderScale', () => {
  const letter = { pageWidthPt: 612, pageHeightPt: 792 };

  it('renders at the width it is shown at, times the device ratio', () => {
    expect(
      resolveCanvasRenderScale({
        ...letter,
        cssWidthPx: 612,
        devicePixelRatio: 2,
      }),
    ).toBeCloseTo(2, 6);
  });

  it('keeps the ceiling itself inside what a phone will allocate', () => {
    // The tests below measure the scale AGAINST this constant, so they
    // move with it: raising it to something no device can allocate
    // leaves every one of them green while the canvas silently draws
    // nothing. The documented iOS limits are the fixed point, so the
    // constant is pinned to them here.
    expect(SIGNER_CANVAS_MAX_PIXELS).toBeLessThanOrEqual(16_777_216);
    expect(SIGNER_CANVAS_MAX_PIXELS).toBeGreaterThanOrEqual(4_000_000);
    expect(SIGNER_CANVAS_MAX_SIDE_PX).toBeLessThanOrEqual(4096);
  });

  it('never exceeds the canvas area a phone will allocate', () => {
    const scale = resolveCanvasRenderScale({
      ...letter,
      cssWidthPx: 4000,
      devicePixelRatio: 3,
    });
    expect(612 * scale * (792 * scale)).toBeLessThanOrEqual(
      SIGNER_CANVAS_MAX_PIXELS + 1,
    );
  });

  it('never exceeds the maximum side either', () => {
    // A very tall, very narrow page hits the side limit before the
    // area limit, and a canvas over the side limit draws nothing.
    const scale = resolveCanvasRenderScale({
      pageWidthPt: 100,
      pageHeightPt: 5000,
      cssWidthPx: 2000,
      devicePixelRatio: 3,
    });
    expect(5000 * scale).toBeLessThanOrEqual(SIGNER_CANVAS_MAX_SIDE_PX + 1);
    expect(100 * scale).toBeLessThanOrEqual(SIGNER_CANVAS_MAX_SIDE_PX + 1);
  });

  it('caps an absurd device pixel ratio rather than trusting it', () => {
    const capped = resolveCanvasRenderScale({
      ...letter,
      cssWidthPx: 300,
      devicePixelRatio: 12,
    });
    const atThree = resolveCanvasRenderScale({
      ...letter,
      cssWidthPx: 300,
      devicePixelRatio: 3,
    });
    expect(capped).toBeCloseTo(atThree, 6);
  });

  it('returns a usable scale for nonsense input rather than zero', () => {
    // A zero or NaN scale is a zero-sized canvas, which is the blank
    // document this whole surface exists to prevent.
    for (const bad of [
      { pageWidthPt: 0, pageHeightPt: 792, cssWidthPx: 300 },
      { pageWidthPt: 612, pageHeightPt: Number.NaN, cssWidthPx: 300 },
      { pageWidthPt: 612, pageHeightPt: 792, cssWidthPx: 0 },
      { pageWidthPt: 612, pageHeightPt: 792, cssWidthPx: Number.NaN },
    ]) {
      const scale = resolveCanvasRenderScale(bad);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0);
    }
  });

  it('keeps a floor under a page far larger than its container', () => {
    // A container measured mid-layout at a pixel or two would otherwise
    // ask for a scale of 0.0001, and a canvas that rounds to nothing is
    // the blank document again.
    const scale = resolveCanvasRenderScale({
      pageWidthPt: 10000,
      pageHeightPt: 10000,
      cssWidthPx: 1,
      devicePixelRatio: 1,
    });
    expect(scale).toBeGreaterThanOrEqual(0.05);
  });

  it('stays positive when a missing device ratio is reported', () => {
    const scale = resolveCanvasRenderScale({
      ...letter,
      cssWidthPx: 300,
      devicePixelRatio: 0,
    });
    expect(scale).toBeGreaterThan(0);
  });
});

describe('clampSignerPageNumber', () => {
  it('keeps the page inside the document', () => {
    expect(clampSignerPageNumber(0, 10)).toBe(1);
    expect(clampSignerPageNumber(11, 10)).toBe(10);
    expect(clampSignerPageNumber(4, 10)).toBe(4);
  });

  it('stays on page one until the document has been counted', () => {
    expect(clampSignerPageNumber(7, null)).toBe(1);
    expect(clampSignerPageNumber(7, 0)).toBe(1);
    expect(clampSignerPageNumber(7, Number.NaN)).toBe(1);
  });

  it('refuses a page that is not a number', () => {
    expect(clampSignerPageNumber(Number.NaN, 10)).toBe(1);
    expect(clampSignerPageNumber(null, 10)).toBe(1);
  });

  it('takes whole pages only', () => {
    expect(clampSignerPageNumber(3.7, 10)).toBe(3);
  });
});

describe('resolveDocumentSizeAcceptance', () => {
  it('accepts an ordinary agreement', () => {
    expect(resolveDocumentSizeAcceptance(2 * 1024 * 1024)).toBe('ok');
  });

  it('refuses a file this device should not attempt', () => {
    expect(resolveDocumentSizeAcceptance(SIGNER_DOCUMENT_MAX_BYTES + 1)).toBe(
      'too-large',
    );
    expect(resolveDocumentSizeAcceptance(SIGNER_DOCUMENT_MAX_BYTES)).toBe('ok');
  });

  it('calls an empty response empty rather than fine', () => {
    expect(resolveDocumentSizeAcceptance(0)).toBe('empty');
    expect(resolveDocumentSizeAcceptance(null)).toBe('empty');
    expect(resolveDocumentSizeAcceptance(Number.NaN)).toBe('empty');
    expect(resolveDocumentSizeAcceptance(-1)).toBe('empty');
  });
});

/**
 * The route refuses, the page reads the refusal back, and the signer
 * gets a sentence about what actually happened. Both halves are here
 * because the bug was in the JOIN between them: each half was
 * defensible alone and together they told a firm with an empty stored
 * file to go and shrink it.
 */
describe('the refusal the route writes and the sentence the page reads', () => {
  it('refuses a file past the ceiling as too large', () => {
    const refusal = resolveDocumentSizeRefusal('too-large');
    expect(refusal.status).toBe(SIGNER_DOCUMENT_TOO_LARGE_STATUS);
    expect(refusal.message).toMatch(/too large/i);
    expect(resolveDocumentResponseFailure(refusal.status)).toBe('too-large');
  });

  it('does not call an empty stored file a size problem', () => {
    const refusal = resolveDocumentSizeRefusal('empty');
    expect(refusal.status).not.toBe(SIGNER_DOCUMENT_TOO_LARGE_STATUS);
    expect(refusal.message).not.toMatch(/large/i);
    // What the signer ends up reading: the document could not be
    // loaded, ask the firm. Not "shrink it".
    const status = resolveDocumentResponseFailure(refusal.status);
    expect(status).toBe('unavailable');
    expect(SIGNER_DOCUMENT_RENDER_COPY[status]).not.toMatch(/large/i);
  });

  it('reads every other refusal as the document not being available', () => {
    for (const httpStatus of [400, 403, 404, 429, 500, 502, 504]) {
      expect(resolveDocumentResponseFailure(httpStatus)).toBe('unavailable');
    }
  });

  it('gives the signer a deadline rather than an open-ended spinner', () => {
    // Long enough for a large agreement on a slow connection, short
    // enough that nobody waits on a document that is not coming.
    expect(SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
  });
});

/**
 * The guard behind the whole branch: a render that finished is not the
 * same as a page that was drawn.
 *
 * pdf.js resolves an image it could not decode to null and finishes
 * the render over the gap. On a scanned agreement that is a white
 * rectangle under a checkbox saying the signer has read the document
 * in full.
 */
describe('firstDroppedRenderObject', () => {
  it('names the image the renderer could not produce', () => {
    expect(
      firstDroppedRenderObject([
        ['img_p0_1', { width: 100 }],
        ['img_p0_2', null],
      ]),
    ).toBe('img_p0_2');
  });

  it('counts undefined as dropped too, not as not-yet-asked', () => {
    expect(firstDroppedRenderObject([['img_p0_1', undefined]])).toBe('img_p0_1');
  });

  it('passes a page whose objects all arrived', () => {
    expect(
      firstDroppedRenderObject([
        ['img_p0_1', { width: 100 }],
        ['pattern_p0_2', { type: 'Pattern' }],
      ]),
    ).toBeNull();
  });

  it('passes a page that simply had nothing on it', () => {
    // Blank pages are ordinary in real agreements - the back of a
    // scanned duplex sheet, a divider. Refusing to open a document
    // because page 7 is blank would block a signing over a page that
    // is exactly as it should be.
    expect(firstDroppedRenderObject([])).toBeNull();
    expect(firstDroppedRenderObject(null)).toBeNull();
    expect(firstDroppedRenderObject(undefined)).toBeNull();
  });

  it('does not treat a falsy-but-present object as dropped', () => {
    // 0 and '' are not what a failed decode leaves behind; null is.
    expect(firstDroppedRenderObject([['img_p0_1', 0]])).toBeNull();
    expect(firstDroppedRenderObject([['img_p0_1', '']])).toBeNull();
    expect(firstDroppedRenderObject([['img_p0_1', false]])).toBeNull();
  });
});

/**
 * Lives here rather than beside the rest of lib/platform because the
 * failure it prevents is this page's: the signer page is the one place
 * where losing the WebView to a stray navigation costs a ceremony in
 * progress rather than a scroll position.
 */
describe('resolveNativeBrowserUrl', () => {
  const base = 'https://advottic.com/sign/abc123';

  it('makes a relative app URL absolute', () => {
    expect(resolveNativeBrowserUrl('/api/firm/sign/document/abc', base)).toBe(
      'https://advottic.com/api/firm/sign/document/abc',
    );
  });

  it('leaves an absolute URL alone', () => {
    expect(resolveNativeBrowserUrl('https://courts.example/x', base)).toBe(
      'https://courts.example/x',
    );
    expect(resolveNativeBrowserUrl('mailto:clerk@example.com', base)).toBe(
      'mailto:clerk@example.com',
    );
  });

  it('hands back what it was given rather than throwing', () => {
    // No base to resolve against (a server render, a stubbed window):
    // returning the original is the same behaviour as before, and
    // throwing inside a click handler would lose the click entirely.
    expect(resolveNativeBrowserUrl('/api/x', null)).toBe('/api/x');
    expect(resolveNativeBrowserUrl('', base)).toBe('');
  });
});

describe('isDocumentPresented', () => {
  it('counts only a page that actually rasterised', () => {
    expect(isDocumentPresented('ready')).toBe(true);
  });

  it('counts nothing else, so a failed render blocks the ceremony', () => {
    for (const status of [
      'pending',
      'empty',
      'too-large',
      'unreadable',
      'unsupported',
      'unavailable',
    ] as const) {
      expect(isDocumentPresented(status)).toBe(false);
      expect(
        canLeaveDisclosureStep({
          electronicRecordsAgreed: true,
          hardwareSoftwareAgreed: true,
          documentPresented: isDocumentPresented(status),
          documentReviewed: true,
        }),
      ).toBe(false);
    }
  });

  it('has calm wording for every state that is not ready', () => {
    for (const status of [
      'pending',
      'empty',
      'too-large',
      'unreadable',
      'unsupported',
      'unavailable',
    ] as const) {
      const copy = SIGNER_DOCUMENT_RENDER_COPY[status];
      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/[—–]/);
      expect(copy).not.toMatch(/error|failed|invalid|denied/i);
    }
  });
});

describe('resolveSignerDocumentAccess', () => {
  const base = {
    accessCodeRequired: false,
    accessVerifiedAt: null,
    requestStatus: 'sent',
    signedAt: null,
    signerResponse: null,
    sourceFilePath: 'firm/doc.pdf',
  };

  it('serves the document to a live, unsigned request', () => {
    expect(resolveSignerDocumentAccess(base)).toEqual({
      allowed: true,
      path: 'firm/doc.pdf',
    });
  });

  it('refuses an unverified access code before anything else', () => {
    // First, so a link forwarded without its code learns nothing about
    // the request behind it.
    const out = resolveSignerDocumentAccess({
      ...base,
      accessCodeRequired: true,
      accessVerifiedAt: null,
      requestStatus: 'canceled',
    });
    expect(out).toEqual({ allowed: false, reason: 'code-required' });
  });

  it('serves a verified access-code link normally', () => {
    expect(
      resolveSignerDocumentAccess({
        ...base,
        accessCodeRequired: true,
        accessVerifiedAt: '2026-08-06T00:00:00Z',
      }).allowed,
    ).toBe(true);
  });

  it('refuses a recalled request', () => {
    expect(
      resolveSignerDocumentAccess({ ...base, requestStatus: 'canceled' }),
    ).toEqual({ allowed: false, reason: 'canceled' });
  });

  it('refuses once the signer has signed, so the copy route governs retention', () => {
    // Otherwise this route hands out the same document with the firm's
    // per-request download permission never consulted.
    expect(
      resolveSignerDocumentAccess({
        ...base,
        signedAt: '2026-08-06T00:00:00Z',
      }),
    ).toEqual({ allowed: false, reason: 'already-signed' });
  });

  it('refuses a request on hold', () => {
    expect(
      resolveSignerDocumentAccess({ ...base, signerResponse: 'rejected' }),
    ).toEqual({ allowed: false, reason: 'on-hold' });
    expect(
      resolveSignerDocumentAccess({ ...base, requestStatus: 'rejected' }),
    ).toEqual({ allowed: false, reason: 'on-hold' });
    expect(
      resolveSignerDocumentAccess({
        ...base,
        requestStatus: 'changes_requested',
      }),
    ).toEqual({ allowed: false, reason: 'on-hold' });
  });

  it('refuses when no file is recorded at all', () => {
    expect(
      resolveSignerDocumentAccess({ ...base, sourceFilePath: null }),
    ).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('has calm wording for every refusal it can return', () => {
    const reasons = [
      'code-required',
      'canceled',
      'already-signed',
      'on-hold',
      'unavailable',
    ] as const;
    for (const reason of reasons) {
      const copy = SIGNER_DOCUMENT_REFUSAL_COPY[reason];
      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/[—–]/);
      expect(copy).not.toMatch(/error|forbidden|denied|invalid/i);
    }
  });
});

describe('classifyDocumentRequestPurpose', () => {
  it('reads the signing page own fetch as a render', () => {
    // What fetch() sends from same-origin page script.
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: 'empty',
        secFetchMode: 'same-origin',
      }),
    ).toBe('render');
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: 'empty',
        secFetchMode: 'cors',
      }),
    ).toBe('render');
  });

  it('reads a browser pointed at the file as a navigation', () => {
    // A new tab, a pasted URL, a bookmark: all of these land in the
    // browser's own PDF viewer, which has Save and Print on it.
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: 'document',
        secFetchMode: 'navigate',
      }),
    ).toBe('navigate');
    // Mode alone is enough, in case a browser omits the destination.
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: null,
        secFetchMode: 'navigate',
      }),
    ).toBe('navigate');
  });

  it('counts a frame, an embed and an object as navigations too', () => {
    // Each one hands the file to a browser viewer rather than to us.
    for (const dest of ['iframe', 'frame', 'embed', 'object']) {
      expect(
        classifyDocumentRequestPurpose({
          secFetchDest: dest,
          secFetchMode: 'no-cors',
        }),
      ).toBe('navigate');
    }
  });

  it('is not fooled by casing or padding', () => {
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: '  DOCUMENT ',
        secFetchMode: null,
      }),
    ).toBe('navigate');
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: 'Empty',
        secFetchMode: null,
      }),
    ).toBe('render');
  });

  it('says unstated when the client sent no Fetch Metadata', () => {
    // Safari before 16.4, some in-app webviews, and every scripted
    // client. Named rather than guessed, because what happens next
    // depends on being honest that we do not know.
    expect(
      classifyDocumentRequestPurpose({ secFetchDest: null, secFetchMode: null }),
    ).toBe('unstated');
    expect(
      classifyDocumentRequestPurpose({
        secFetchDest: undefined,
        secFetchMode: undefined,
      }),
    ).toBe('unstated');
    expect(
      classifyDocumentRequestPurpose({ secFetchDest: '', secFetchMode: '' }),
    ).toBe('unstated');
  });
});

describe('resolveSignerDocumentDelivery', () => {
  it('serves everything when the firm left downloads on', () => {
    for (const purpose of ['render', 'navigate', 'unstated'] as const) {
      expect(
        resolveSignerDocumentDelivery({ downloadPermitted: true, purpose }),
      ).toEqual({ serve: true });
    }
  });

  it('still serves the render when the firm withheld a copy', () => {
    // This is the direction that breaks signing if it is wrong. The
    // rasteriser needs the whole file to draw a page of it, so a signer
    // refused here cannot read what they are being asked to sign, and
    // displaying is not downloading.
    expect(
      resolveSignerDocumentDelivery({
        downloadPermitted: false,
        purpose: 'render',
      }),
    ).toEqual({ serve: true });
  });

  it('refuses a browser pointed at the file when the firm withheld a copy', () => {
    // This is the hole. Before this decision existed, the permission
    // hid a button and the endpoint underneath stayed open, so any
    // holder of the signing token could open the raw PDF by requesting
    // the URL.
    expect(
      resolveSignerDocumentDelivery({
        downloadPermitted: false,
        purpose: 'navigate',
      }),
    ).toEqual({ serve: false, reason: 'download-not-permitted' });
  });

  it('serves a client that stated nothing, and does not pretend otherwise', () => {
    // Refusing here would lock out Safari before 16.4 and a number of
    // in-app webviews, which is the strict-direction failure: it breaks
    // signing for real signers to inconvenience nobody, since a scripted
    // client can send whatever headers it likes anyway.
    expect(
      resolveSignerDocumentDelivery({
        downloadPermitted: false,
        purpose: 'unstated',
      }),
    ).toEqual({ serve: true });
  });

  it('has calm wording for the refusal, pointing at where the document is', () => {
    const copy = SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY['download-not-permitted'];
    expect(copy).toBeTruthy();
    expect(copy).not.toMatch(/[—–]/);
    expect(copy).not.toMatch(/error|forbidden|denied|invalid|not allowed/i);
    // It tells the signer where to read the document rather than only
    // what they may not have.
    expect(copy).toMatch(/signing page|signing link/i);
  });
});

describe('signerWatermarkStamp', () => {
  const at = new Date('2026-08-06T14:22:41.500Z');

  it('names the signer and the minute', () => {
    expect(
      signerWatermarkStamp({
        signerName: 'Jane Doe',
        signerEmail: 'jane@example.com',
        at,
      }),
    ).toBe('Confidential  ·  Jane Doe (jane@example.com)  ·  2026-08-06 14:22Z');
  });

  it('falls back to the address when no name is recorded', () => {
    expect(
      signerWatermarkStamp({
        signerName: null,
        signerEmail: 'jane@example.com',
        at,
      }),
    ).toBe('Confidential  ·  jane@example.com  ·  2026-08-06 14:22Z');
    expect(
      signerWatermarkStamp({ signerName: '   ', signerEmail: 'j@x.io', at }),
    ).toBe('Confidential  ·  j@x.io  ·  2026-08-06 14:22Z');
  });

  it('uses the name alone rather than nothing', () => {
    expect(
      signerWatermarkStamp({ signerName: 'Jane Doe', signerEmail: null, at }),
    ).toBe('Confidential  ·  Jane Doe  ·  2026-08-06 14:22Z');
  });

  it('returns null when there is nobody to name', () => {
    // A watermark reading "Confidential" and nothing else traces
    // nothing. Rendering it would overstate what the page knows.
    expect(
      signerWatermarkStamp({ signerName: null, signerEmail: null, at }),
    ).toBeNull();
    expect(
      signerWatermarkStamp({ signerName: '', signerEmail: '  ', at }),
    ).toBeNull();
  });

  it('keeps the identity when the timestamp is unusable', () => {
    expect(
      signerWatermarkStamp({
        signerName: null,
        signerEmail: 'jane@example.com',
        at: 'not a date',
      }),
    ).toBe('Confidential  ·  jane@example.com');
  });

  it('accepts an ISO string as readily as a Date', () => {
    expect(
      signerWatermarkStamp({
        signerName: null,
        signerEmail: 'jane@example.com',
        at: '2026-08-06T14:22:41.500Z',
      }),
    ).toBe('Confidential  ·  jane@example.com  ·  2026-08-06 14:22Z');
  });

  it('folds a stored name onto one line', () => {
    // The stamp becomes one line of SVG text inside a data URI. A name
    // carrying newlines or control bytes would break the markup.
    expect(
      signerWatermarkStamp({
        signerName: 'Jane\n\tDoe  ',
        signerEmail: 'jane@example.com',
        at,
      }),
    ).toBe('Confidential  ·  Jane Doe (jane@example.com)  ·  2026-08-06 14:22Z');
  });

  it('caps a pathological name so the identity stays on the tile', () => {
    const out = signerWatermarkStamp({
      signerName: 'A'.repeat(500),
      signerEmail: null,
      at,
    });
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThan(140);
    expect(out).toMatch(/…/);
  });

  it('reads as a property of the document, not as an accusation', () => {
    const out = signerWatermarkStamp({
      signerName: 'Jane Doe',
      signerEmail: 'jane@example.com',
      at,
    })!;
    expect(out.startsWith('Confidential')).toBe(true);
    expect(out).not.toMatch(/[—–]/);
    expect(out).not.toMatch(/do not|warning|prohibited|tracked|monitored/i);
  });
});

describe('needsPromiseWithResolvers', () => {
  it('says yes when the method is missing', () => {
    expect(needsPromiseWithResolvers({})).toBe(true);
    expect(needsPromiseWithResolvers({ withResolvers: undefined })).toBe(true);
    expect(needsPromiseWithResolvers({ withResolvers: 'nope' })).toBe(true);
  });

  it('says no when the engine already has it', () => {
    expect(needsPromiseWithResolvers({ withResolvers: () => undefined })).toBe(
      false,
    );
  });

  it('says no rather than throwing on nothing at all', () => {
    expect(needsPromiseWithResolvers(null)).toBe(false);
    expect(needsPromiseWithResolvers(undefined)).toBe(false);
  });
});

describe('parseSignerDownloadPermission', () => {
  it('defaults to permitted when the firm has not said otherwise', () => {
    expect(parseSignerDownloadPermission(undefined)).toBe(true);
    expect(parseSignerDownloadPermission(null)).toBe(true);
  });

  it('honours an explicit refusal', () => {
    expect(parseSignerDownloadPermission(false)).toBe(false);
    expect(parseSignerDownloadPermission('false')).toBe(false);
    expect(parseSignerDownloadPermission('f')).toBe(false);
    expect(parseSignerDownloadPermission(0)).toBe(false);
  });

  it('honours an explicit permission', () => {
    expect(parseSignerDownloadPermission(true)).toBe(true);
    expect(parseSignerDownloadPermission('true')).toBe(true);
    expect(parseSignerDownloadPermission('t')).toBe(true);
    expect(parseSignerDownloadPermission(1)).toBe(true);
  });
});

describe('isUnknownColumnError', () => {
  it('recognises the PostgREST schema-cache miss', () => {
    expect(
      isUnknownColumnError(
        {
          code: 'PGRST204',
          message:
            "Could not find the 'signer_can_download' column of 'firm_signing_requests' in the schema cache",
        },
        'signer_can_download',
      ),
    ).toBe(true);
  });

  it('recognises the Postgres undefined_column code', () => {
    expect(
      isUnknownColumnError(
        { code: '42703', message: 'column "signer_can_download" does not exist' },
        'signer_can_download',
      ),
    ).toBe(true);
  });

  it('does not swallow a permission failure', () => {
    expect(
      isUnknownColumnError(
        { code: '42501', message: 'permission denied for table firm_signing_requests' },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not swallow a constraint violation', () => {
    expect(
      isUnknownColumnError(
        { code: '23514', message: 'new row violates check constraint' },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  // The column name appearing in the message is not enough on its own.
  // These are the errors that name the column while meaning something
  // entirely different, and retrying without the column would send the
  // request while hiding a real failure.
  it('does not swallow a permission failure that names the column', () => {
    expect(
      isUnknownColumnError(
        {
          code: '42501',
          message: 'permission denied for column signer_can_download',
        },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not swallow a not-null violation that names the column', () => {
    expect(
      isUnknownColumnError(
        {
          code: '23502',
          message:
            'null value in column "signer_can_download" violates not-null constraint',
        },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not fire for a different missing column', () => {
    expect(
      isUnknownColumnError(
        { code: 'PGRST204', message: "Could not find the 'due_at' column" },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('reports false for no error at all', () => {
    expect(isUnknownColumnError(null, 'signer_can_download')).toBe(false);
    expect(isUnknownColumnError(undefined, 'signer_can_download')).toBe(false);
  });
});

describe('resolveDownloadColumnFallback', () => {
  const missing = {
    code: 'PGRST204',
    message:
      "Could not find the 'signer_can_download' column of 'firm_signing_requests' in the schema cache",
  };

  it('sends without the column when downloads were allowed anyway', () => {
    expect(
      resolveDownloadColumnFallback({ signerCanDownload: true, error: missing }),
    ).toBe('retry-without-column');
  });

  // The one that matters. Retrying without the column would send the
  // request with the document downloadable by exactly the person the
  // firm chose to withhold it from, and a warning afterwards does not
  // put it back.
  it('refuses to send when the firm restricted downloads and it cannot be saved', () => {
    expect(
      resolveDownloadColumnFallback({
        signerCanDownload: false,
        error: missing,
      }),
    ).toBe('abort-restriction-unsaved');
  });

  it('does the same for the Postgres undefined_column code', () => {
    expect(
      resolveDownloadColumnFallback({
        signerCanDownload: false,
        error: {
          code: '42703',
          message: 'column "signer_can_download" does not exist',
        },
      }),
    ).toBe('abort-restriction-unsaved');
  });

  it('surfaces anything that is not a missing column', () => {
    for (const canDownload of [true, false]) {
      expect(
        resolveDownloadColumnFallback({
          signerCanDownload: canDownload,
          error: {
            code: '42501',
            message: 'permission denied for column signer_can_download',
          },
        }),
      ).toBe('surface-error');
      expect(
        resolveDownloadColumnFallback({
          signerCanDownload: canDownload,
          error: null,
        }),
      ).toBe('surface-error');
    }
  });

  it('tells the firm plainly, and calmly, why nothing was sent', () => {
    expect(SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR).toMatch(/was not sent/i);
    expect(SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR).not.toMatch(/[—–]/);
  });
});

describe('projectSignerConsentMetadata', () => {
  const full = {
    electronicRecordsConsentedAt: '2026-08-06T10:00:00.000Z',
    hardwareSoftwareConfirmedAt: '2026-08-06T10:00:00.000Z',
    documentPresented: true,
    documentReviewedAt: '2026-08-06T10:00:05.000Z',
    intentAffirmedAt: '2026-08-06T10:01:00.000Z',
    uaSnapshot: 'Mozilla/5.0',
    tzOffsetMinutes: -60,
  };

  it('records nothing when the signer sent no consent block', () => {
    expect(projectSignerConsentMetadata(undefined)).toBeNull();
    expect(projectSignerConsentMetadata(null)).toBeNull();
  });

  // The whole reason the document-review gate exists is to produce
  // this evidence. Dropped here, the checkbox is theatre: the chain
  // still verifies and the absence looks like a signer never asked.
  it('carries the document-review affirmation into the chain', () => {
    const record = projectSignerConsentMetadata(full);
    expect(record?.document_presented).toBe(true);
    expect(record?.document_reviewed_at).toBe('2026-08-06T10:00:05.000Z');
  });

  it('still carries the electronic-records and intent affirmations', () => {
    expect(projectSignerConsentMetadata(full)).toEqual({
      electronic_records_consented_at: '2026-08-06T10:00:00.000Z',
      hardware_software_confirmed_at: '2026-08-06T10:00:00.000Z',
      document_presented: true,
      document_reviewed_at: '2026-08-06T10:00:05.000Z',
      intent_affirmed_at: '2026-08-06T10:01:00.000Z',
      ua_snapshot: 'Mozilla/5.0',
      tz_offset_minutes: -60,
    });
  });

  it('does not claim a review that was not affirmed', () => {
    const record = projectSignerConsentMetadata({
      ...full,
      documentPresented: false,
      documentReviewedAt: null,
    });
    expect(record?.document_presented).toBe(false);
    expect(record?.document_reviewed_at).toBeNull();
  });

  it('reads a merely truthy presented flag as not presented', () => {
    const record = projectSignerConsentMetadata({
      // A client posting anything other than true is not evidence of
      // presentation, so it does not become evidence in the chain.
      documentPresented: 'yes' as unknown as boolean,
    });
    expect(record?.document_presented).toBe(false);
  });

  it('normalises missing fields to null rather than dropping the key', () => {
    const record = projectSignerConsentMetadata({});
    expect(record).not.toBeNull();
    expect(Object.keys(record ?? {}).sort()).toEqual([
      'document_presented',
      'document_reviewed_at',
      'electronic_records_consented_at',
      'hardware_software_confirmed_at',
      'intent_affirmed_at',
      'tz_offset_minutes',
      'ua_snapshot',
    ]);
    expect(record?.intent_affirmed_at).toBeNull();
    expect(record?.tz_offset_minutes).toBeNull();
  });

  it('keeps a zero timezone offset rather than nulling it', () => {
    expect(
      projectSignerConsentMetadata({ tzOffsetMinutes: 0 })?.tz_offset_minutes,
    ).toBe(0);
  });
});

describe('resolveSignerCopyAccess', () => {
  const base = {
    downloadPermitted: true,
    signedAt: '2026-08-06T10:00:00.000Z',
    requestStatus: 'completed',
    accessCodeRequired: false,
    accessVerifiedAt: null,
    signedFilePath: 'signed/req-1/final.pdf',
    sourceFilePath: 'firm-1/contract.pdf',
  };

  it('serves the executed PDF once it exists', () => {
    expect(resolveSignerCopyAccess(base)).toEqual({
      allowed: true,
      path: 'signed/req-1/final.pdf',
      kind: 'executed',
    });
  });

  it('falls back to the document the signer reviewed', () => {
    expect(
      resolveSignerCopyAccess({ ...base, signedFilePath: null }),
    ).toEqual({
      allowed: true,
      path: 'firm-1/contract.pdf',
      kind: 'as-signed',
    });
  });

  it('refuses when the firm turned downloads off', () => {
    expect(
      resolveSignerCopyAccess({ ...base, downloadPermitted: false }),
    ).toEqual({ allowed: false, reason: 'not-permitted' });
  });

  it('refuses before the signer has signed', () => {
    expect(resolveSignerCopyAccess({ ...base, signedAt: null })).toEqual({
      allowed: false,
      reason: 'not-signed',
    });
  });

  it('refuses a recalled request even to someone who already signed', () => {
    expect(
      resolveSignerCopyAccess({ ...base, requestStatus: 'canceled' }),
    ).toEqual({ allowed: false, reason: 'canceled' });
  });

  it('refuses an unverified access code before anything else', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        accessCodeRequired: true,
        accessVerifiedAt: null,
      }),
    ).toEqual({ allowed: false, reason: 'code-required' });
  });

  it('serves a verified access-code link normally', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        accessCodeRequired: true,
        accessVerifiedAt: '2026-08-06T09:00:00.000Z',
      }).allowed,
    ).toBe(true);
  });

  it('refuses when no file path is recorded at all', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        signedFilePath: null,
        sourceFilePath: null,
      }),
    ).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('has calm wording for every refusal it can return', () => {
    const reasons = [
      'code-required',
      'canceled',
      'not-signed',
      'not-permitted',
      'unavailable',
    ] as const;
    for (const reason of reasons) {
      expect(SIGNER_COPY_REFUSAL_COPY[reason]).toBeTruthy();
      expect(SIGNER_COPY_REFUSAL_COPY[reason]).not.toMatch(/[—–]/);
    }
  });
});

/**
 * The rules above are pure and fully covered. Their CALL SITES are not:
 * a route handler, a server action, and two React components that the
 * node test environment cannot run. The failure that started this round
 * was exactly there, in wiring rather than in a rule: the page captured
 * the document-review affirmation, the rule was right, and the route
 * quietly projected five keys and dropped it.
 *
 * So these read the source. That is a weak test and it is said plainly:
 * it proves the call is written, not that it runs. It is here because a
 * decision no caller uses is worth less than no decision at all, and
 * because the specific regressions it catches (re-inlining the consent
 * literal, dropping the abort branch, letting the geometry admission go
 * dead again, going back to a raw target="_blank") are all silent.
 */
describe('call sites', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', rel), 'utf8');

  it('has the sign route project the consent through one function', () => {
    // The projection moved with the rest of the write when the phone
    // needed the same one. It is still exactly one call, in exactly one
    // module, which is the property this test was written to hold.
    const src = read('lib/signature-write.ts');
    expect(src).toMatch(/projectSignerConsentMetadata\(input\.consent\)/);
    // The old hand-rolled literal is what dropped the review keys.
    expect(src).not.toMatch(/electronic_records_consented_at:/);
    // And the route it came out of must not have grown a second one.
    const route = read('app/api/firm/sign/route.ts');
    expect(route).not.toMatch(/projectSignerConsentMetadata\(/);
    expect(route).not.toMatch(/electronic_records_consented_at:/);
  });

  it('has the composer abort rather than send a restriction it lost', () => {
    const src = read('lib/firm-actions.ts');
    expect(src).toMatch(/resolveDownloadColumnFallback\(/);
    expect(src).toMatch(
      /abort-restriction-unsaved'\)?[\s\S]{0,120}SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR/,
    );
  });

  it('has the preview actually show both admissions', () => {
    const src = read('app/sign/[token]/signature-line-preview.tsx');
    expect(src).toMatch(/signaturePreviewGeometryNote\(placement\)/);
    expect(src).toMatch(/\{geometryNote/);
    expect(src).toMatch(/signatureRelocationNote\(placement\)/);
    expect(src).toMatch(/\{relocationNote/);
    // The sentence that is no longer true of the renderer must not
    // survive anywhere in the component either.
    expect(src).not.toMatch(/signatureOverflowNote/);
  });

  it('has both signature surfaces placing the box through one module', () => {
    // The whole point of lib/signature-geometry.ts. If either surface
    // goes back to computing its own rectangle they can drift again,
    // and the signer is shown a position the executed copy will not
    // use. Neither file may multiply a position by a page dimension.
    for (const path of ['lib/signer-view.ts', 'lib/signature-render.ts']) {
      const src = read(path);
      expect(src).toMatch(/computeSignatureBoxRect\(/);
      expect(src).not.toMatch(/Math\.min\(1,\s*(s\.)?position_?[xXyY]/);
    }
  });

  it('has the document view open new tabs through ExternalLink', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    expect(src).toMatch(/<ExternalLink\b/);
    // A raw _blank anchor is the thing that no-ops in the native shell.
    // The prose above the component names it, so this looks for the tag.
    expect(src).not.toMatch(/<a\b[^>]*target="_blank"/s);
    // And the href it is given is relative, which is fine only because
    // ExternalLink resolves it before handing it to the native
    // browser. Without that the open rejects, the fallback assigns
    // window.location, and the signing ceremony on the page is gone.
    const link = read('components/ExternalLink.tsx');
    expect(link).toMatch(/resolveNativeBrowserUrl\(href, window\.location\.href\)/);
    expect(link).toMatch(/Browser\.open\(\{ url \}\)/);
    expect(link).not.toMatch(/Browser\.open\(\{ url: href \}\)/);
  });

  it('has the document view rasterise the page rather than frame it', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    // An iframe is what the mark could not be placed on: the frame is
    // cross-origin, so its scroll and zoom are invisible to us and an
    // overlay would drift the moment the signer moved.
    expect(src).not.toMatch(/<iframe\b/);
    expect(src).toMatch(/renderPageToCanvas\(/);
    expect(src).toMatch(/<canvas ref=\{canvasRef\}/);
    // Measured geometry, which is what retires the Letter assumption.
    expect(src).toMatch(/pageWidthPt: onSignaturePage/);
    expect(src).toMatch(/rotateSignatureRectForDisplay\(/);
  });

  it('has the renderer fetch the document from this origin only', () => {
    const view = read('app/sign/[token]/document-view.tsx');
    const runtime = read('app/sign/[token]/pdf-runtime.ts');
    // The page is unauthenticated and its URL carries a live signing
    // credential, so nothing the renderer needs may come from a CDN.
    expect(view).toMatch(/\/api\/firm\/sign\/document\//);
    expect(view).not.toMatch(/https?:\/\//);
    expect(runtime).not.toMatch(/https?:\/\//);
    for (const src of [view, runtime]) {
      expect(src).not.toMatch(/cdnjs|unpkg|jsdelivr|cdn\./i);
      // cMapUrl and standardFontDataUrl are how pdf.js is normally
      // talked into fetching character maps and standard fonts from
      // somewhere else. Neither is set, and useWorkerFetch is off.
      expect(src).not.toMatch(/(cMapUrl|standardFontDataUrl)\s*:/);
    }
    // wasmUrl IS set, and this used to assert it was not. The
    // invariant is "never cross-origin", not "never set": unset meant
    // the JPEG 2000 decoder could not be reached at all, so a scanned
    // agreement rendered as a blank white page and reported ready.
    // What matters is that the value is an absolute path on this
    // origin, under the same version-locked directory as the worker.
    const wasm = runtime.match(/wasmUrl:\s*`([^`]*)`/);
    expect(wasm?.[1]).toBe('/pdf-worker/${pdfjs.version}/wasm/');
    // pdf.js throws on a factory URL with no trailing slash.
    expect(wasm?.[1].endsWith('/')).toBe(true);
    // And the file it points at is put there by the prebuild copy, not
    // fetched from the package at runtime.
    // The copied list, not the prose above it.
    const copy = read('scripts/copy-pdf-worker.mjs');
    expect(copy).toMatch(/^\s+'openjpeg\.wasm',$/m);
    expect(copy).toMatch(/^\s+'openjpeg_nowasm_fallback\.js',$/m);
    expect(copy).toMatch(/'wasm', filename/);
  });

  it('has the renderer fail a page it did not fully draw', () => {
    const src = read('app/sign/[token]/pdf-runtime.ts');
    // The render task resolving is not the page being drawn: an image
    // pdf.js could not decode is resolved to null, skipped on the
    // canvas, and the task finishes clean over the white fill.
    expect(src).toMatch(/firstDroppedRenderObject\(page\.objs\)/);
    expect(src).toMatch(/if \(dropped\)[\s\S]{0,120}throw new Error/);
    // Released after the check, because cleanup() empties the bag the
    // check reads, and released at all because this page asks the
    // signer to read every page of a document it would otherwise
    // retain in full.
    expect(src).toMatch(/page\.cleanup\(\)/);
    // The CALL, not the import at the top of the file: cleanup()
    // empties the object bag the check reads, so a cleanup that runs
    // first makes the check see an empty page and pass everything.
    expect(src.indexOf('firstDroppedRenderObject(page.objs)')).toBeLessThan(
      src.indexOf('page.cleanup()'),
    );
  });

  it('has the viewer end every wait in a sentence', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    // A stalled body never resolves and never rejects. Without a
    // deadline the signer sits on "Opening the document." with
    // Continue disabled and nothing to act on.
    // The deadline the timer is actually given, not the import.
    expect(src).toMatch(/\}, SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS\);/);
    expect(src).toMatch(/expired\.current = true/);
    // And a render that lands after that may not take the failure
    // back and claim the document was presented.
    expect(src).toMatch(/if \(expired\.current && next === 'ready'\) return;/);
    // A dropped connection is not a damaged file: the transfer has its
    // own catch, and it says the document could not be loaded.
    expect(src).toMatch(/bytes = await res\.arrayBuffer\(\);\s*\n\s*\} catch \{/);
    expect(src).toMatch(/resolveDocumentResponseFailure\(res\.status\)/);
    // The old literal is what turned an empty stored file into "too
    // large" on the signer's screen.
    expect(src).not.toMatch(/res\.status === 413/);
  });

  it('has the runtime load the worker same-origin and refuse eval', () => {
    const src = read('app/sign/[token]/pdf-runtime.ts');
    // Same origin, and the version in the path is the one the library
    // itself reports, so a stale cached worker cannot be served
    // against a newer library: the URL changes instead.
    expect(src).toMatch(
      /workerSrc = `\/pdf-worker\/\$\{pdfjs\.version\}\/pdf\.worker\.min\.mjs`/,
    );
    // The legacy build exists for browsers this app dropped and pays
    // for it in core-js; the one modern method that is genuinely
    // missing in the field is polyfilled instead.
    expect(src).not.toMatch(/pdfjs-dist\/legacy/);
    // Anchored to a line in the options object: the prose above them
    // names both options, so a loose match survived deleting them.
    expect(src).toMatch(/^\s+isEvalSupported: false,$/m);
    expect(src).toMatch(/^\s+useWorkerFetch: false,$/m);
  });

  it('has the document route run the same gate the page does', () => {
    const src = read('app/api/firm/sign/document/[token]/route.ts');
    expect(src).toMatch(/resolveSignerDocumentAccess\(/);
    expect(src).toMatch(/resolveDocumentSizeAcceptance\(/);
    // One refusal table, read from both ends, rather than a status
    // code chosen here and interpreted differently on the page.
    expect(src).toMatch(/resolveDocumentSizeRefusal\(/);
    expect(src).not.toMatch(/refuse\(\s*413/);
    // Asked of the metadata before the bytes are pulled, or the
    // ceiling is measured on a file already resident in the function.
    expect(src.indexOf('.info(access.path)')).toBeGreaterThan(0);
    expect(src.indexOf('.info(access.path)')).toBeLessThan(
      src.indexOf('.download(access.path)'),
    );
    // Hiding a link is not a gate: the token is the only credential on
    // this surface and anyone holding it can call the route directly.
    expect(src).toMatch(/if \(!access\.allowed\)/);
  });

  it('has the byte route enforce the firm download permission itself', () => {
    // The guard this test exists for did not exist. The permission was
    // read by the composer, the counsel side and the copy route, and
    // the route that streams the render source never asked, so a
    // restricted document was one URL away from any token holder.
    const src = read('app/api/firm/sign/document/[token]/route.ts');
    expect(src).toMatch(/resolveSignerDocumentDelivery\(/);
    // The firm's actual decision off the row, not a literal and not a
    // default. A route that hard-codes `downloadPermitted: true` passes
    // every behavioural test of the pure function and reopens the hole.
    expect(src).toMatch(/downloadPermitted: request\.signerCanDownload,/);
    // The purpose comes off the request headers, which is the only
    // thing on the wire that separates the render fetch from a browser
    // pointed at the file, and which page script cannot set.
    expect(src).toMatch(/classifyDocumentRequestPurpose\(/);
    expect(src).toMatch(/req\.headers\.get\('sec-fetch-dest'\)/);
    expect(src).toMatch(/req\.headers\.get\('sec-fetch-mode'\)/);
    // And the answer is acted on. A decision computed and dropped is
    // the same open endpoint with more code in front of it.
    expect(src).toMatch(/if \(!delivery\.serve\)/);
    expect(src).toMatch(/SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY\[delivery\.reason\]/);
    // Before a byte is pulled, or the firm's decision is enforced on a
    // file the function is already holding.
    expect(src.indexOf('resolveSignerDocumentDelivery(')).toBeGreaterThan(0);
    expect(src.indexOf('resolveSignerDocumentDelivery(')).toBeLessThan(
      src.indexOf('.download(access.path)'),
    );
    // Never an attachment. This route is the render source; the
    // signer's own copy is the copy route's job and its permission
    // check is the one that governs retention.
    expect(src).not.toMatch(/'Content-Disposition': [`'"]attachment/);
    expect(src).toMatch(/'Content-Disposition': 'inline'/);
    // The body now varies by what the client said it wanted the bytes
    // for, so an intermediary must not reuse one answer for the other.
    expect(src).toMatch(/'Vary': 'Sec-Fetch-Dest, Sec-Fetch-Mode'/);
  });

  it('stops the viewer offering a door the route holds shut', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    // Both new-tab affordances, the one in the toolbar and the one on
    // the failure card, are gated on the same permission the route
    // enforces. Neither is the gate; both would otherwise walk the
    // signer into a refusal.
    expect(src).toMatch(/\{copyPermitted && \(\s*\n\s*<ExternalLink/);
    expect(src).toMatch(
      /\{copyPermitted && status !== 'too-large' && status !== 'empty' && \(/,
    );
    // And the permission actually reaches it.
    expect(src).toMatch(/copyPermitted: boolean;/);
    const surface = read('app/sign/[token]/signer-surface.tsx');
    expect(surface).toMatch(/copyPermitted=\{copyPermitted\}\s*\n\s*markDataUrl=/);
  });

  it('attributes the signer page to the person reading it', () => {
    const src = read('app/sign/[token]/page.tsx');
    // The layout watermark is gated on a signed-in user and the
    // counterparty never is one, so the page most worth tracing carried
    // no identity at all.
    expect(src).toMatch(/signerWatermarkStamp\(\{/);
    expect(src).toMatch(/signerName: signature\.signerName,/);
    expect(src).toMatch(/signerEmail: signature\.signerEmail,/);
    expect(src).toMatch(/<TraceWatermark stamp=\{watermark\} tone="document" \/>/);
    // The sentence telling the signer the page is marked is conditional
    // on the page actually being marked. A stamp can come back null,
    // and prose asserting a control that is not there is how this repo
    // has ended up with comments describing features nobody built.
    expect(src).toMatch(/\{watermark\s*\n\s*\? ' This page is marked with your name/);
    // The shell tone resolves to white against white through its
    // overlay blend, which is exactly the page the rasteriser paints.
    const mark = read('components/TraceWatermark.tsx');
    expect(mark).toMatch(/tone\?: 'shell' \| 'document';/);
    expect(mark).toMatch(/\.\.\.\(onDocument \? null : \{ mixBlendMode/);
    // Nothing on this surface may claim to stop a screenshot.
    expect(src).not.toMatch(/screenshots? (are|is)? ?(blocked|prevented|disabled)/i);
  });

  it('has documentPresented come from the render, not from a URL', () => {
    const src = read('app/sign/[token]/signer-surface.tsx');
    expect(src).toMatch(/documentPresented=\{isDocumentPresented\(renderStatus\)\}/);
    const page = read('app/sign/[token]/page.tsx');
    // The old page passed Boolean(documentUrl), which was true for a
    // device that downloaded the file instead of displaying it.
    expect(page).not.toMatch(/documentPresented=\{Boolean\(/);
    expect(page).not.toMatch(/getSignerDocumentSignedUrl/);
  });

  it('has the capture step refuse to open on a failed document load', () => {
    const src = read('app/sign/[token]/signature-capture.tsx');
    expect(src).toMatch(/canLeaveDisclosureStep\(/);
    expect(src).toMatch(/disabled=\{!mayLeaveDisclosure\}/);
    // Frozen at the affirmation, not read live at submit. The prop
    // follows the renderer, so a page that fails after the signer
    // reaches the pad would otherwise write document_presented false
    // beside a populated document_reviewed_at - a pair that reads as
    // someone affirming they reviewed a document never shown to them.
    expect(src).toMatch(
      /documentPresented: docPresentedAtReview,\s*\n\s*documentReviewedAt: docReviewedAt,/,
    );
    expect(src).toMatch(
      /setDocReviewedAt\(new Date\(\)\.toISOString\(\)\);\s*\n\s*setDocPresentedAtReview\(documentPresented\);/,
    );
  });

  it('keeps the signer name out of the machine translator', () => {
    const src = read('app/sign/[token]/signature-capture.tsx');
    // A person's name inside the operative clause of a signature.
    //
    // The seam is asserted against the call that renders the rest of
    // the clause, not against the clause itself: the words moved to
    // lib/signing-intent.ts so the phone pad cannot drift from this
    // checkbox, and spelling them out here would put a second copy of
    // them back. tests/signing-intent.test.ts pins the words.
    expect(src).toMatch(
      /<strong data-no-translate>\{signerName \|\| signerEmail\}<\/strong>\s*\n\s*\{signingIntentSuffix\(documentName\)\}/,
    );
    expect(src).toMatch(
      /Thanks, <span data-no-translate>\{signerName \|\| signerEmail\}<\/span>/,
    );
  });
});

/**
 * The internal signer's session gate.
 *
 * The one genuinely new control in this slice, and the reason it is a
 * control rather than a nicety: an internal signer gets no access code
 * (createSigningRequestAction classifies firm members and employees as
 * internal and issues them none), so before this the durable
 * /sign/[token] URL was on its own sufficient to produce a signature in
 * that employee's name on an executed agreement. A link in an inbox is
 * not a credential.
 */
describe('resolveInternalSignerGate', () => {
  const EXTERNAL = { accessCodeRequired: true, signerEmail: 'other@acme.test' };
  const INTERNAL = { accessCodeRequired: false, signerEmail: 'dana@firm.test' };

  it('always allows an external signer, whose code is their proof', () => {
    // Requiring a counterparty to hold an Advottic account before they
    // can sign would break the whole flow this branch exists to build,
    // and their code is already checked in three places.
    expect(
      resolveInternalSignerGate({ ...EXTERNAL, sessionEmail: null }),
    ).toBe('allow');
    expect(
      resolveInternalSignerGate({ ...EXTERNAL, sessionEmail: 'someone@else.test' }),
    ).toBe('allow');
  });

  it('refuses an internal signer with no session', () => {
    expect(
      resolveInternalSignerGate({ ...INTERNAL, sessionEmail: null }),
    ).toBe('sign-in-required');
    expect(
      resolveInternalSignerGate({ ...INTERNAL, sessionEmail: '' }),
    ).toBe('sign-in-required');
    expect(
      resolveInternalSignerGate({ ...INTERNAL, sessionEmail: '   ' }),
    ).toBe('sign-in-required');
  });

  it('refuses an internal signer signed in as somebody else', () => {
    expect(
      resolveInternalSignerGate({ ...INTERNAL, sessionEmail: 'sam@firm.test' }),
    ).toBe('wrong-account');
  });

  it('allows the internal signer whose session matches', () => {
    expect(
      resolveInternalSignerGate({ ...INTERNAL, sessionEmail: 'dana@firm.test' }),
    ).toBe('allow');
  });

  it('normalises case and whitespace on both sides', () => {
    // An identity provider that capitalises a name must not send the
    // right employee to support over a signature they are entitled to
    // make. signer_email is stored lowercased, but the session address
    // comes from the auth provider and is not ours to assume.
    expect(
      resolveInternalSignerGate({
        accessCodeRequired: false,
        signerEmail: '  Dana@Firm.TEST ',
        sessionEmail: 'DANA@firm.test  ',
      }),
    ).toBe('allow');
  });

  it('refuses rather than allows when the row names nobody', () => {
    // A gate that opens when its input is missing is not a gate.
    expect(
      resolveInternalSignerGate({
        accessCodeRequired: false,
        signerEmail: null,
        sessionEmail: 'dana@firm.test',
      }),
    ).toBe('wrong-account');
    expect(
      resolveInternalSignerGate({
        accessCodeRequired: false,
        signerEmail: '',
        sessionEmail: 'dana@firm.test',
      }),
    ).toBe('wrong-account');
  });
});

describe('maskSignerEmail', () => {
  it('keeps the first character and the domain, and hides the rest', () => {
    // Enough for the right person to recognise their own address,
    // not enough for a stranger holding the link to learn it.
    expect(maskSignerEmail('dana@firm.test')).toBe('d•••@firm.test');
  });

  it('masks a one-character local part without exposing its length as zero', () => {
    expect(maskSignerEmail('d@firm.test')).toBe('d•@firm.test');
  });

  it('returns nothing at all for a value that is not an address', () => {
    // A malformed stored value must not be reflected back onto a public
    // page verbatim.
    expect(maskSignerEmail('not-an-address')).toBe('');
    expect(maskSignerEmail('@firm.test')).toBe('');
    expect(maskSignerEmail('dana@')).toBe('');
    expect(maskSignerEmail(null)).toBe('');
    expect(maskSignerEmail(undefined)).toBe('');
  });
});

describe('what the internal-signer refusals say', () => {
  it('sends a signed-out employee somewhere they can actually go', () => {
    expect(INTERNAL_SIGNER_GATE_COPY['sign-in-required']).toBe(
      'Sign in to Advottic to sign this document. It is waiting for you in your Hub.',
    );
  });

  it('names the expected account, masked, on the wrong-account screen', () => {
    const sentence = INTERNAL_SIGNER_GATE_COPY['wrong-account'](
      maskSignerEmail('dana@firm.test'),
    );
    expect(sentence).toBe(
      'This document is waiting for a different account. Sign in as d•••@firm.test to continue.',
    );
    // The unmasked address never appears in it.
    expect(sentence).not.toContain('dana@');
  });

  it('carries no em dash and no emoji, in either sentence', () => {
    const sentences = [
      INTERNAL_SIGNER_GATE_COPY['sign-in-required'],
      INTERNAL_SIGNER_GATE_COPY['wrong-account']('d\u2022\u2022\u2022@firm.test'),
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});

/**
 * The gate has to be RUN, not merely written.
 *
 * Two agents on this repo have now found controls that existed and had
 * nothing exercising them. These read the source, which proves the call
 * is written rather than that it fires, and they are here because the
 * failure mode is silent: a gate enforced on the page alone is not a
 * gate, since the write is a public HTTP endpoint reachable with the
 * token and nothing else.
 */
describe('where the internal-signer gate and the signing order are enforced', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('runs the session gate inside the one signature write', () => {
    // lib/signature-write.ts is what BOTH the desktop route and the
    // phone route call, so a check here covers both without either
    // route holding a copy of it.
    const src = read('lib/signature-write.ts');
    expect(src).toMatch(/resolveInternalSignerGate\(/);
    expect(src).toMatch(/INTERNAL_SIGNER_GATE_COPY/);
  });

  it('runs the session gate on the page as well, so the employee is told before they draw', () => {
    const src = read('app/sign/[token]/page.tsx');
    expect(src).toMatch(/resolveInternalSignerGate\(/);
  });

  it('keeps the two routes free of a copy of it', () => {
    // A second implementation of this decision in a route is how the
    // desktop and the phone start disagreeing about who may sign.
    expect(read('app/api/firm/sign/route.ts')).not.toMatch(
      /resolveInternalSignerGate|access_code_hash/,
    );
    expect(read('app/api/firm/sign/mobile/route.ts')).not.toMatch(
      /resolveInternalSignerGate|access_code_hash/,
    );
  });

  it('refuses an out-of-turn signature in the write, not only in the page', () => {
    const src = read('lib/signature-write.ts');
    expect(src).toMatch(/resolveSignerTurn\(/);
    expect(src).toMatch(/SIGNER_NOT_YET_YOUR_TURN/);
    const page = read('app/sign/[token]/page.tsx');
    expect(page).toMatch(/resolveSignerTurn\(/);
  });

  it('still stamps signed_at in exactly one place', () => {
    // The claim in lib/signature-write.ts is the only writer, and the
    // ordering check was added to that same conditional update rather
    // than beside a second one.
    const src = read('lib/signature-write.ts');
    const writes = src.match(/signed_at: new Date\(\)\.toISOString\(\)/g) ?? [];
    expect(writes).toHaveLength(1);
  });
});
