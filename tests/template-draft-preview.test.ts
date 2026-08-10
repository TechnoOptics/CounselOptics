import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { NextRequest } from 'next/server';

/**
 * THE PREVIEW IS THE SAME PAGE, proved on the bytes.
 *
 * A preview that renders differently from the thing actually sent is worse
 * than no preview: it manufactures confidence about a document leaving the
 * firm for an outside party. So this file does not check that the preview
 * route "calls the renderer". It runs the route with the REAL
 * buildBrandedDocumentPdf, and separately renders the same document the way
 * lib/submission-document.ts renders a filed submission, and compares what
 * comes out.
 *
 * WHY THE BYTES ARE COMPARABLE AT ALL. buildBrandedDocumentPdf is not
 * deterministic, in two separate ways, and each one has its own answer here.
 *
 *   1. PDFDocument.create() stamps a fresh CreationDate and ModDate into the
 *      Info dictionary on every call. normalizeRenderTimestamps() below
 *      rewrites both to a fixed instant, which is what the name of the first
 *      test has always claimed and what this file did not do until now.
 *
 *      A REGEX OVER THE RAW BYTES CANNOT DO THIS, and the one that used to sit
 *      here never did: pdf-lib writes the Info dictionary into a COMPRESSED
 *      object stream, so `/CreationDate (D:...)` is not plain text in the
 *      output and the replace matched nothing. Inflating the pair of documents
 *      and diffing them shows the two dates as the ONLY differing fields, plus
 *      the cross-reference stream, whose bytes are offsets that shift when the
 *      compressed length of the dates changes. Reloading and re-saving through
 *      pdf-lib restamps the dates and rebuilds those offsets together, so both
 *      go away for the one reason. `updateMetadata: false` is required: the
 *      default rewrites Producer, which carries the firm's name and is a
 *      difference this comparison is supposed to see.
 *
 *   2. formatSignedOn(new Date()) puts today's date into the PAGE, and the
 *      footer draws toLocaleDateString(). No normalization of the container
 *      reaches those, because they are drawn text. The clock is FROZEN for the
 *      whole file instead, so both renders see the same instant.
 *
 * Frozen for the whole file, not for one describe: the unsigned-watermark
 * check at the bottom asserts a DIFFERENCE, and under a live clock a tick
 * between its two renders satisfies that on its own. It passed without reading
 * the watermark at all whenever a second happened to pass, which is the same
 * defect as a green comparison that proves nothing, pointed the other way.
 *
 * Every other difference, a margin, a band, a line of text, a watermark,
 * survives both mechanisms and into the comparison.
 *
 * WHAT IS DELIBERATELY NOT EQUAL is pinned at the bottom of this file rather
 * than smoothed over: a template preview is unsigned, so a firm that stamps
 * its unsigned pages sees that stamp here and not on the copy that goes out.
 * That difference is stated on screen in the editor.
 */

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'author-1', email: 'author@example.test' }),
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async () => 'attorney',
}));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true }),
}));

/** The firm record both renders read their identity and page defaults from. */
let firmRecord: Record<string, unknown> = { name: 'Hartley and Vance LLP' };

vi.mock('../lib/firm-storage', () => ({
  getFirmByIdAdmin: async () => firmRecord,
  getActiveFirmContext: async () => null,
}));

const { POST } = await import('../app/api/counsel/draft-template/pdf/route');
const { buildBrandedDocumentPdf } = await import('../lib/branded-document-pdf');
const { mergeTemplateDocument, formatSignedOn } = await import(
  '../lib/firm-template-placeholders'
);
const { firmLetterheadDesign } = await import('../lib/letterhead-design');
const { firmDocumentLayoutInput, resolveDocumentLayout, sanitizeDocumentLayoutOverride } =
  await import('../lib/document-layout');

const TEMPLATE = {
  name: 'Mutual NDA',
  body:
    'MUTUAL NON-DISCLOSURE AGREEMENT\n\n' +
    'This Agreement is made on {{agreement_date}} between {{firm_name}} and ' +
    '{{recipient_name}}.\n\n' +
    '1. Each party will keep the other party’s confidential information in ' +
    'confidence for three years from the date above.\n\n' +
    '2. Neither party acquires any licence under this Agreement.',
  fields: [
    { key: 'agreement_date', label: 'Agreement date', type: 'date', required: true },
    { key: 'recipient_name', label: 'Recipient name', type: 'text', required: true },
  ],
  deliveryMode: 'share',
  documentLayout: null as unknown,
};

const post = (body: Record<string, unknown>) =>
  POST({ json: async () => body } as unknown as NextRequest);

/** The instant both renders are stamped with. Any fixed one would do. */
const RENDER_EPOCH = new Date('2000-01-01T00:00:00Z');

/**
 * The two fields pdf-lib re-stamps on every render, pinned to one instant, and
 * nothing else touched.
 *
 * Reloaded and re-saved rather than edited in place because both dates live
 * inside a compressed object stream; see the head of this file. Anything the
 * two documents do not agree on, a word, a margin, a colour, the firm name in
 * Producer, survives this and reaches the assertion. Verified by mutation: the
 * first test goes red on a one-word change to the preview's title, and the
 * watermark test at the bottom goes red the moment the watermark is switched
 * off, which it did not do reliably before.
 */
async function normalizeRenderTimestamps(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setCreationDate(RENDER_EPOCH);
  doc.setModificationDate(RENDER_EPOCH);
  return Buffer.from(await doc.save()).toString('latin1');
}

