import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BODY_LEAD_PT,
  locateLine,
  pageGeometry,
  paginate,
  wrapLine,
} from '../lib/document-pagination';

/**
 * The preview shows a document as PAGES.
 *
 * Reported, and then measured live on production against a real firm template:
 * the preview was one `whitespace-pre-wrap` block inside a `max-h-[70vh]
 * overflow-y-auto` pane whose clientHeight was 530px around a scrollHeight of
 * 4168px. So a person about to sign saw about an eighth of the document at a
 * time, through a window that also captured the wheel so the page behind it
 * would not scroll.
 */

describe('how much fits on a page', () => {
  const geom = pageGeometry();

  it('derives a plausible page from the renderer geometry, not a picked number', () => {
    // US Letter is 792pt tall. With the default margins and 16pt leading there
    // is room for tens of lines, not hundreds and not three. The bounds are
    // deliberately loose: the point is that the number comes from the page box,
    // so a layout change moves it, and a nonsense value fails here.
    expect(geom.linesPerPage).toBeGreaterThan(20);
    expect(geom.linesPerPage).toBeLessThan(60);
    expect(geom.charsPerLine).toBeGreaterThan(40);
    expect(geom.widthPt).toBe(612);
    expect(geom.heightPt).toBe(792);
  });

  it('uses the same leading the renderer uses', () => {
    // The mutation this kills: changing BODY_LEAD_PT here without changing LEAD
    // in the renderer. They are two files and there is no import between them,
    // so this reads the renderer's source and compares.
    const src = readFileSync(join(process.cwd(), 'lib/branded-document-pdf.ts'), 'utf8');
    const m = /const LEAD = (\d+)/.exec(src);
    expect(m, 'lib/branded-document-pdf.ts no longer declares LEAD').not.toBeNull();
    expect(Number(m![1])).toBe(BODY_LEAD_PT);
  });
});

describe('wrapping a line', () => {
  it('leaves a short line alone', () => {
    expect(wrapLine('short', 20)).toEqual(['short']);
  });

  it('breaks on whitespace', () => {
    expect(wrapLine('aaa bbb ccc ddd', 7)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('cuts a single token wider than the measure', () => {
    // Without this, one long token (a URL, an account number) sits on a line of
    // its own and the page count is right while the sheet overflows. The
    // pieces must be full-width, so the count stays honest.
    expect(wrapLine('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never returns a piece wider than the measure', () => {
    // The general form of the case above. This is the assertion that kills a
    // "wrap" that only splits on spaces and gives up on long tokens.
    const line = `${'x'.repeat(50)} word ${'y'.repeat(30)}`;
    for (const piece of wrapLine(line, 12)) {
      expect(piece.length).toBeLessThanOrEqual(12);
    }
  });
});

describe('splitting a document into pages', () => {
  it('returns one page for a short document', () => {
    expect(paginate('A short letter.')).toHaveLength(1);
  });

  it('returns a sheet even for nothing at all', () => {
    // An empty preview reads as a failure to load. An empty sheet reads as an
    // empty document, which is the truth.
    expect(paginate('')).toEqual(['']);
  });

  it('splits a long document across several pages', () => {
    const geom = pageGeometry();
    const text = Array.from({ length: geom.linesPerPage * 3 }, (_, i) => `line ${i}`).join('\n');
    expect(paginate(text)).toHaveLength(3);
  });

  it('loses no text across the split', () => {
    // The defect a page-splitter is most likely to ship: an off-by-one that
    // drops a line at every boundary. Rejoining the pages must give back every
    // line, in order.
    const geom = pageGeometry();
    const lines = Array.from({ length: geom.linesPerPage * 2 + 7 }, (_, i) => `line ${i}`);
    const pages = paginate(lines.join('\n'));
    expect(pages.join('\n').split('\n')).toEqual(lines);
  });
});

describe('finding the sheet the signature belongs on', () => {
  const geom = pageGeometry();
  const lines = Array.from({ length: geom.linesPerPage * 2 + 5 }, (_, i) => `line ${i}`);
  const text = lines.join('\n');

  it('puts an early line on the first sheet', () => {
    expect(locateLine(text, 3)).toEqual({ page: 0, lineInPage: 3 });
  });

  it('puts a line past the first sheet on a later one', () => {
    // The mutation this kills: returning `{page: 0}` always, which is what a
    // paginated view does when nobody translated the mark's source line. The
    // signature would then be drawn on page one of a signature block that is on
    // page three, which is the reported "it does not show up on the preview"
    // wearing a different face.
    const at = locateLine(text, geom.linesPerPage + 2);
    expect(at.page).toBe(1);
    expect(at.lineInPage).toBe(2);
  });

  it('resolves a line past the end of the document to the end', () => {
    // Out of range must still draw. Dropping the mark is the defect.
    const at = locateLine(text, 10_000);
    expect(at.page).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(at.page)).toBe(true);
  });

  it('accounts for wrapped lines, not just source lines', () => {
    // A source line that wraps to four rendered lines pushes everything after
    // it down by four, not by one. Counting source lines would put the mark
    // roughly a page too high in any real contract, where paragraphs wrap.
    const wide = 'w'.repeat(geom.charsPerLine * 4);
    const doc = [wide, ...Array.from({ length: 10 }, (_, i) => `line ${i}`)].join('\n');
    const at = locateLine(doc, 1);
    expect(at.lineInPage).toBeGreaterThanOrEqual(4);
  });
});

describe('the preview surfaces do not re-introduce the scroll pane', () => {
  /**
   * The three surfaces that show a document to somebody deciding whether to
   * sign it. A max-height plus overflow on any of them is the exact pane that
   * was measured at 530px around 4168px of content, and it also captures the
   * wheel so the page will not scroll. This is a source-reading guard because
   * vitest here runs in node with no DOM, and the alternative is nothing.
   */
  const SURFACES = [
    'app/portal/forms/[id]/form-fill-client.tsx',
    'app/portal/forms/submissions/[id]/page.tsx',
    'app/counsel/forms/approvals/[id]/page.tsx',
  ];

  for (const f of SURFACES) {
    it(`${f} renders sheets rather than a scrolling column`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(src).toContain('<DocumentSheets');
      // Comments stripped first, because the comment left at the call site
      // explains the pane it replaced and has to be able to name it. A rule
      // that cannot survive its own documentation is a trap for whoever
      // explains the next change, and this repository has set that trap once
      // already.
      expect(
        src,
        `${f} still wraps the document in a max-height scroll pane`,
      ).not.toMatch(/max-h-\[70vh\][^"']*overflow-y-auto/);
    });
  }
});
