import { describe, expect, it } from 'vitest';
import { cleanLegalText } from '../lib/legal-templates';
import {
  FIELD_TEXT_MIN_SIZE_PT,
  MARKER_UNDERSCORE_RUN,
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
  boxForKey,
  boxesForKey,
  counterpartyMarker,
  fieldBoxKeys,
  fieldRectToDisplayFractions,
  findLineMarkers,
  isCounterpartyMarker,
  parseFieldBoxes,
  resolveFieldBoxRect,
  resolveFieldTextSize,
  resolveMarkerBoxWidth,
  serializeFieldBoxes,
  type FieldBox,
} from '../lib/template-field-boxes';

/**
 * The blank the counterparty fills, and the one arithmetic both ends of the
 * ceremony run over it.
 *
 * Every case below exists because getting it wrong has a named consequence,
 * and the consequence is in the comment rather than in a commit message
 * nobody will read again.
 */

describe('counterpartyMarker', () => {
  it('is exactly this string, pinned', () => {
    // Pinned, not derived. The marker is written into stored document_text
    // that is reviewed and approved by counsel; changing it silently would
    // orphan the blanks in every document already filed under the old one.
    expect(counterpartyMarker('entity_name')).toBe('_____<<entity_name>>_____');
    expect(MARKER_UNDERSCORE_RUN).toBe(5);
  });

  it('is WinAnsi-encodable, because pdf-lib throws on anything else', () => {
    // pdf-lib's StandardFonts encode WinAnsi. A character outside it is not
    // rendered badly, it throws in the middle of the render, which would take
    // the whole document down for one field key.
    for (const key of ['entity_name', 'address_line_1', 'title']) {
      for (const ch of counterpartyMarker(key)) {
        expect(ch.codePointAt(0)).toBeLessThan(0x100);
      }
    }
  });

  it('carries no whitespace, so word wrap cannot split a blank in two', () => {
    // The renderer's wrap() splits on /(\s+)/ and only ever breaks between
    // tokens. A marker containing a space could land half on one line and
    // half on the next, and the recorded box would describe neither half.
    expect(/\s/.test(counterpartyMarker('entity_name'))).toBe(false);
  });

  it('survives cleanLegalText unchanged', () => {
    // cleanLegalText runs over document_text before the renderer lays it out.
    // Two of its rules nearly ate this marker: markdown emphasis (_x_), which
    // the doubled underscore blocks, and the bracketed meta-note strip
    // /\[(?:note|ai|assistant)[^\]]*\]/, which is why the sentinel uses angle
    // brackets and not square ones.
    for (const key of [
      'entity_name',
      'note_to_counsel',
      'ai_contact',
      'assistant_name',
      'address_line_1',
    ]) {
      const marker = counterpartyMarker(key);
      const line = `Entity name: ${marker}`;
      expect(cleanLegalText(line)).toBe(line);
      expect(cleanLegalText(line)).toContain(marker);
    }
  });

  it('survives cleanLegalText with two blanks on one line', () => {
    // The second marker's leading underscore run is preceded by a space,
    // which is the one position the emphasis rule can start from.
    const line = `${counterpartyMarker('city')} ${counterpartyMarker('state')}`;
    expect(cleanLegalText(line)).toBe(line);
  });

  it('is not a signature line', () => {
    // lib/signature-anchors.ts treats a run of six underscores as a place to
    // put a signature. A blank for the other side's address is not that, and
    // the sentinel is the positive identification rather than the run length.
    const marker = counterpartyMarker('entity_name');
    expect(/_{6,}/.test(marker)).toBe(false);
    expect(/-{8,}/.test(marker)).toBe(false);
    expect(/\bX\s*_{3,}/.test(marker)).toBe(false);
    expect(/(\bSignature\s*(of\b|:)|\bSigned\s+by\b|\/s\/)/i.test(marker)).toBe(false);
    expect(isCounterpartyMarker(marker)).toBe(true);
    expect(isCounterpartyMarker('____________________')).toBe(false);
    expect(isCounterpartyMarker('Signature:')).toBe(false);
  });
});

