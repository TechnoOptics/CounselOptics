import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import { renderFinalSignedPdf } from '../lib/signature-render';
import { counterpartyMarker } from '../lib/template-field-boxes';

/**
 * The executed copy carries what the counterparty typed, in the places the
 * preview showed them.
 *
 * This is the delivered half of the invariant. tests/template-field-boxes
 * proves the overlay and the stamp read one recorded geometry, and
 * tests/branded-document-field-boxes proves the geometry describes where the
 * ink went. This drives the real renderer end to end over a real PDF, with a
 * fake of the database that behaves the way the database will, and reads the
 * drawn text back out of the saved content streams.
 *
 * Reading the text back is possible and worth explaining, because
 * lib/firm-template-placeholders.ts documents at length that a naive scan of
 * a pdf-lib content stream finds nothing: the stream is Flate-compressed and
 * the drawn text is written as a hex string. Both are undone here, on purpose,
 * so the assertion is about what a reader of the document will actually see
 * rather than about which functions were called.
 */

/** The smallest valid PNG: one 8-bit RGBA pixel. */
function samplePng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/** Every content stream in the file, inflated, as one string. */
async function contentStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let raw: Uint8Array = obj.asUint8Array();
    try {
      raw = zlib.inflateSync(Buffer.from(raw));
    } catch {
      /* not deflated, or not a stream we can read: use it as it stands */
    }
    out += Buffer.from(raw).toString('latin1');
  }
  return out;
}

/**
 * Every point the file translates to, from `1 0 0 1 X Y cm` (a rectangle or
 * an image) and `1 0 0 1 X Y Tm` (a run of text).
 *
 * This is how the DELIVERED position is read back. pdf-lib emits a
 * translation rather than absolute coordinates on the drawing operator, so
 * asserting on the operator alone would prove nothing about where anything
 * landed.
 */
function placements(streams: string): Array<[number, number, string]> {
  return [...streams.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) (cm|Tm)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    m[3],
  ]);
}

function placedAt(
  streams: string,
  x: number,
  y: number,
  op: 'cm' | 'Tm',
): boolean {
  return placements(streams).some(
    ([px, py, pop]) => pop === op && Math.abs(px - x) < 0.02 && Math.abs(py - y) < 0.02,
  );
}

/** Every string the file draws, in order. */
async function drawnText(bytes: Uint8Array): Promise<string[]> {
  const streams = await contentStreams(bytes);
  return [...streams.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1], 'hex').toString('latin1'),
  );
}

const FILLER = 'This agreement is between the parties named below. '.repeat(6);

type Fixture = {
  fields: Array<Record<string, unknown>>;
  values: unknown;
  /** Force the read of the typed values to fail, as an unapplied column would. */
  breakValuesRead?: boolean;
  /**
   * A second signature row ahead of the counterparty's in the list PostgREST
   * returns. The employee who counter-signs is a signer on the same request,
   * and this is what they would have written onto their own row.
   */
  employeeValues?: unknown;
  /** The recipient the submission names. Blank models a record with none. */
  recipientEmail?: string;
};

async function buildSource(marker: string) {
  const document = [
    FILLER,
    '',
    `Entity: ${marker}`,
    '',
    'Signed: Jane Doe',
    'Date: August 6, 2026',
    'Email: jane@acme.test',
  ].join('\n');
  const out = await buildBrandedDocumentPdf({ document, title: 'Mutual Agreement' });
  expect(out).not.toBeNull();
  return out!;
}

/**
 * A fake that answers exactly the reads and writes renderFinalSignedPdf and
 * appendSignatureEvent make, and nothing else. Anything unexpected throws, so
 * a change of shape shows up as a failing test rather than as a silent empty
 * result the renderer would read as "no signatures".
 */
