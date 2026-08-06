/**
 * Pure page geometry for the executed-PDF signature stamp.
 *
 * Why this is a separate module
 * ----------------------------
 * signature-render.ts used to compute the stamp rectangle inline:
 *
 *   const x = clamp01(position_x ?? 0.07) * pageWidth;
 *   const y = clamp01(position_y ?? 0.07) * pageHeight;
 *   // ... then draw a fixed 220 x 64 point box starting at (x, y)
 *
 * clamp01 bounds the FRACTION to 0..1. Nothing bounded the resulting
 * BOX to the page. Once position_x passed 1 - 220/pageWidth the box
 * ran off the right edge and pdf-lib simply did not draw the overflow.
 * At position_x = 0.95 on US Letter that is 189 of the 220 points,
 * about 31% of the page width, gone. The same held on the vertical
 * axis for position_y and the box height, and for the caption drawn
 * 10 points BELOW the box, which fell off the bottom for any
 * position_y under about 0.013.
 *
 * The renderer needs the Supabase client and pdf-lib, so its geometry
 * could not be exercised by a unit test. Vitest here is
 * environment: 'node' with no DOM and no PDF fixtures. Extracting the
 * arithmetic into a dependency-free module makes the part that was
 * actually wrong directly testable.
 *
 * Coordinate system
 * -----------------
 * PDF-native: origin at the bottom-left of the page, units in points
 * (1pt = 1/72in), y increasing upward. position_x / position_y are
 * persisted in firm_signatures as 0-1 fractions of the page so
 * downstream consumers do not need to know the page size.
 *
 * What "fits on the page" means here
 * ----------------------------------
 * The stamp is not just the signature box. The renderer also draws a
 * caption (signer name and signed-on date) below it, and that caption
 * is what makes the executed instrument legible on its own, away from
 * the audit trail. So the footprint this module keeps on the page is
 * the box PLUS a reserved caption band underneath it. A box that sits
 * on the page with its caption hanging off the bottom edge is the
 * same defect one line lower down.
 */

/** Default signature box, in points. Mirrors signature-anchors.ts. */
export const SIGNATURE_BOX_WIDTH_PT = 220;
export const SIGNATURE_BOX_HEIGHT_PT = 64;
/**
 * Distance from the box bottom down to the caption baseline, and the
 * total vertical band reserved for the caption. The band is slightly
 * taller than the offset so an 8pt font's descenders stay on the page
 * rather than being clipped by the page edge.
 */
export const SIGNATURE_CAPTION_OFFSET_PT = 10;
export const SIGNATURE_CAPTION_BAND_PT = 12;
/**
 * Fraction used when a signature row carries no position at all. This
 * is the renderer's historical default and is kept so rows written
 * before positions were always populated render where they always did.
 */
export const SIGNATURE_DEFAULT_FRACTION = 0.07;

export type SignatureBoxInput = {
  /** 0-1 fraction of page width. Null, undefined and non-finite fall back to the default. */
  positionX?: number | null;
  /** 0-1 fraction of page height, measured from the page BOTTOM. */
  positionY?: number | null;
  pageWidthPt: number;
  pageHeightPt: number;
  boxWidthPt?: number;
  boxHeightPt?: number;
  captionOffsetPt?: number;
  captionBandPt?: number;
};

export type SignatureBoxRect = {
  /** Left edge of the drawn box, in points, guaranteed on the page. */
  x: number;
  /** Bottom edge of the drawn box, in points, guaranteed on the page. */
  y: number;
  /** Box width, reduced only when the page is narrower than the box. */
  width: number;
  /** Box height, reduced only when the page is shorter than box + caption. */
  height: number;
  /** Baseline y for the caption. Always at or above the page bottom. */
  captionY: number;
  /** Where the un-clamped arithmetic would have put the box. */
  requestedX: number;
  requestedY: number;
  /** How far the box was moved to get it back on the page. Signed. */
  dxPt: number;
  dyPt: number;
  /** True when the box had to be moved on either axis. */
  relocated: boolean;
  /** True when the box had to be made smaller to fit a small page. */
  shrunk: boolean;
};

