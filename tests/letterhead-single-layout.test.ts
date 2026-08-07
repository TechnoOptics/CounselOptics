import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One letterhead layout, read by every surface that draws one.
 *
 * The whole promise of the designed letterhead is that the answer to "what
 * does our stationery look like" comes from one place. Four surfaces draw it
 * now: the PDF renderer, the Word export, the designer preview in settings,
 * and the letter preview in the letters studio. Each one of those arrived
 * separately, and each arrived with its own hand-written block that had to be
 * folded back in afterwards. A fifth will arrive the same way.
 *
 * So this is a source-level guard rather than a behavioural one, in the same
 * spirit as the route-source assertions in tests/template-render-gate.test.ts.
 * A behavioural test cannot see the difference between a surface that reads
 * the shared layout and one that reproduces it correctly today, and correct
 * today is exactly what a second copy always is.
 */

/**
 * The source with its comments removed.
 *
 * Load-bearing. Every one of these four surfaces carries a comment SAYING it
 * reads the shared layout, so a guard that greps the raw file is satisfied by
 * the prose and would pass a surface that had quietly gone back to writing its
 * own block underneath. This repo has been bitten by comments asserting
 * behaviour that was never wired more than once. Strip them, and require the
 * CALL rather than the name.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * `advancesItsOwnCursor` is the difference between a surface that steps down
 * the page itself, and so must read the shared gap, and one that is handed the
 * gap already converted. The Word export is the second kind:
 * letterheadDesignWordLines gives it spacingAfterTwips, so naming the constant
 * there would be decoration.
 */
const SURFACES: Array<{ path: string; what: string; advancesItsOwnCursor: boolean }> = [
  {
    path: 'lib/branded-document-pdf.ts',
    what: 'the PDF renderer',
    advancesItsOwnCursor: true,
  },
  {
    path: 'lib/docx-export.ts',
    what: 'the Word export',
    advancesItsOwnCursor: false,
  },
  {
    path: 'app/counsel/settings/letterhead-designer.tsx',
    what: 'the settings preview',
    advancesItsOwnCursor: true,
  },
  {
    path: 'app/counsel/letters/letters-studio.tsx',
    what: 'the letters studio preview',
    advancesItsOwnCursor: true,
  },
];

describe('every surface that draws a letterhead reads the one layout function', () => {
  for (const surface of SURFACES) {
    it(`${surface.what} asks lib/letterhead-design for the lines`, () => {
      const source = read(surface.path);
      expect(source).toMatch(
        /(letterheadDesignLines|letterheadDesignWordLines)\s*\(/,
      );
      expect(source).toMatch(/from '(\.|@\/lib)\/letterhead-design'/);
    });

    it(`${surface.what} does not write the line gap out by hand`, () => {
      // The gap under each line was a literal 4 in two places before it was
      // named. A third or fourth copy is how a preview starts disagreeing with
      // the document, which is worse than having no preview at all, because
      // the firm trusts it and finds out at the recipient.
      const source = read(surface.path);
      expect(/(?:line|l)\.size\s*\+\s*\d/.test(source)).toBe(false);
      if (surface.advancesItsOwnCursor) {
        expect(source).toMatch(/LETTERHEAD_LINE_GAP_PT/);
      }
    });
  }
});