function fakeAdmin(input: {
  sourceBytes: Uint8Array;
  fieldBoxes: unknown;
  fixture: Fixture;
  uploaded: { bytes: Uint8Array | null };
  events: Array<Record<string, unknown>>;
}): SupabaseClient {
  const { sourceBytes, fieldBoxes, fixture, uploaded, events } = input;

  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    let selected = '';
    let writing = false;
    const chain = {
      select(cols?: string) {
        selected = cols ?? '';
        return chain;
      },
      insert(row: Record<string, unknown>) {
        if (table !== 'firm_signature_events') throw new Error(`insert on ${table}`);
        events.push(row);
        return chain;
      },
      update() {
        // firm_signing_requests.signed_file_path. Awaited directly, with no
        // maybeSingle after it, so the thenable below has to know it is a
        // write and not a list read.
        writing = true;
        return chain;
      },
      eq(col: string, val: unknown) {
        q[col] = val;
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      async single() {
        return { data: { id: `event-${events.length}` }, error: null };
      },
      async maybeSingle() {
        return { data: rowFor(table, selected), error: errorFor(table, selected) };
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        return Promise.resolve(
          writing
            ? { data: null, error: null }
            : { data: listFor(table, selected), error: errorFor(table, selected) },
        ).then(resolve);
      },
    };
    return chain;
  };

  function errorFor(table: string, cols: string) {
    if (
      fixture.breakValuesRead &&
      table === 'firm_signatures' &&
      cols.includes('counterparty_values')
    ) {
      return {
        code: '42703',
        message: 'column firm_signatures.counterparty_values does not exist',
      };
    }
    return null;
  }

  function rowFor(table: string, cols: string): unknown {
    if (table === 'firm_signing_requests') {
      return {
        id: 'req-1',
        firm_id: 'firm-1',
        document_id: 'doc-1',
        status: 'completed',
        document_sha256: 'a'.repeat(64),
      };
    }
    if (table === 'firm_documents') {
      return { file_path: 'firm-1/doc-1/agreement.pdf', signable_file_path: null };
    }
    if (table === 'firm_template_submissions') {
      return {
        id: 'sub-1',
        firm_id: 'firm-1',
        template_id: 'tpl-1',
        field_boxes: fieldBoxes,
        // The submission names its recipient, and that person is the
        // counterparty. Nothing else on the request distinguishes them from
        // the employee who counter-signs.
        recipient_email: fixture.recipientEmail ?? 'buyer@wren.test',
      };
    }
    if (table === 'firm_templates') return { fields: fixture.fields };
    throw new Error(`unexpected maybeSingle on ${table} (${cols})`);
  }

  function listFor(table: string, cols: string): unknown {
    if (table === 'firm_signature_events') return [];
    if (table === 'firm_signatures') {
      if (errorFor(table, cols)) return null;
      const rows: Array<Record<string, unknown>> = [];
      if (fixture.employeeValues !== undefined) {
        // FIRST in the list, on purpose. The select carries no .order(), so
        // PostgREST row order is unspecified, and stamping signed_at is a
        // non-HOT update that relocates a tuple in the heap. A merge that
        // takes the first row carrying a key would take this one.
        rows.push({
          id: 'sig-2',
          signer_email: 'priya@firm.test',
          signer_name: 'Priya Raman',
          position_page: 1,
          position_x: 0.5,
          position_y: 0.5,
          signature_image_path: null,
          signed_at: null,
          counterparty_values: fixture.employeeValues,
        });
      }
      rows.push(
        {
          id: 'sig-1',
          signer_email: 'buyer@wren.test',
          signer_name: 'Wren Supply Co.',
          position_page: 1,
          position_x: 0.1,
          position_y: 0.1,
          signature_image_path: 'firm-1/sig-1.png',
          signed_at: '2026-08-06T12:00:00.000Z',
          counterparty_values: fixture.values,
        },
      );
      return rows;
    }
    throw new Error(`unexpected list read on ${table} (${cols})`);
  }

  const storage = {
    from(bucket: string) {
      return {
        async download(path: string) {
          if (bucket === 'firm-documents') {
            return {
              data: { arrayBuffer: async () => Buffer.from(sourceBytes) },
              error: null,
            };
          }
          if (bucket === 'firm-signatures') {
            return {
              data: { arrayBuffer: async () => Buffer.from(samplePng()) },
              error: null,
            };
          }
          throw new Error(`unexpected download from ${bucket}/${path}`);
        },
        async upload(_path: string, bytes: Uint8Array) {
          uploaded.bytes = bytes;
          return { error: null };
        },
      };
    },
  };

  return { from, storage } as unknown as SupabaseClient;
}

async function run(fixture: Fixture) {
  const source = await buildSource(counterpartyMarker('entity_name'));
  expect(source.fieldBoxes).toHaveLength(1);
  const uploaded: { bytes: Uint8Array | null } = { bytes: null };
  const events: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({
    sourceBytes: source.bytes,
    fieldBoxes: source.fieldBoxes,
    fixture,
    uploaded,
    events,
  });
  const result = await renderFinalSignedPdf(admin, 'req-1');
  return { result, uploaded, events, box: source.fieldBoxes[0] };
}

const TEXT_FIELD = [
  {
    key: 'entity_name',
    label: 'Your registered entity name',
    type: 'text',
    required: true,
    party: 'counterparty',
  },
];