/**
 * The filed instrument, rendered the way lib/submission-document.ts renders
 * one: the stored document_text, the firm's identity, the firm layout with
 * this template's override on top, and the 'signed' state those bytes become.
 */
async function renderAsFiled(documentText: string, override: unknown) {
  const out = await buildBrandedDocumentPdf({
    document: documentText,
    title: TEMPLATE.name,
    brandName: firmRecord.name as string,
    accent: (firmRecord.accentColor as string) ?? undefined,
    letterheadUrl: (firmRecord.letterheadUrl as string) ?? undefined,
    letterheadDesign: firmLetterheadDesign(firmRecord.metadata),
    logoUrl: (firmRecord.logoUrl as string) ?? undefined,
    layout: resolveDocumentLayout(
      firmDocumentLayoutInput(firmRecord.metadata),
      sanitizeDocumentLayoutOverride(override),
    ),
    state: 'signed',
  });
  if (!out) throw new Error('The filed render produced nothing.');
  return out.bytes;
}

/** The words a submission of this template, with nothing filled in, carries. */
function mergedText(deliveryMode = TEMPLATE.deliveryMode) {
  return mergeTemplateDocument({
    body: TEMPLATE.body,
    fields: TEMPLATE.fields as Array<{ key: string; label: string }>,
    deliveryMode,
    values: {},
    firmName: firmRecord.name as string,
    signatureName: '',
    signerEmail: '',
    signedOn: formatSignedOn(new Date()),
  });
}

async function previewBytes(override: unknown = null) {
  const res = await post({
    firmId: 'firm-1',
    draftTemplate: { ...TEMPLATE, documentLayout: override },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('application/pdf');
  return new Uint8Array(await res.arrayBuffer());
}

// Date only, and for the whole file. Timers stay real so the awaits below
// still resolve, and so does pdf-lib's own yield between batches of objects.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-04T10:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('the template preview and the document that gets filed', () => {
  it('are the same PDF, to the byte, once the render timestamps are removed', async () => {
    firmRecord = { name: 'Hartley and Vance LLP', accentColor: '#0f2d24' };
    const preview = await previewBytes();
    const filed = await renderAsFiled(mergedText(), null);
    expect(await normalizeRenderTimestamps(preview)).toBe(
      await normalizeRenderTimestamps(filed),
    );
    // Not vacuously equal: both are real documents with real words in them.
    expect(preview.byteLength).toBeGreaterThan(1000);
  });

  it('stay the same PDF when the template takes over a band of the layout', async () => {
    // The reason the preview exists. An author choosing margins and a footer
    // has no other way to see either, and a preview that ignored the override
    // would show them the firm's page instead of their template's.
    firmRecord = {
      name: 'Hartley and Vance LLP',
      accentColor: '#0f2d24',
      metadata: { document_layout: { margins: { topPt: 96 } } },
    };
    const override = { footer: { show: false }, margins: { leftPt: 108 } };
    const preview = await previewBytes(override);
    const filed = await renderAsFiled(mergedText(), override);
    expect(await normalizeRenderTimestamps(preview)).toBe(
      await normalizeRenderTimestamps(filed),
    );
    // And the override actually moved the page, so the equality above is not
    // two identical default renders agreeing with each other.
    const plain = await renderAsFiled(mergedText(), null);
    expect(await normalizeRenderTimestamps(filed)).not.toBe(
      await normalizeRenderTimestamps(plain),
    );
  });

  it('stay the same PDF for a template that goes out for signature', async () => {
    // The delivery mode decides whether the other side gets a blank at all,
    // so it changes the words on the page.
    firmRecord = { name: 'Hartley and Vance LLP', accentColor: '#0f2d24' };
    const res = await post({
      firmId: 'firm-1',
      draftTemplate: { ...TEMPLATE, deliveryMode: 'signature' },
    });
    expect(res.status).toBe(200);
    const preview = new Uint8Array(await res.arrayBuffer());
    const filed = await renderAsFiled(mergedText('signature'), null);
    expect(await normalizeRenderTimestamps(preview)).toBe(
      await normalizeRenderTimestamps(filed),
    );
  });
});

describe('the one difference the editor states on screen', () => {
  it('carries the firm’s unsigned-page watermark, which the filed copy does not', async () => {
    firmRecord = {
      name: 'Hartley and Vance LLP',
      accentColor: '#0f2d24',
      metadata: {
        document_layout: {
          watermark: { show: true, text: { unsigned: 'DRAFT', signed: '', copy: '' } },
        },
      },
    };
    const preview = await previewBytes();
    const filed = await renderAsFiled(mergedText(), null);
    // Pinned as a DIFFERENCE rather than hidden: a template preview is of
    // something nobody has signed, and the editor says so above the viewer.
    // If this ever becomes equal, either the preview stopped showing the firm
    // its own unsigned mark or the mark started reaching signed instruments,
    // and both need reading before this assertion is changed.
    //
    // Normalized and frozen exactly as the equalities above are, and for a
    // sharper reason: an assertion that two documents DIFFER is satisfied by
    // any difference at all, so a live clock or an unstripped CreationDate
    // answers it without the watermark being read. It only says what it means
    // when the two are identical in every respect but the mark.
    expect(await normalizeRenderTimestamps(preview)).not.toBe(
      await normalizeRenderTimestamps(filed),
    );
  });
});