describe('findLineMarkers', () => {
  it('finds every marker on a line, in order, with its index', () => {
    const a = counterpartyMarker('city');
    const b = counterpartyMarker('state');
    const line = `Address: ${a}, ${b}`;
    expect(findLineMarkers(line)).toEqual([
      { key: 'city', index: 9, text: a },
      { key: 'state', index: 9 + a.length + 2, text: b },
    ]);
  });

  it('does not carry lastIndex between calls', () => {
    // A module-level /g pattern remembers where it stopped, which would skip
    // the marker on every second line of the document.
    const line = `X ${counterpartyMarker('city')}`;
    expect(findLineMarkers(line)).toHaveLength(1);
    expect(findLineMarkers(line)).toHaveLength(1);
    expect(findLineMarkers(line)).toHaveLength(1);
  });

  it('ignores a key shape sanitizeFields could never produce', () => {
    // sanitizeFields narrows keys to [a-z0-9_] and 40 characters. Anything
    // else is not a key, so it is not a blank.
    expect(findLineMarkers('_____<<Entity Name>>_____')).toEqual([]);
    expect(findLineMarkers('_____<<entity-name>>_____')).toEqual([]);
    expect(findLineMarkers('____<<entity_name>>____')).toEqual([]);
    expect(findLineMarkers('<<entity_name>>')).toEqual([]);
  });
});

describe('resolveMarkerBoxWidth', () => {
  const measure = 484; // 612 - 2 * 64, the renderer's own content width

  it('takes the rest of the measure when the blank ends the line', () => {
    // The marker is about two inches, which is short for an entity name, and
    // a blank at the end of a line has the rest of the line to spend.
    expect(
      resolveMarkerBoxWidth({
        markerWidthPt: 120,
        trailingSpaceWidthPt: 0,
        xFromMarginPt: 100,
        contentWidthPt: measure,
        endsLine: true,
      }),
    ).toBe(384);
  });

  it('takes only its own width plus following spaces mid-line', () => {
    // The executed copy covers this box with an opaque rectangle before
    // drawing into it. A box wider than the blank would erase the words
    // beside it, which is a defaced instrument rather than a filled one.
    expect(
      resolveMarkerBoxWidth({
        markerWidthPt: 120,
        trailingSpaceWidthPt: 8,
        xFromMarginPt: 100,
        contentWidthPt: measure,
        endsLine: false,
      }),
    ).toBe(128);
  });

  it('never runs past the right margin', () => {
    // Trailing spaces on a wrapped line can measure more than the room left
    // on it. The cover rectangle has to stay inside the text measure or it
    // paints over the page margin.
    expect(
      resolveMarkerBoxWidth({
        markerWidthPt: 120,
        trailingSpaceWidthPt: 900,
        xFromMarginPt: 300,
        contentWidthPt: measure,
        endsLine: false,
      }),
    ).toBe(184);
  });

  it('never returns less than the marker it is covering', () => {
    // Below the marker's own width the cover rectangle would leave the tail
    // of the sentinel showing on the executed copy. wrap() cannot actually
    // produce a line this shape, because it breaks a line that exceeds the
    // measure, but a box narrower than what it covers is the one outcome
    // that must not be reachable by arithmetic.
    for (const endsLine of [true, false]) {
      expect(
        resolveMarkerBoxWidth({
          markerWidthPt: 120,
          trailingSpaceWidthPt: 900,
          xFromMarginPt: 480,
          contentWidthPt: measure,
          endsLine,
        }),
      ).toBe(120);
    }
  });
});