describe('renderFinalSignedPdf with counterparty fields', () => {
  it('draws the typed value onto the executed copy', async () => {
    const { result, uploaded, events, box } = await run({
      fields: TEXT_FIELD,
      values: { entity_name: 'Wren Supply Co.' },
    });
    expect(result.ok).toBe(true);
    expect(uploaded.bytes).not.toBeNull();

    const text = await drawnText(uploaded.bytes as Uint8Array);
    expect(text).toContain('Wren Supply Co.');

    // AT THE RECORDED BOX. This is the delivered end of the invariant: the
    // value is drawn at the geometry buildBrandedDocumentPdf recorded when it
    // drew the blank, which is the same geometry the live overlay positioned
    // it at. A stamp that read box coordinates differently from the overlay
    // would land somewhere else and fail here.
    const streams = await contentStreams(uploaded.bytes as Uint8Array);
    expect(placedAt(streams, box.x + 2, box.y + 4, 'Tm')).toBe(true);

    // And drawn over an opaque rectangle at the box, because the marker is
    // still in the stored bytes underneath it. Without the cover the executed
    // instrument would show the value printed on top of
    // `_____<<entity_name>>_____`.
    expect(streams).toContain('1 1 1 rg');
    expect(placedAt(streams, box.x, box.y, 'cm')).toBe(true);

    const rendered = events.find((e) => e.event_type === 'final_pdf_rendered');
    expect(rendered).toBeDefined();
    expect((rendered?.metadata as Record<string, unknown>).fields_intended).toBe(1);
    expect((rendered?.metadata as Record<string, unknown>).fields_drawn).toBe(1);
  });

  it('prints a date the way the document prints every other date', async () => {
    // The overlay called formatCounterpartyValue and so does the stamp, so
    // the signer cannot confirm one date and receive another.
    const { result, uploaded } = await run({
      fields: [{ ...TEXT_FIELD[0], type: 'date' }],
      values: { entity_name: '2026-08-06' },
    });
    expect(result.ok).toBe(true);
    const text = await drawnText(uploaded.bytes as Uint8Array);
    expect(text).toContain('August 6, 2026');
    expect(text).not.toContain('2026-08-06');
  });

  it('covers a blank the signer left empty rather than leaving the marker showing', async () => {
    // An optional blank nobody filled in comes out as a ruled line, which is
    // what a blank on a signed paper document looks like. Leaving it as it
    // was would print a piece of our own plumbing on the face of an executed
    // instrument.
    const { result, uploaded, events, box } = await run({
      fields: [{ ...TEXT_FIELD[0], required: false }],
      values: {},
    });
    expect(result.ok).toBe(true);
    const streams = await contentStreams(uploaded.bytes as Uint8Array);
    expect(streams).toContain('1 1 1 rg');
    expect(placedAt(streams, box.x, box.y, 'cm')).toBe(true);
    const rendered = events.find((e) => e.event_type === 'final_pdf_rendered');
    expect((rendered?.metadata as Record<string, unknown>).fields_intended).toBe(1);
    expect((rendered?.metadata as Record<string, unknown>).fields_drawn).toBe(1);
  });

  /**
   * THE GUARD. An executed copy that is missing a value the signer typed is
   * worse than no executed copy: it goes to counsel labelled as the executed
   * instrument while showing a blank, or our marker, where the other side's
   * entity name belongs.
   */
  it('refuses to file a copy when a value it cannot draw was typed', async () => {
    // A stored value pdf-lib's WinAnsi font cannot encode. The signing page
    // refuses these (isWinAnsiEncodable), so reaching this state means a
    // hand-edited row or an older writer, and the answer is still to refuse.
    const { result, uploaded, events } = await run({
      fields: TEXT_FIELD,
      values: { entity_name: '株式会社' },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.logged).toBe(true);
    expect(result.ok === false && result.error).toContain('could not be placed');
    // Nothing was filed. That is the point.
    expect(uploaded.bytes).toBeNull();
    const failed = events.find((e) => e.event_type === 'final_pdf_render_failed');
    expect(failed).toBeDefined();
    const meta = failed?.metadata as Record<string, unknown>;
    expect(meta.fields_intended).toBe(1);
    expect(meta.fields_drawn).toBe(0);
    expect(String((meta.field_failures as string[])[0])).toContain('entity_name');
  });

  /**
   * The words on the executed copy are the COUNTERPARTY'S.
   *
   * Two signers sit on one request: the counterparty at order 1 and the
   * employee who counter-signs at order 2. Both hold a valid token, and until
   * this was scoped both were shown the same form. The merge then took "the
   * first row carrying a key", over a select with no `.order()` on it, so
   * which side's answer reached the instrument was decided by whatever order
   * PostgREST happened to return two rows in. The employee's row is returned
   * first here for exactly that reason.
   *
   * An executed NDA carrying the employee's guess at the other side's entity
   * name is not a clerical error. It is the wrong party named on the
   * instrument.
   */
  it("stamps the counterparty's answer, not a later signer's", async () => {
    const { result, uploaded } = await run({
      fields: TEXT_FIELD,
      values: { entity_name: 'Wren Supply Co.' },
      employeeValues: { entity_name: 'Whatever The Employee Guessed' },
    });
    expect(result.ok).toBe(true);
    const text = await drawnText(uploaded.bytes as Uint8Array);
    expect(text).toContain('Wren Supply Co.');
    expect(text).not.toContain('Whatever The Employee Guessed');
  });

  /**
   * A value that was written and then dropped stops the render.
   *
   * The employee's answer is not the counterparty's statement and must never
   * reach the instrument. But filing a clean ruled blank over it would be a
   * silent loss on an executed document: drawn would equal intended, nothing
   * would be recorded as dropped, and the audit chain would say a value that
   * existed in the database was never there. Unreachable in normal operation,
   * because submitCounterpartyFieldsAction refuses a non-counterparty caller,
   * so reaching it means a hand-edited row or a writer older than that gate,
   * and the answer to both is to refuse rather than to file quietly.
   */
  it('refuses to file when a stored value was filtered out', async () => {
    const { result, uploaded, events } = await run({
      fields: [{ ...TEXT_FIELD[0], required: false }],
      values: {},
      employeeValues: { entity_name: 'Whatever The Employee Guessed' },
    });
    expect(result.ok).toBe(false);
    expect(uploaded.bytes).toBeNull();
    const failed = events.find((e) => e.event_type === 'final_pdf_render_failed');
    const meta = failed?.metadata as Record<string, unknown>;
    expect(String((meta.field_failures as string[])[0])).toContain('entity_name');
    // And it never drew the value it refused over.
    expect(JSON.stringify(events)).not.toContain('Whatever The Employee Guessed');
  });

  it('still files a blank nobody ever answered', async () => {
    // The distinction that matters: an optional blank with no stored value
    // anywhere is a blank, and a blank is a legitimate thing for a signed
    // document to carry.
    const { result, uploaded } = await run({
      fields: [{ ...TEXT_FIELD[0], required: false }],
      values: {},
    });
    expect(result.ok).toBe(true);
    expect(uploaded.bytes).not.toBeNull();
  });

  it('refuses to file when the record names no counterparty at all', async () => {
    // recipient_email is NOT NULL and validated, so this should be
    // unreachable. If it is ever reached, every row is filtered out and every
    // blank comes out empty, and filing that silently is the failure worth
    // guarding: the instrument would go out with holes and the chain would
    // say nothing was dropped.
    const { result, uploaded } = await run({
      fields: TEXT_FIELD,
      values: { entity_name: 'Wren Supply Co.' },
      recipientEmail: '',
    });
    expect(result.ok).toBe(false);
    expect(uploaded.bytes).toBeNull();
  });

  it('refuses when the typed values cannot be read at all', async () => {
    // The blanks are on the document and this render does not know what goes
    // in them. Filing anyway would print the markers onto the instrument.
    const { result, uploaded } = await run({
      fields: TEXT_FIELD,
      values: { entity_name: 'Wren Supply Co.' },
      breakValuesRead: true,
    });
    expect(result.ok).toBe(false);
    expect(uploaded.bytes).toBeNull();
  });

  it('files the copy as it does today when the document has no blanks', async () => {
    // Every document this product has produced so far, and every firm that
    // has not applied 20260807_flow_join.sql.
    const source = await buildSource('nothing to fill in here');
    expect(source.fieldBoxes).toEqual([]);
    const uploaded: { bytes: Uint8Array | null } = { bytes: null };
    const events: Array<Record<string, unknown>> = [];
    const admin = fakeAdmin({
      sourceBytes: source.bytes,
      fieldBoxes: null,
      fixture: { fields: TEXT_FIELD, values: null },
      uploaded,
      events,
    });
    const result = await renderFinalSignedPdf(admin, 'req-1');
    expect(result.ok).toBe(true);
    const rendered = events.find((e) => e.event_type === 'final_pdf_rendered');
    expect((rendered?.metadata as Record<string, unknown>).fields_intended).toBe(0);
  });
});