/**
 * Every call site below establishes max >= min before calling this, so
 * there is deliberately no inverted-range branch here. An earlier draft
 * had one; it was unreachable, which means it could not be tested, and
 * an untested branch in placement arithmetic is a liability rather than
 * a safety net. The band/height derivation in computeSignatureBoxRect
 * is what actually guarantees the ordering.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve a 0-1 fraction from a stored position, tolerating null,
 * undefined and non-finite values, and bounding it to 0..1.
 */
function resolveFraction(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SIGNATURE_DEFAULT_FRACTION;
  }
  return clamp(value, 0, 1);
}

/**
 * Place the signature box on the page so the whole box, and the
 * caption band under it, land inside the page rectangle.
 *
 * Positive dimensions are required. A page with a non-finite or
 * non-positive size cannot be reasoned about, so the box collapses to
 * the origin rather than producing NaN coordinates that pdf-lib would
 * happily write into the content stream.
 */
export function computeSignatureBoxRect(
  input: SignatureBoxInput,
): SignatureBoxRect {
  const pw = input.pageWidthPt;
  const ph = input.pageHeightPt;
  const boxW = input.boxWidthPt ?? SIGNATURE_BOX_WIDTH_PT;
  const boxH = input.boxHeightPt ?? SIGNATURE_BOX_HEIGHT_PT;
  const captionOffset = input.captionOffsetPt ?? SIGNATURE_CAPTION_OFFSET_PT;
  const captionBand = input.captionBandPt ?? SIGNATURE_CAPTION_BAND_PT;

  if (
    !Number.isFinite(pw) ||
    !Number.isFinite(ph) ||
    pw <= 0 ||
    ph <= 0 ||
    !Number.isFinite(boxW) ||
    !Number.isFinite(boxH) ||
    boxW <= 0 ||
    boxH <= 0
  ) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      captionY: 0,
      requestedX: 0,
      requestedY: 0,
      dxPt: 0,
      dyPt: 0,
      relocated: false,
      shrunk: true,
    };
  }

  // Shrink before placing. A box wider or taller than the page can
  // never be positioned onto it, so clamping alone would still leave
  // part of the signature off the edge.
  //
  // width <= pw, so pw - width >= 0.
  const width = Math.min(boxW, pw);
  // band <= ph, so ph - band >= 0, so height >= 0 and ph - height >=
  // band. That ordering is what lets clamp() below drop its
  // inverted-range branch. A page shorter than the caption band leaves
  // height at 0, and the renderer skips a zero-height rect rather than
  // stamping an illegible smear onto a page that cannot hold one.
  const band = Math.min(Math.max(captionBand, 0), ph);
  const height = Math.min(boxH, ph - band);

  const requestedX = resolveFraction(input.positionX) * pw;
  const requestedY = resolveFraction(input.positionY) * ph;

  const x = clamp(requestedX, 0, pw - width);
  const y = clamp(requestedY, band, ph - height);

  // Normally redundant: y >= band >= captionOffset on any page tall
  // enough to hold the band, so y - captionOffset is already positive.
  // It is load-bearing on a page too short for the band, where the rect
  // is unusable anyway but must still not carry a negative coordinate.
  const captionY = Math.max(0, y - captionOffset);

  return {
    x,
    y,
    width,
    height,
    captionY,
    requestedX,
    requestedY,
    dxPt: x - requestedX,
    dyPt: y - requestedY,
    relocated: x !== requestedX || y !== requestedY,
    shrunk: width < boxW || height < boxH,
  };
}

export type SignaturePageResolution = {
  /** 0-based index into the page array. Always addressable. */
  index: number;
  /** 1-based page the signature row asked for, after coercion. */
  requestedPage: number;
  /** True when the requested page does not exist and we fell back. */
  relocated: boolean;
};

/**
 * Resolve a stored 1-indexed position_page against the real page
 * count. The renderer already fell back to the first page for an
 * out-of-range value; this makes that fallback explicit so it can be
 * recorded rather than being a second silent move.
 */
export function resolveSignaturePageIndex(
  positionPage: number | null | undefined,
  pageCount: number,
): SignaturePageResolution {
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    return { index: 0, requestedPage: 1, relocated: false };
  }
  const raw =
    typeof positionPage === 'number' && Number.isFinite(positionPage)
      ? Math.floor(positionPage)
      : 1;
  const requestedPage = Math.max(1, raw);
  const index = requestedPage - 1;
  if (index < pageCount) {
    return { index, requestedPage, relocated: false };
  }
  return { index: 0, requestedPage, relocated: true };
}
