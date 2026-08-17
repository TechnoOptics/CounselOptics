import { describe, expect, it } from 'vitest';

import {
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
  parseFieldBoxes,
  serializeFieldBoxes,
  type FieldBox,
} from '../lib/template-field-boxes';

/**
 * A RECORDED BLANK CARRIES THE PAGE IT WAS RECORDED ON.
 *
 * parseFieldBoxes bounds a stored coordinate, and it has to: an unbounded value
 * out of jsonb reaches pdf-lib and a NaN reaches the signing overlay. What it
 * bounded against was the module's own Letter constant, which is correct for
 * exactly as long as every document in the corpus is Letter.
 *
 * The moment a second page size exists, that clamp MOVES boxes. A blank recorded
 * at x = 700 on a landscape page comes back at 612, 88 points to the left, on the
 * page the counterparty types into and on the executed instrument, with nothing
 * thrown and nothing logged. The bound is right and the yardstick was wrong.
 *
 * WHY NOW. firm_template_submissions.field_boxes has 0 populated rows in
 * production, so recording the page beside the box costs nothing today and can
 * never be free again. A row written before this change has no page size on it,
 * which is not missing data: those rows were all Letter, so the Letter default is
 * the right yardstick for them and is what they still get.
 */

const LETTER_BOX: FieldBox = {
  key: 'entity_name',
  page: 1,
  x: 64,
  y: 600,
  widthPt: 240,
  heightPt: 14,
};

describe('the page a blank was recorded on survives the round trip', () => {
  it('keeps the recorded page size through serialize and parse', () => {
    const box: FieldBox = { ...LETTER_BOX, pageWidthPt: 595.28, pageHeightPt: 841.89 };
    const back = parseFieldBoxes(serializeFieldBoxes([box]));
    expect(back).toHaveLength(1);
    expect(back[0].pageWidthPt).toBeCloseTo(595.28, 2);
    expect(back[0].pageHeightPt).toBeCloseTo(841.89, 2);
  });

  it('bounds a wide-page blank against ITS OWN page, not against Letter', () => {
    // Landscape Letter: 792 x 612. A blank near the right edge of that page is
    // past the width of a portrait one. Clamped to the module default it lands
    // 100 points to the left of where the renderer drew it.
    const landscape: FieldBox = {
      key: 'entity_name',
      page: 1,
      x: 700,
      y: 300,
      widthPt: 60,
      heightPt: 14,
      pageWidthPt: 792,
      pageHeightPt: 612,
    };
    const back = parseFieldBoxes(serializeFieldBoxes([landscape]));
    expect(back[0].x).toBeCloseTo(700, 2);
  });

  it('still bounds a blank that claims a coordinate off its own page', () => {
    const corrupt: FieldBox = {
      ...LETTER_BOX,
      x: 100000,
      pageWidthPt: 612,
      pageHeightPt: 792,
    };
    const back = parseFieldBoxes(serializeFieldBoxes([corrupt]));
    expect(back[0].x).toBeLessThanOrEqual(612);
  });

  it('bounds a legacy blank with no recorded page against Letter, which is what it was', () => {
    const legacy = {
      key: 'entity_name',
      page: 1,
      x: 100000,
      y: 100000,
      widthPt: 240,
      heightPt: 14,
    };
    const back = parseFieldBoxes([legacy]);
    expect(back[0].x).toBe(RENDERED_PAGE_WIDTH_PT);
    expect(back[0].y).toBe(RENDERED_PAGE_HEIGHT_PT);
    // Absent rather than invented. A page size this module guessed would be
    // indistinguishable from one the renderer measured.
    expect(back[0].pageWidthPt).toBeUndefined();
    expect(back[0].pageHeightPt).toBeUndefined();
  });

  it('drops a page size that is not a page rather than bounding against nonsense', () => {
    const back = parseFieldBoxes([
      { ...LETTER_BOX, x: 100000, pageWidthPt: 'wide', pageHeightPt: 0 },
    ]);
    expect(back).toHaveLength(1);
    expect(back[0].pageWidthPt).toBeUndefined();
    expect(back[0].x).toBe(RENDERED_PAGE_WIDTH_PT);
  });

  it('round-trips a legacy box unchanged, so no stored row is rewritten', () => {
    expect(parseFieldBoxes(serializeFieldBoxes([LETTER_BOX]))).toEqual([LETTER_BOX]);
  });
});