describe('resolveFieldTextSize', () => {
  it('leaves a value that fits at the body size', () => {
    expect(
      resolveFieldTextSize({ naturalWidthPt: 80, boxWidthPt: 120, baseSizePt: 11 }),
    ).toEqual({ sizePt: 11, shrunk: false, overflows: false });
  });

  it('shrinks a value that does not, proportionally', () => {
    // Times widths scale linearly with point size, so the fitted size is one
    // division rather than a search.
    const fit = resolveFieldTextSize({
      naturalWidthPt: 130,
      boxWidthPt: 110,
      baseSizePt: 11,
    });
    expect(fit.sizePt).toBeCloseTo((11 * 110) / 130, 9);
    expect(fit.shrunk).toBe(true);
    expect(fit.overflows).toBe(false);
  });

  it('floors rather than shrinking without limit', () => {
    // A value squeezed to four points is not legible, and an executed
    // instrument nobody can read is worse than one that runs a little wide.
    const fit = resolveFieldTextSize({
      naturalWidthPt: 2000,
      boxWidthPt: 100,
      baseSizePt: 11,
    });
    expect(fit.sizePt).toBe(FIELD_TEXT_MIN_SIZE_PT);
    expect(fit.overflows).toBe(true);
  });
});

describe('parseFieldBoxes', () => {
  const good = {
    key: 'entity_name',
    page: 2,
    x: 120.5,
    y: 400.25,
    widthPt: 200,
    heightPt: 16,
  };

  it('reads a well-formed record back unchanged', () => {
    expect(parseFieldBoxes([good])).toEqual([good]);
  });

  it('drops malformed entries rather than throwing', () => {
    // The signing page must render. A blank that cannot be trusted is not
    // offered; a page that will not open is a signer who cannot sign.
    const boxes = parseFieldBoxes([
      null,
      'nope',
      { ...good, key: 'Entity Name' },
      { ...good, key: '' },
      { ...good, page: 0 },
      { ...good, x: Number.NaN },
      { ...good, y: 'high' },
      { ...good, widthPt: 0 },
      { ...good, heightPt: -3 },
      good,
    ]);
    expect(boxes).toEqual([good]);
  });

  it('keeps a repeated key, because a document can carry the same blank twice', () => {
    // "between {{entity_name}} ... signed for {{entity_name}}" is an ordinary
    // instrument. Deduplicating here would leave the second blank showing a
    // raw marker on the executed copy.
    const twice = parseFieldBoxes([good, { ...good, page: 3, y: 100 }]);
    expect(twice).toHaveLength(2);
    expect(boxesForKey(twice, 'entity_name')).toHaveLength(2);
    expect(fieldBoxKeys(twice)).toEqual(['entity_name']);
  });

  it('bounds every coordinate to the page the renderer draws', () => {
    // One renderer, one fixed page size, so a coordinate outside it is
    // corrupt by definition and a NaN or a 10,000 would reach pdf-lib.
    expect(
      parseFieldBoxes([
        { ...good, x: -40, y: 99999, widthPt: 5000, heightPt: 4000 },
      ]),
    ).toEqual([
      {
        key: 'entity_name',
        page: 2,
        x: 0,
        y: RENDERED_PAGE_HEIGHT_PT,
        widthPt: RENDERED_PAGE_WIDTH_PT,
        heightPt: RENDERED_PAGE_HEIGHT_PT,
      },
    ]);
  });

  it('answers an absent, null or non-array column with no blanks', () => {
    // Which is what an unapplied migration returns, and it must read as "this
    // template has no counterparty fields" rather than as an error.
    expect(parseFieldBoxes(undefined)).toEqual([]);
    expect(parseFieldBoxes(null)).toEqual([]);
    expect(parseFieldBoxes({})).toEqual([]);
  });

  it('round-trips through serializeFieldBoxes', () => {
    const boxes: FieldBox[] = [good, { ...good, key: 'city', page: 1 }];
    expect(parseFieldBoxes(serializeFieldBoxes(boxes))).toEqual(boxes);
  });
});

describe('boxForKey', () => {
  const boxes: FieldBox[] = [
    { key: 'city', page: 1, x: 10, y: 20, widthPt: 100, heightPt: 16 },
    { key: 'state', page: 1, x: 120, y: 20, widthPt: 100, heightPt: 16 },
  ];
  it('finds the box, or says there is none', () => {
    expect(boxForKey(boxes, 'state')?.x).toBe(120);
    expect(boxForKey(boxes, 'zip')).toBeNull();
    expect(boxForKey(null, 'city')).toBeNull();
  });
});

