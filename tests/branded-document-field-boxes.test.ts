import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { mergeTemplateDocument } from '../lib/firm-template-placeholders';
import { counterpartyMarker, FIELD_RULE } from '../lib/template-field-boxes';

/**
 * The renderer records where it drew the counterparty's blanks.
 *
 * This is the load-bearing half of the invariant. tests/template-field-boxes
 * proves that the overlay and the stamp read one recorded geometry; this
 * proves the geometry describes where the ink actually went, which only the
 * renderer can answer. It runs in environment: 'node' because pdf-lib is
 * plain JavaScript and needs no DOM.
 *
 * The layout constants are duplicated here on purpose. A test that imported
 * the renderer's own margin and lead would agree with it by construction and
 * would keep agreeing after somebody changed both, which is the failure a
 * layout test exists to catch.
 */
const MARGIN_PT = 64;
const LEAD_PT = 16;

const FILLER = `${'This agreement is between the parties named below. '.repeat(6)}`;

async function render(document: string) {
  const out = await buildBrandedDocumentPdf({ document, title: 'Mutual Agreement' });
  expect(out).not.toBeNull();
  return out!;
}

/**
 * What the file actually draws, read back out of the saved content streams.
 *
 * The streams are Flate-compressed and pdf-lib writes drawn text as a PDF hex
 * string, so a naive scan of the bytes finds nothing. Both are undone here so
 * the assertions below are about what a reader of the document will see rather
 * than about which functions were called.
 */
async function contentStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let raw: Uint8Array = obj.asUint8Array();
    try {
      raw = zlib.inflateSync(Buffer.from(raw));
    } catch {
      /* not deflated: use it as it stands */
    }
    out += Buffer.from(raw).toString('latin1');
  }
  return out;
}

async function drawnText(bytes: Uint8Array): Promise<string[]> {
  const streams = await contentStreams(bytes);
  return [...streams.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1], 'hex').toString('latin1'),
  );
}

