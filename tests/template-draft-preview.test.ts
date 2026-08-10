import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
 * deterministic: PDFDocument.create() stamps a fresh CreationDate and ModDate
 * on every call, and formatSignedOn(new Date()) puts today's date into the
 * page. The clock is FROZEN across the comparisons instead, so both renders
 * see the same instant. Every other difference, a margin, a band, a line of
 * text, a watermark, survives into the comparison.
 *
 * The regex strip below is kept, but it is not what makes this work and it
 * never was: pdf-lib writes the Info dictionary into a COMPRESSED object
 * stream, so `/CreationDate (D:...)` does not appear as plain text in the
 * output and the replace matched nothing. That is why this comparison went
 * red at random, roughly whenever a second ticked between the two renders. It
 * was reproduced deliberately by putting a 1.1 second wait between them.
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

/** The two fields pdf-lib re-stamps on every render, and nothing else. */
const stripRenderTimestamps = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString('latin1')
    .replace(/\/CreationDate \(D:[^)]*\)/g, '/CreationDate ()')
    .replace(/\/ModDate \(D:[^)]*\)/g, '/ModDate ()');

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

describe('the template preview and the document that gets filed', () => {
  // Date only. Timers stay real so the awaits below still resolve.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-04T10:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('are the same PDF, to the byte, once the render timestamps are removed', async () => {
    firmRecord = { name: 'Hartley and Vance LLP', accentColor: '#0f2d24' };
    const preview = await previewBytes();
    const filed = await renderAsFiled(mergedText(), null);
    expect(stripRenderTimestamps(preview)).toBe(stripRenderTimestamps(filed));
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
    expect(stripRenderTimestamps(preview)).toBe(stripRenderTimestamps(filed));
    // And the override actually moved the page, so the equality above is not
    // two identical default renders agreeing with each other.
    const plain = await renderAsFiled(mergedText(), null);
    expect(stripRenderTimestamps(filed)).not.toBe(stripRenderTimestamps(plain));
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
    expect(stripRenderTimestamps(preview)).toBe(stripRenderTimestamps(filed));
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
    expect(stripRenderTimestamps(preview)).not.toBe(stripRenderTimestamps(filed));
  });
});