/**
 * THE INVARIANT THIS SLICE EXISTS TO PROTECT.
 *
 * The live overlay the signer confirms and the stamp on the executed PDF must
 * put a typed value in the same place. They do not agree by care: they agree
 * because both call resolveFieldBoxRect on the same recorded box, and the
 * only thing the overlay does afterwards is convert PDF points (origin
 * bottom-left) into CSS fractions (origin top-left).
 *
 * So the test converts the overlay's fractions back into points and asserts
 * they reproduce the stamp's rectangle exactly. Anything that lets the two
 * ends diverge, including an overlay that reads box.x instead of rect.x,
 * fails here.
 */
describe('preview equals delivered', () => {
  const page = { pageWidthPt: 612, pageHeightPt: 792 };

  const cases: Array<{ name: string; box: FieldBox }> = [
    {
      name: 'an ordinary blank in the body',
      box: { key: 'entity_name', page: 1, x: 140, y: 560, widthPt: 300, heightPt: 16 },
    },
    {
      name: 'a blank whose box would run off the right edge',
      box: { key: 'entity_name', page: 1, x: 590, y: 560, widthPt: 300, heightPt: 16 },
    },
    {
      name: 'a blank at the very bottom of the page',
      box: { key: 'entity_name', page: 3, x: 64, y: 0, widthPt: 200, heightPt: 16 },
    },
    {
      name: 'a blank recorded above the top of the page',
      box: { key: 'entity_name', page: 1, x: 64, y: 790, widthPt: 200, heightPt: 16 },
    },
  ];

  for (const c of cases) {
    it(`puts ${c.name} in one place`, () => {
      // What lib/signature-render.ts draws into.
      const stamp = resolveFieldBoxRect(c.box, page);
      // What app/sign/[token]/document-view.tsx positions with.
      const fractions = fieldRectToDisplayFractions(stamp, page);

      // Back to PDF points, which is the comparison that means anything.
      const backX = fractions.leftFrac * page.pageWidthPt;
      const backWidth = fractions.widthFrac * page.pageWidthPt;
      const backHeight = fractions.heightFrac * page.pageHeightPt;
      const backY =
        page.pageHeightPt - fractions.topFrac * page.pageHeightPt - backHeight;

      expect(backX).toBeCloseTo(stamp.x, 9);
      expect(backY).toBeCloseTo(stamp.y, 9);
      expect(backWidth).toBeCloseTo(stamp.width, 9);
      expect(backHeight).toBeCloseTo(stamp.height, 9);

      // And the rectangle is on the page, which is the thing the clamp buys
      // and the thing pdf-lib silently drops without it.
      expect(stamp.x).toBeGreaterThanOrEqual(0);
      expect(stamp.y).toBeGreaterThanOrEqual(0);
      expect(stamp.x + stamp.width).toBeLessThanOrEqual(page.pageWidthPt + 1e-9);
      expect(stamp.y + stamp.height).toBeLessThanOrEqual(page.pageHeightPt + 1e-9);
    });
  }

  it('records the move it had to make', () => {
    // A blank that did not land where the document recorded is a discrepancy
    // between the stored geometry and the executed instrument, and the chain
    // is sold as evidence about that instrument.
    const rect = resolveFieldBoxRect(
      { key: 'entity_name', page: 1, x: 590, y: 560, widthPt: 300, heightPt: 16 },
      page,
    );
    expect(rect.relocated).toBe(true);
    expect(rect.requestedX).toBe(590);
    expect(rect.dxPt).toBeCloseTo(312 - 590, 9);
  });

  it('collapses to nothing on a page that is not a page', () => {
    const rect = resolveFieldBoxRect(
      { key: 'entity_name', page: 1, x: 10, y: 10, widthPt: 100, heightPt: 16 },
      { pageWidthPt: 0, pageHeightPt: Number.NaN },
    );
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });
});
