import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ASSUMED_PAGE_HEIGHT_PT,
  ASSUMED_PAGE_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_BOX_WIDTH_PT,
  SIGNER_CANVAS_MAX_PIXELS,
  SIGNER_CANVAS_MAX_SIDE_PX,
  SIGNER_COPY_REFUSAL_COPY,
  SIGNER_DOCUMENT_MAX_BYTES,
  SIGNER_DOCUMENT_REFUSAL_COPY,
  SIGNER_DOCUMENT_RENDER_COPY,
  SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR,
  canLeaveDisclosureStep,
  clampSignerPageNumber,
  isDocumentPresented,
  isUnknownColumnError,
  needsPromiseWithResolvers,
  parseSignerDownloadPermission,
  projectSignerConsentMetadata,
  resolveCanvasRenderScale,
  resolveDocumentSizeAcceptance,
  resolveDownloadColumnFallback,
  resolveSignatureLinePlacement,
  resolveSignerCopyAccess,
  resolveSignerDocumentAccess,
  rotateSignatureRectForDisplay,
  signatureOverflowNote,
  signaturePreviewGeometryNote,
  type SignatureLinePlacement,
} from '../lib/signer-view';

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
 * The renderer's arithmetic is written out again here rather than
 * imported. Importing it would let one bug satisfy both sides; writing
 * it out means the two have to agree independently, and a change to
 * either one that moves the box shows up as a failure rather than as a
 * signature somewhere the signer never saw.
 *
 * Mirrors lib/signature-render.ts:
 *   const x = Math.max(0, Math.min(1, s.position_x ?? 0.07)) * pw;
 *   const y = Math.max(0, Math.min(1, s.position_y ?? 0.07)) * ph;
 *   const boxW = 220; const boxH = 64;
 *   page.drawImage(image, { x: x + ..., y: y + ..., ... });
 */
function rendererBoxInPoints(
  positionX: number,
  positionY: number,
  pageWidthPt: number,
  pageHeightPt: number,
) {
  return {
    leftPt: Math.max(0, Math.min(1, positionX)) * pageWidthPt,
    bottomPt: Math.max(0, Math.min(1, positionY)) * pageHeightPt,
    widthPt: SIGNATURE_BOX_WIDTH_PT,
    heightPt: SIGNATURE_BOX_HEIGHT_PT,
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

  // The specific regression. A containment clamp made the drawing
  // disagree with the stamp above x = 1 - 220/pageWidth, and computed
  // that threshold from an assumed Letter width so it engaged in the
  // wrong place on every other page size.
  it('does not pull an anchor near the right edge back onto the page', () => {
    const placement = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.95,
      positionY: 0.1,
      pageWidthPt: 612,
      pageHeightPt: 792,
      pageCount: 1,
    });
    if (placement.mode !== 'placed') throw new Error('expected a placed signature');
    expect(placement.leftPct).toBeCloseTo(95, 6);
    expect(placement.leftPct + placement.widthPct).toBeGreaterThan(100);
    expect(placement.overflowsPage).toBe(true);
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

  // The reason the note still exists after the clamp was removed. The
  // assumed page size no longer moves the box HORIZONTALLY at all, but
  // the box height is a fraction of the page height, so the top edge
  // still moves: 64/792 on Letter against 64/595 on A4 landscape.
  it('covers a vertical position the assumed page size actually moves', () => {
    const assumedTop = resolveSignatureLinePlacement({
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
    if (assumedTop.mode !== 'placed' || landscape.mode !== 'placed') {
      throw new Error('expected placed signatures');
    }
    expect(assumedTop.leftPct).toBeCloseTo(landscape.leftPct, 6);
    expect(Math.abs(assumedTop.topPct - landscape.topPct)).toBeGreaterThan(1);
    expect(signaturePreviewGeometryNote(assumedTop)).toBeTruthy();
  });
});

describe('signatureOverflowNote', () => {
  const overflowing = resolveSignatureLinePlacement({
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

  it('warns when part of the signature will fall off the page', () => {
    const note = signatureOverflowNote(overflowing);
    expect(note).toBeTruthy();
    expect(note).toMatch(/past the edge/i);
  });

  it('says nothing when the whole box is on the page', () => {
    expect(signatureOverflowNote(contained)).toBeNull();
  });

  it('says nothing when there is no placement to qualify', () => {
    expect(
      signatureOverflowNote({ mode: 'deferred', reason: 'no-recorded-position' }),
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
    expect(p.topPct).toBeLessThan(0);
    expect(p.overflowsPage).toBe(true);
    expect(signatureOverflowNote(p)).toBeTruthy();
  });

  it('does not cry overflow for a box exactly on the edge', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 1 - SIGNATURE_BOX_WIDTH_PT / 612,
      positionY: 1 - SIGNATURE_BOX_HEIGHT_PT / 792,
      pageWidthPt: 612,
      pageHeightPt: 792,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed signature');
    expect(p.overflowsPage).toBe(false);
  });

  it('is calm and carries no em dash', () => {
    expect(signatureOverflowNote(overflowing)).not.toMatch(/[—–]/);
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
    // x clamps to 1: the box STARTS at the right edge and hangs off it,
    // which is exactly where the renderer puts it.
    expect(p.leftPct).toBeCloseTo(100, 6);
    // y clamps to 0, the bottom edge of the page.
    expect(p.topPct).toBeCloseTo((1 - SIGNATURE_BOX_HEIGHT_PT / 800) * 100, 6);
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
    const src = read('app/api/firm/sign/route.ts');
    expect(src).toMatch(/projectSignerConsentMetadata\(payload\.consent\)/);
    // The old hand-rolled literal is what dropped the review keys.
    expect(src).not.toMatch(/electronic_records_consented_at:/);
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
    expect(src).toMatch(/signatureOverflowNote\(placement\)/);
    expect(src).toMatch(/\{overflowNote/);
  });

  it('has the document view open new tabs through ExternalLink', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    expect(src).toMatch(/<ExternalLink\b/);
    // A raw _blank anchor is the thing that no-ops in the native shell.
    // The prose above the component names it, so this looks for the tag.
    expect(src).not.toMatch(/<a\b[^>]*target="_blank"/s);
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
      expect(src).not.toMatch(/(cMapUrl|standardFontDataUrl|wasmUrl)\s*:/);
    }
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
    // Hiding a link is not a gate: the token is the only credential on
    // this surface and anyone holding it can call the route directly.
    expect(src).toMatch(/if \(!access\.allowed\)/);
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
    expect(src).toMatch(/documentPresented,\s*\n\s*documentReviewedAt/);
  });
});
