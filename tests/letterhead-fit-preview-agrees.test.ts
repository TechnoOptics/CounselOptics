import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  normalizeDocumentLayout,
  resolveLetterheadChrome,
  type DocumentLayout,
} from '../lib/document-layout';

/**
 * THE PREVIEW AND THE DOCUMENT AGREE ABOUT FULL-PAGE STATIONERY.
 *
 * Full-page stationery arrived with `fit: 'page'` on the letterhead, and the PDF
 * renderer learned it: artwork drawn to the sheet, no separator rule, body
 * starting at the top margin. The builder preview did not. It drew the composed
 * band on every letterhead it was ever shown, so a firm that had switched to a
 * full sheet was previewed a top bar and a rule its documents would not carry,
 * and there was no control to switch the fit with in the first place.
 *
 * A preview that disagrees with the document is the exact defect
 * lib/document-layout.ts exists to prevent, so the branch is settled once, here,
 * and both ends read the answer.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    // Comments stripped before anything is matched. Every file in this area
    // carries prose naming the functions it calls, and a guard over the raw
    // text is satisfied by the explanation rather than by the code. This repo
    // has caught that failure twice.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const layoutWith = (patch: Partial<DocumentLayout['letterhead']>): DocumentLayout =>
  normalizeDocumentLayout({
    ...DEFAULT_DOCUMENT_LAYOUT,
    letterhead: { ...DEFAULT_DOCUMENT_LAYOUT.letterhead, ...patch },
  });

describe('resolveLetterheadChrome settles what a page draws', () => {
  it('draws nothing when the letterhead is switched off', () => {
    expect(
      resolveLetterheadChrome({
        layout: layoutWith({ show: false }),
        pageNo: 1,
        hasArtwork: true,
      }),
    ).toBe('none');
  });

  it('draws nothing on a page the letterhead does not appear on', () => {
    expect(
      resolveLetterheadChrome({
        layout: layoutWith({ show: true, pages: 'first' }),
        pageNo: 2,
        hasArtwork: true,
      }),
    ).toBe('none');
  });

  it('is the full sheet when there is artwork and the fit is page', () => {
    expect(
      resolveLetterheadChrome({
        layout: layoutWith({ show: true, fit: 'page' }),
        pageNo: 1,
        hasArtwork: true,
      }),
    ).toBe('artwork-page');
  });

  it('is the artwork band when there is artwork and the fit is band', () => {
    expect(
      resolveLetterheadChrome({
        layout: layoutWith({ show: true, fit: 'band' }),
        pageNo: 1,
        hasArtwork: true,
      }),
    ).toBe('artwork-band');
  });

  /**
   * The fit describes the firm's OWN artwork and nothing else. A design typed
   * into the letterhead settings, or a banner synthesized from the logo, is
   * composed by the renderer out of text it lays out itself; there is no sheet
   * to fill, and honouring 'page' there would mean drawing a full-page
   * letterhead that does not exist.
   */
  it('is the composed band when there is no artwork, whatever the fit says', () => {
    for (const fit of ['band', 'page'] as const) {
      expect(
        resolveLetterheadChrome({
          layout: layoutWith({ show: true, fit }),
          pageNo: 1,
          hasArtwork: false,
        }),
      ).toBe('composed');
    }
  });
});

describe('both ends read the one answer', () => {
  for (const surface of [
    { path: 'lib/branded-document-pdf.ts', what: 'the PDF renderer' },
    { path: 'components/counsel/DocumentLayoutFields.tsx', what: 'the builder preview' },
  ]) {
    it(`${surface.what} asks resolveLetterheadChrome what to draw`, () => {
      expect(read(surface.path)).toMatch(/resolveLetterheadChrome\s*\(/);
    });

    /**
     * The renderer already asked resolveLetterheadArt where the artwork goes.
     * The preview drew a bar at the top of the page instead, which is not where
     * a full sheet is, so it has to ask the same question.
     */
    it(`${surface.what} asks resolveLetterheadArt where the artwork goes`, () => {
      expect(read(surface.path)).toMatch(/resolveLetterheadArt\s*\(/);
    });
  }
});

describe('the builder can reach the fit at all', () => {
  /**
   * Without a control the fit is only settable by writing the firm's jsonb by
   * hand, and an owner who opens the builder cannot see which one is in force.
   */
  it('the builder offers a fit control that writes letterhead.fit', () => {
    const source = read('components/counsel/DocumentLayoutFields.tsx');
    // The ENUMERATION, not the bare token. Matching `LETTERHEAD_FITS` alone was
    // satisfied by the import line while the options were gone, which mutation
    // caught: the guard passed on a panel offering an empty dropdown.
    expect(source).toMatch(/LETTERHEAD_FITS\.map\s*\(/);
    expect(source).toMatch(/set\(\s*'letterhead'\s*,\s*\{\s*fit:/);
  });

  /**
   * Editing any other control must not quietly drop the fit. The panel rebuilds
   * the whole layout on every keystroke, so a spread that forgot this key would
   * reset a firm's stationery to a band the next time somebody nudged a margin.
   */
  it('normalizing a layout keeps a page fit', () => {
    expect(normalizeDocumentLayout(layoutWith({ fit: 'page' })).letterhead.fit).toBe('page');
  });
});