/** Every text run's position, from pdf-lib's `1 0 0 1 X Y Tm`. */
function textPlacements(streams: string): Array<[number, number]> {
  return [...streams.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

/** Every stroked segment, from pdf-lib's `X1 Y1 m ... X2 Y2 l`. */
function strokes(streams: string): Array<[number, number, number, number]> {
  return [...streams.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
  ]);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

describe('buildBrandedDocumentPdf field boxes', () => {
  it('records nothing for a document with no counterparty blanks', async () => {
    // Which is every document this product has produced. An empty array is
    // what makes the migration invisible: lib/submission-document.ts then
    // never names the field_boxes column in a write.
    const out = await render(`${FILLER}\n\nSigned: Jane Doe\nDate: August 6, 2026`);
    expect(out.fieldBoxes).toEqual([]);
  });

  it('records one box per blank, keyed, in draw order', async () => {
    const out = await render(
      [
        FILLER,
        '',
        counterpartyMarker('city'),
        `State: ${counterpartyMarker('state')}`,
        '',
        'Signed: Jane Doe',
      ].join('\n'),
    );
    expect(out.fieldBoxes.map((b) => b.key)).toEqual(['city', 'state']);
    expect(out.fieldBoxes.every((b) => b.page === 1)).toBe(true);
  });

  it('puts consecutive blanks exactly one line apart', async () => {
    // The lead is the only vertical step the body loop takes, so two blanks
    // on consecutive lines are exactly one lead apart or the recorded y is
    // not the y the text was drawn at.
    const out = await render(
      [FILLER, '', counterpartyMarker('city'), counterpartyMarker('state'), '', 'Signed: Jane Doe'].join(
        '\n',
      ),
    );
    const [city, state] = out.fieldBoxes;
    expect(city.y - state.y).toBeCloseTo(LEAD_PT, 6);
    expect(city.heightPt).toBeCloseTo(LEAD_PT, 6);
  });

  it('starts at the margin with nothing before it, and past it with text before it', async () => {
    const out = await render(
      [
        FILLER,
        '',
        counterpartyMarker('city'),
        `Registered address: ${counterpartyMarker('address')}`,
        '',
        'Signed: Jane Doe',
      ].join('\n'),
    );
    const [city, address] = out.fieldBoxes;
    expect(city.x).toBeCloseTo(MARGIN_PT, 6);
    expect(address.x).toBeGreaterThan(MARGIN_PT);
    // And the measured offset is the width of the words in front of it, not
    // a guess: "Registered address: " at 11pt Times is well over 80 points.
    expect(address.x - MARGIN_PT).toBeGreaterThan(80);
  });

  it('gives a blank pushed past the page break the page it landed on', async () => {
    // The page number is read after the body loop has taken its break, so it
    // is the page the text is on rather than the page it was queued from.
    const long = Array.from(
      { length: 60 },
      (_, i) => `Section ${i + 1}. ${'Filler text for this section. '.repeat(4)}`,
    ).join('\n\n');
    const out = await render(
      [long, '', `Entity: ${counterpartyMarker('entity_name')}`, '', 'Signed: Jane Doe'].join('\n'),
    );
    expect(out.fieldBoxes).toHaveLength(1);
    expect(out.fieldBoxes[0].page).toBeGreaterThan(1);
  });

  it('keeps a blank that ends its line wide enough to write in', async () => {
    // The marker itself measures about two inches, which is short for an
    // entity name. A blank at the end of a line takes the rest of the
    // measure so the typed value does not have to be shrunk to fit.
    const out = await render(
      [FILLER, '', `Entity: ${counterpartyMarker('entity_name')}`, '', 'Signed: Jane Doe'].join('\n'),
    );
    const box = out.fieldBoxes[0];
    expect(box.widthPt).toBeGreaterThan(300);
    // And still inside the text measure: 612 - 2 * 64 = 484.
    expect(box.x + box.widthPt).toBeLessThanOrEqual(612 - MARGIN_PT + 1e-6);
  });

  it('keeps a mid-line blank off the words beside it', async () => {
    // The executed copy paints an opaque rectangle over this box before
    // drawing into it, so a box that reached the following words would erase
    // them from the instrument.
    const out = await render(
      [
        FILLER,
        '',
        `Entity ${counterpartyMarker('entity_name')} of the State of Delaware agrees as follows.`,
        '',
        'Signed: Jane Doe',
      ].join('\n'),
    );
    const box = out.fieldBoxes[0];
    // Roughly the marker's own width: no more than a few points of trailing
    // space beyond it, and nowhere near the rest of the measure.
    expect(box.widthPt).toBeLessThan(200);
  });

  it('records a box for every mention of a repeated blank', async () => {
    // "between {{entity_name}} ... signed for {{entity_name}}" is an ordinary
    // instrument, and filling only the first would leave a raw marker on the
    // executed copy.
    const out = await render(
      [
        FILLER,
        '',
        `This agreement is made with ${counterpartyMarker('entity_name')}`,
        `and is executed for ${counterpartyMarker('entity_name')}`,
        '',
        'Signed: Jane Doe',
      ].join('\n'),
    );
    expect(out.fieldBoxes.map((b) => b.key)).toEqual(['entity_name', 'entity_name']);
    expect(out.fieldBoxes[0].y).not.toBe(out.fieldBoxes[1].y);
  });
});

/**
 * A blank is drawn as a blank, not as the sentinel that located it.
 *
 * The marker literal is internal plumbing: it exists so the layout loop can
 * find, measure and record a blank at the one moment it draws (see the header
 * of lib/template-field-boxes.ts). It was also DRAWN, so the recipient of a
 * signature-mode document opened an agreement they were being asked to execute
 * and read `_____<<company_legal_name>>_____` on the face of it, both before
 * they typed and, around a short value, afterwards. Observed on a real render,
 * not deduced.
 *
 * The executed copy already draws the answer: an opaque cover, a rule across
 * the recorded box, and the value sat on the rule (lib/signature-render.ts).
 * The served document now draws the same rule from the same numbers, so what
 * the counterparty is shown and what the executed instrument carries are one
 * blank in two states rather than two drawings.
 */
describe('the blank the renderer draws', () => {
  const LINE = `Entity: ${counterpartyMarker('entity_name')}`;
  const doc = (line = LINE) => [FILLER, '', line, '', 'Signed: Jane Doe'].join('\n');

  it('never draws the marker literal', async () => {
    const out = await render(doc());
    const text = (await drawnText(out.bytes)).join('\n');
    expect(text).not.toContain('<<');
    expect(text).not.toContain('entity_name');
    expect(text).not.toContain('_____');
  });

  it('draws the words around the blank, at the margin', async () => {
    const out = await render(doc());
    const streams = await contentStreams(out.bytes);
    expect(await drawnText(out.bytes)).toContain('Entity: ');
    expect(textPlacements(streams).some(([x]) => near(x, MARGIN_PT))).toBe(true);
  });

  it('rules the blank across the box it recorded', async () => {
    const out = await render(doc());
    const box = out.fieldBoxes[0];
    const found = strokes(await contentStreams(out.bytes)).some(
      ([x1, y1, x2, y2]) =>
        near(x1, box.x) &&
        near(x2, box.x + box.widthPt) &&
        near(y1, box.y + FIELD_RULE.offsetYPt) &&
        near(y2, box.y + FIELD_RULE.offsetYPt),
    );
    expect(found).toBe(true);
  });

  it('leaves the words after a mid-line blank exactly where they were', async () => {
    // The blank is dropped from the drawn run, not closed up. A layout that
    // shifted the following words would move every later blank on the line
    // away from the geometry recorded for it, and the executed copy would
    // paint its opaque cover over the wrong words.
    const line = `Entity ${counterpartyMarker('entity_name')} of Delaware agrees.`;
    const out = await render(doc(line));
    const streams = await contentStreams(out.bytes);
    const box = out.fieldBoxes[0];
    const tail = (await drawnText(out.bytes)).find((t) => t.includes('of Delaware'));
    expect(tail).toBeDefined();
    // Its left edge is where the marker ended, which is the box's own left
    // edge plus the marker's width. The box may be wider than the marker
    // (trailing space), so this is asserted against the text that follows.
    const at = textPlacements(streams).filter(([, y]) => near(y, box.y + 4));
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(at.some(([x]) => x > box.x)).toBe(true);
  });

  it('adds one rule per blank and none to a document without them', async () => {
    // Counted as a difference rather than absolutely, because the page chrome
    // strokes rules of its own and this is an assertion about the blanks.
    // Every document this product has produced so far has none.
    const plain = await render([FILLER, '', 'Signed: Jane Doe'].join('\n'));
    const one = await render(doc());
    const two = await render(
      doc(`Entity: ${counterpartyMarker('entity_name')}\nState: ${counterpartyMarker('state')}`),
    );
    expect(plain.fieldBoxes).toEqual([]);
    const count = async (b: Uint8Array) => strokes(await contentStreams(b)).length;
    const base = await count(plain.bytes);
    expect(await count(one.bytes)).toBe(base + 1);
    expect(await count(two.bytes)).toBe(base + 2);
  });
});

/**
 * The join between the two halves: a template field marked as the
 * counterparty's produces a blank the renderer can find, and an employee
 * field does not.
 */
describe('mergeTemplateDocument to recorded box', () => {
  const base = {
    body: `${FILLER}\n\nCompany: {{company}}\nOther side: {{entity_name}}`,
    values: { company: 'Acme Corporation' },
    firmName: 'Anderson Foundation',
    signatureName: 'Jane Doe',
    signerEmail: 'jane@acme.test',
    signedOn: 'August 6, 2026',
  };

  it('carries a counterparty field through to a recorded box', async () => {
    const document = mergeTemplateDocument({
      ...base,
      counterpartyName: 'Wren Supply Co.',
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
      ],
    });
    // The employee's own value is merged; the other side's is a blank.
    expect(document).toContain('Acme Corporation');
    expect(document).toContain(counterpartyMarker('entity_name'));
    expect(document).not.toContain('[Entity name]');

    const out = await render(document);
    expect(out.fieldBoxes.map((b) => b.key)).toEqual(['entity_name']);
  });

  it('leaves a document with no counterparty field byte-identical', async () => {
    // Every template that exists today declares no party at all, and their
    // output must not move by a character.
    const fields = [
      { key: 'company', label: 'Company' },
      { key: 'entity_name', label: 'Entity name' },
    ];
    const document = mergeTemplateDocument({ ...base, fields });
    expect(document).toContain('[Entity name]');
    expect(document).not.toContain('<<');
    const out = await render(document);
    expect(out.fieldBoxes).toEqual([]);
  });

  it('never merges a value into a counterparty blank, whatever values holds', async () => {
    // The employee does not answer for the other side. A value under a
    // counterparty key is either a stale draft or a caller pushing one in,
    // and either way it is not the counterparty's statement.
    const document = mergeTemplateDocument({
      ...base,
      counterpartyName: 'Wren Supply Co.',
      values: { company: 'Acme Corporation', entity_name: 'Not Their Name LLC' },
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
      ],
    });
    expect(document).not.toContain('Not Their Name LLC');
    expect(document).toContain(counterpartyMarker('entity_name'));
  });

  /**
   * A blank belongs to somebody. On a read-only encrypted share there is no
   * other side: no signer, no ceremony, and nobody who will ever type into it.
   * lib/template-release.ts defended dropping the recorded blanks on that path
   * with the premise that "a template carrying counterparty fields is
   * dispatched for signature instead", and nothing enforced it. The party
   * picker is shown for every template, checkReleasable never looks at the
   * fields, and the share path renders document_text as it stands, so an
   * outside recipient could open the share and read our own field key on the
   * face of the document.
   *
   * The premise is made true here, at the one function both the employee's
   * preview and the stored copy pass through, because the mode is already an
   * argument to it: counterpartyName is null for every mode but 'signature'
   * (counterpartyLabel), so "there is no other side" is a fact this function
   * already holds. A field with nobody to fill it falls back to the unfilled
   * label every other unanswered field renders as, which the employee sees on
   * their preview and the reviewer sees before approving.
   */
  it('renders a counterparty field as an unfilled label when nobody will sign', () => {
    const document = mergeTemplateDocument({
      ...base,
      counterpartyName: null,
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
      ],
    });
    expect(document).not.toContain('<<');
    expect(document).not.toContain(counterpartyMarker('entity_name'));
    expect(document).toContain('[Entity name]');
  });

  it('still refuses the employee an answer for the other side on a share', () => {
    // Falling back to the label must not fall back to merging their value.
    const document = mergeTemplateDocument({
      ...base,
      counterpartyName: null,
      values: { company: 'Acme Corporation', entity_name: 'Not Their Name LLC' },
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
      ],
    });
    expect(document).not.toContain('Not Their Name LLC');
    expect(document).toContain('[Entity name]');
  });

  it('records no blank on a share, so nothing is left waiting to be filled', async () => {
    const out = await render(
      mergeTemplateDocument({
        ...base,
        counterpartyName: null,
        fields: [
          { key: 'company', label: 'Company' },
          { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
        ],
      }),
    );
    expect(out.fieldBoxes).toEqual([]);
  });
});
