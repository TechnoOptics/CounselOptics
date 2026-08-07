import { describe, expect, it } from 'vitest';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { mergeTemplateDocument } from '../lib/firm-template-placeholders';
import { counterpartyMarker } from '../lib/template-field-boxes';

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
      values: { company: 'Acme Corporation', entity_name: 'Not Their Name LLC' },
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'entity_name', label: 'Entity name', party: 'counterparty' as const },
      ],
    });
    expect(document).not.toContain('Not Their Name LLC');
    expect(document).toContain(counterpartyMarker('entity_name'));
  });
});
