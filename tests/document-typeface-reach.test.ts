import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE TYPEFACE HAS TO REACH EVERY SURFACE THAT RENDERS A FIRM DOCUMENT.
 *
 * buildBrandedDocumentPdf does not fetch a firm. Every caller assembles its own
 * input, which is why the letterhead reaches the draft preview, the release, the
 * stored submission and the letter studio through five separate hand-written
 * object literals. A sixth surface added later, or one of these five edited
 * without the others, is how a firm ends up with its own face on the document it
 * previews and Times on the one the counterparty receives.
 *
 * So the rule is mechanical: any surface that tells the renderer which
 * LETTERHEAD to use must also tell it which TYPEFACE to use. Those are the two
 * halves of the same question, and a surface that answers one and not the other
 * is the defect this guard exists to catch.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING. A guard that greps raw source is
 * satisfied by the comment explaining the guard, which has happened twice in
 * this codebase in a single day. The mutation check for this file is to delete a
 * `typeface:` line from any listed surface and confirm it goes red.
 */

/** Source with comments removed, so a mention in prose cannot satisfy a check. */
function code(relativePath: string): string {
  const raw = readFileSync(join(process.cwd(), relativePath), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments, including JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // line comments, sparing "https://"
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Every surface that hands buildBrandedDocumentPdf a letterhead.
 *
 * THE TWO WORD SURFACES ARE DELIBERATELY ABSENT, and finding out why cost a
 * wrong edit: lib/letters-actions.ts also reads firmLetterheadDesign, so a
 * mechanical sweep added a typeface to it too, and it does not render a PDF at
 * all. It calls generateLetterDocx. A typeface in a .docx is a font NAME the
 * reader's own machine has to resolve, not an embedded program, so it is a
 * different feature. Listing either here would demand a fix that does not
 * exist; they are held to the opposite assertion below instead.
 */
const PDF_SURFACES = [
  'app/api/counsel/draft-template/pdf/route.ts',
  'lib/template-release.ts',
  'lib/submission-document.ts',
  'lib/submission-preview.ts',
];

/** The Word surfaces, which must NOT claim to embed anything. */
const WORD_SURFACES = [
  'app/api/counsel/letters/docx/route.ts',
  'lib/letters-actions.ts',
];

describe('every surface that renders a firm document passes the firm typeface', () => {
  for (const path of PDF_SURFACES) {
    it(`${path} answers the typeface question wherever it answers the letterhead one`, () => {
      const source = code(path);
      const letterheads = count(source, 'letterheadDesign:');
      const typefaces = count(source, 'typeface:');
      // Guard the guard: if this file stopped mentioning letterheads at all the
      // comparison below would pass trivially and prove nothing.
      expect(letterheads).toBeGreaterThan(0);
      expect(typefaces).toBe(letterheads);
    });
  }

  it('reads the typeface from the firm metadata rather than inventing one', () => {
    for (const path of PDF_SURFACES) {
      expect(code(path)).toMatch(/firmDocumentTypeface|args\.typeface|input\.typeface/);
    }
  });
});

describe('the Word exports are honestly out of scope', () => {
  for (const path of WORD_SURFACES) {
    it(`${path} does not pretend to carry an embedded typeface`, () => {
      const source = code(path);
      expect(count(source, 'letterheadDesign:')).toBeGreaterThan(0);
      expect(count(source, 'typeface:')).toBe(0);
    });
  }
});
