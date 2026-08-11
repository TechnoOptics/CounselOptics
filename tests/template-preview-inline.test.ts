import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewTab } from '../app/counsel/forms/preview-tab';
import { draftPreviewRequestBody } from '../app/counsel/forms/template-editor-model';

/**
 * The Preview section shows the document, instead of a button that opens it.
 *
 * TWO PROPERTIES ARE LOAD-BEARING AND NEITHER IS COSMETIC.
 *
 * The bytes stay the same bytes. The preview posts to the same route the real
 * export uses, so it cannot become a second renderer that agrees with the
 * first only by inspection. Nothing here forks that path; PdfViewer is handed
 * the blob that route returned.
 *
 * The render is not free. It costs a role read, a firm read, up to two image
 * fetches for the letterhead and logo, and a pdf-lib render. So it happens on
 * the first view and is CACHED, keyed by the exact request that produced it.
 * The key being the request body is the whole of the safety: a cache that
 * could hold a preview of a different draft would show an author a page their
 * template does not produce.
 */

const root = join(__dirname, '..');
const PREVIEW_TAB = 'app/counsel/forms/preview-tab.tsx';
const EDITOR = 'app/counsel/forms/template-editor.tsx';
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const draft = {
  name: 'Mutual NDA',
  body: 'This Agreement is made on {{date}}.',
  fields: [{ key: 'date', label: 'Date', type: 'date' as const, required: true }],
  deliveryMode: 'share' as const,
  documentLayout: null,
};

describe('draftPreviewRequestBody', () => {
  it('is the request, so the cache key cannot describe a different draft', () => {
    const body = draftPreviewRequestBody('firm-1', draft);
    expect(JSON.parse(body)).toEqual({
      firmId: 'firm-1',
      draftTemplate: {
        name: draft.name,
        body: draft.body,
        fields: draft.fields,
        deliveryMode: draft.deliveryMode,
        documentLayout: null,
      },
    });
  });

  it('is unchanged when nothing about the draft changed', () => {
    expect(draftPreviewRequestBody('firm-1', draft)).toBe(
      draftPreviewRequestBody('firm-1', { ...draft }),
    );
  });

  const variants: [string, Parameters<typeof draftPreviewRequestBody>[1]][] = [
    ['the body', { ...draft, body: 'Something else.' }],
    ['the name', { ...draft, name: 'Vendor NDA' }],
    ['the delivery mode', { ...draft, deliveryMode: 'signature' as const }],
    ['a field', { ...draft, fields: [{ ...draft.fields[0], required: false }] }],
    ['the page layout', { ...draft, documentLayout: { margins: { top: 96 } } }],
  ];
  for (const [what, changed] of variants) {
    it(`changes when ${what} changes, so a stale page is never reused`, () => {
      expect(draftPreviewRequestBody('firm-1', changed)).not.toBe(
        draftPreviewRequestBody('firm-1', draft),
      );
    });
  }

  it('changes with the firm, because the letterhead is read off it', () => {
    expect(draftPreviewRequestBody('firm-2', draft)).not.toBe(
      draftPreviewRequestBody('firm-1', draft),
    );
  });
});

describe('the Preview section', () => {
  const render = (props: Partial<Parameters<typeof PreviewTab>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(PreviewTab, {
        busy: false,
        name: 'Mutual NDA',
        body: 'This Agreement is made today.',
        deliveryMode: 'share',
        unmergedCount: 0,
        buildPdf: async () => new Blob(),
        ...props,
      }),
    );

  it('no longer asks anybody to press a button for the document', () => {
    expect(render()).not.toContain('Preview as PDF');
  });

  it('is already fetching the page when it opens', () => {
    // The viewer replaces this once the bytes arrive; the effect that fetches
    // them does not run under renderToStaticMarkup, so this is the honest
    // first frame rather than the finished one.
    expect(render()).toMatch(/Drawing this template|Preparing/i);
  });

  /**
   * The refusal that was already here, kept. A draft with no name or no body
   * is one the Save buttons refuse too, so previewing it would render a page
   * that cannot be saved.
   */
  it('refuses a draft with no name, and says which is missing', () => {
    const html = render({ name: '  ' });
    expect(html).toMatch(/name/i);
    expect(html).not.toMatch(/Drawing this template/i);
  });

  it('refuses a draft with no body', () => {
    const html = render({ body: '' });
    expect(html).toMatch(/body/i);
  });

  /**
   * And refuses it BEFORE asking for a render.
   *
   * The two assertions above only prove the notice is on the page: the amber
   * paragraph is rendered by a separate condition, so deleting the guard
   * inside the effect left them green while an empty draft still posted a
   * render the server would refuse with "There is nothing to preview yet."
   * That mutation is what this assertion exists for.
   *
   * Read as source because the suite has no DOM and an effect cannot be run
   * here. What it establishes is the ORDER: the refusal is reached before
   * buildPdf is.
   */
  it('does not ask for a render of a draft that cannot be saved', () => {
    const effect =
      /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[ready\]\);/.exec(read(PREVIEW_TAB))?.[1] ??
      '';
    expect(effect).toContain('if (!ready) return;');
    expect(effect.indexOf('if (!ready) return;')).toBeLessThan(
      effect.indexOf('buildPdf()'),
    );
  });
});

describe('the preview does not fork the render path', () => {
  it('draws the bytes the export route returned, in the shared viewer', () => {
    const source = read(PREVIEW_TAB);
    expect(source).toContain("from '@/components/PdfViewer'");
    // RENDERED, not merely imported. An earlier version of this asserted only
    // the import, and a mutation that put an <iframe src={blobUrl}> on the
    // page beside it left this green: that iframe is exactly what PdfViewer
    // was written to replace, and it has no page count, no zoom and no error
    // state, so a signed URL that had expired and a document rendering
    // perfectly look identical.
    expect(source).toContain('<PdfViewer');
    expect(source).not.toContain('<iframe');
    // The dialog is what it replaced. Keeping the import would leave two ways
    // to look at the same draft, which is how they start disagreeing.
    expect(source).not.toContain('PdfPreviewDialog');
  });

  it('still posts to the route the real export uses', () => {
    expect(read(EDITOR)).toContain('/api/counsel/draft-template/pdf');
  });

  it('caches by the request it sent, and sends the cached key', () => {
    const source = read(EDITOR);
    expect(source).toContain('draftPreviewRequestBody(');
    // One string, used as the body AND as the key. Two expressions that
    // "obviously agree" is how a cache starts answering for the wrong draft.
    expect(source).toMatch(/body:\s*payload/);
    expect(source).toMatch(/\.payload === payload/);
  });
});
