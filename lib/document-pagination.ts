/**
 * Split a document's text into PAGES, so a preview can show paper.
 *
 * WHY THIS EXISTS. The employee's live preview rendered the whole document as
 * one `whitespace-pre-wrap` block inside a `max-h-[70vh] overflow-y-auto` pane.
 * Measured on production, on a real firm template: the pane was 530px tall and
 * the content was 4168px, so a signer saw about an eighth of what they were
 * signing through a window, and the pane captured the wheel so the page behind
 * it would not move. Reported as "the preview does not show the full document
 * and has white space" and "make the preview show the pages instead of a
 * continuous text".
 *
 * WHAT THIS IS NOT. It is not a reimplementation of the PDF's line breaking.
 * pdf-lib measures each line against embedded Times metrics; a browser wraps
 * with its own font at its own width, and no arithmetic here can make the two
 * agree. So this is deliberately an APPROXIMATION, and the product does not
 * rely on it being exact: the true rendering is one click away in the full
 * preview dialog, which builds the actual PDF. What this buys is that the
 * document reads as a stack of sheets of the right shape and roughly the right
 * length, instead of an endless column of text.
 *
 * The numbers are DERIVED from the renderer's own geometry rather than picked.
 * A second hand-written copy of the page box is the drift this repository has
 * already paid for once, in the signature box that existed in three places and
 * disagreed twice.
 */

import { DEFAULT_DOCUMENT_LAYOUT, resolveContentBox, type DocumentLayout } from './document-layout';
import { RENDERED_PAGE_HEIGHT_PT, RENDERED_PAGE_WIDTH_PT } from './template-field-boxes';

/** The renderer's body leading, in points. Mirrors LEAD in lib/branded-document-pdf.ts. */
export const BODY_LEAD_PT = 16;

/**
 * Average advance width of Times Roman at 11pt, in points.
 *
 * Not measured from the font program, because this module runs in the browser
 * where the font program is not loaded. 5.5pt is half the point size, which is
 * the usual rule of thumb for a serif text face and is close enough for a
 * preview whose only job is to break the text into sheet-sized chunks.
 */
const AVG_CHAR_PT = 5.5;

export type PageGeometry = {
  /** How many rendered lines fit between the top and bottom margins. */
  linesPerPage: number;
  /** How many characters fit across the measure, approximately. */
  charsPerLine: number;
  /** The page box, so a caller can set the sheet's aspect ratio from one source. */
  widthPt: number;
  heightPt: number;
};

/**
 * How much text fits on one page of this layout.
 *
 * The first page carries the letterhead band and so holds fewer lines than the
 * rest. That is not modelled: over-counting the first page by a few lines moves
 * a break, and a moved break in an approximate preview costs nothing, where the
 * extra machinery would have to be kept in step with the renderer forever.
 */
export function pageGeometry(layout: DocumentLayout = DEFAULT_DOCUMENT_LAYOUT): PageGeometry {
  const page = { widthPt: RENDERED_PAGE_WIDTH_PT, heightPt: RENDERED_PAGE_HEIGHT_PT };
  const box = resolveContentBox(layout, page);
  const usable = box.topYPt - box.bottomYPt;
  // Floor, never zero. A degenerate layout must still paginate rather than
  // divide by nothing and hand the caller an infinite loop.
  const linesPerPage = Math.max(1, Math.floor(usable / BODY_LEAD_PT));
  const charsPerLine = Math.max(1, Math.floor(box.widthPt / AVG_CHAR_PT));
  return { linesPerPage, charsPerLine, widthPt: page.widthPt, heightPt: page.heightPt };
}

/**
 * Break one source line into the several rendered lines it will occupy.
 *
 * Wraps on whitespace, and only falls back to a hard cut for a single token
 * longer than the measure, which in a legal document is usually a URL or an
 * account number. Cutting those is what the renderer does too.
 */
export function wrapLine(line: string, charsPerLine: number): string[] {
  if (line.length <= charsPerLine) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= charsPerLine) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
    // A single token wider than the measure. Emit full-width pieces until what
    // is left fits, so one long token cannot consume a whole page on its own.
    while (current.length > charsPerLine) {
      out.push(current.slice(0, charsPerLine));
      current = current.slice(charsPerLine);
    }
  }
  if (current !== '') out.push(current);
  return out;
}

/**
 * Split text into pages.
 *
 * Returns at least one page, even for empty text: a preview showing no sheet at
 * all reads as a failure to load, where an empty sheet reads as an empty
 * document, which is what it is.
 */
export function paginate(
  text: string,
  layout: DocumentLayout = DEFAULT_DOCUMENT_LAYOUT,
): string[] {
  const { linesPerPage, charsPerLine } = pageGeometry(layout);
  const rendered: string[] = [];
  for (const line of text.split('\n')) {
    for (const piece of wrapLine(line, charsPerLine)) rendered.push(piece);
  }
  const pages: string[] = [];
  for (let i = 0; i < rendered.length; i += linesPerPage) {
    pages.push(rendered.slice(i, i + linesPerPage).join('\n'));
  }
  return pages.length > 0 ? pages : [''];
}

/**
 * Which page a given SOURCE line index lands on, and where inside it.
 *
 * The signature mark is positioned by source line, so a paginated view has to
 * translate that into a page and an offset within the page or the mark would be
 * dropped. Dropping it is the defect reported as "when the employee signs using
 * their phone it does not show up on the preview", and it is worth translating
 * carefully rather than rendering the mark at the end and calling it close.
 *
 * A line index past the end of the document resolves to the end of the last
 * page rather than to nothing, so an out-of-range locator still draws.
 */
export function locateLine(
  text: string,
  sourceLine: number,
  layout: DocumentLayout = DEFAULT_DOCUMENT_LAYOUT,
): { page: number; lineInPage: number } {
  const { linesPerPage, charsPerLine } = pageGeometry(layout);
  const source = text.split('\n');
  const target = Math.max(0, Math.min(sourceLine, source.length));
  let rendered = 0;
  for (let i = 0; i < target; i++) {
    rendered += wrapLine(source[i], charsPerLine).length;
  }
  return {
    page: Math.floor(rendered / linesPerPage),
    lineInPage: rendered % linesPerPage,
  };
}
