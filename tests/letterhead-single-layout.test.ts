import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One letterhead layout, read by every surface that draws a DESIGNED one.
 *
 * The promise of the designed letterhead is that the answer to "what does our
 * stationery look like" comes from one place. Four surfaces draw it: the PDF
 * renderer, the Word export, the designer preview in settings, and the letter
 * preview in the letters studio. Each arrived separately, and each arrived
 * with its own hand-written block that had to be folded back in afterwards. A
 * fifth will arrive the same way.
 *
 * WHAT THIS DOES NOT COVER, stated because the heading above would otherwise
 * overclaim. app/counsel/templates/template-studio.tsx also paints a header
 * strip on its preview, from the firm's logo and brand name, and knows about
 * neither the uploaded letterhead image nor the design. It is therefore not in
 * the list below. That is a real gap and not a regression: that surface was
 * already showing the wrong thing to any firm that had uploaded a letterhead
 * image, long before a design could exist. Adding it is a separate change.
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
 * Load-bearing, and it took two rounds to get right. Every one of these four
 * surfaces carries a comment SAYING it reads the shared layout, so a guard
 * that greps the raw file is satisfied by the prose and passes a surface that
 * has quietly gone back to writing its own block underneath. This repo has
 * been bitten by comments asserting behaviour that was never wired more times
 * than anyone would like.
 *
 * The first fix stripped whole-line comments only, which left the same hole
 * one keystroke away: a TRAILING comment on a line of real code was not
 * stripped, so gutting a block and parking the call form after a `//` at the
 * end of any line passed. Both forms go now.
 *
 * The `[^:]` guard is so that a `https://` inside a string is not mistaken for
 * the start of a comment. A `//` inside some other string literal would still
 * be cut, which is acceptable: this reads source to reason about it, not to
 * execute it, and cutting too much can only make an assertion stricter.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * `advancesItsOwnCursor` is the difference between a surface that steps down
 * the page itself, and so must read the shared gap, and one that is handed the
 * gap already converted. The Word export is the second kind:
 * letterheadDesignWordLines gives it spacingAfterTwips, so naming the constant
 * there would be decoration.
 *
 * `buildsLineShapedObjects` marks the one surface that legitimately writes
 * `{ text, size, bold }` object literals for a reason that has nothing to do
 * with letterheads: they are the `docx` TextRun options, and
 * lib/docx-export.ts is full of them for the community packet export. The
 * hand-built-line check would fire on every one. Its letterhead block is
 * pinned by the two checks above instead, which is what actually binds it to
 * the shared layout; the line-shape check earns its keep on the three surfaces
 * that have no other reason to build that shape.
 */
const SURFACES: Array<{
  path: string;
  what: string;
  advancesItsOwnCursor: boolean;
  buildsLineShapedObjects?: boolean;
}> = [
  {
    path: 'lib/branded-document-pdf.ts',
    what: 'the PDF renderer',
    advancesItsOwnCursor: true,
  },
  {
    path: 'lib/docx-export.ts',
    what: 'the Word export',
    advancesItsOwnCursor: false,
    buildsLineShapedObjects: true,
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
  {
    // The fifth, which this file predicted would arrive the same way. It draws
    // the band on a true-scale sheet so a firm can see where the letterhead
    // sits once it has moved the margins around it, and it walks down the block
    // line by line, so it reads the shared layout and the shared gap.
    path: 'components/counsel/DocumentLayoutFields.tsx',
    what: 'the document layout preview',
    advancesItsOwnCursor: true,
  },
];

const LAYOUT_CALL = /(letterheadDesignLines|letterheadDesignWordLines)\s*\(/;

/**
 * The call standing alone as a statement, its result going nowhere.
 *
 * Requiring only that the call APPEARS lets a surface satisfy the guard and
 * then ignore what came back, which is the same defect as never calling it.
 * Every real caller binds the result or iterates it, so every real caller has
 * something before the name on that line.
 */
const DISCARDED_CALL =
  /^\s*(letterheadDesignLines|letterheadDesignWordLines)\s*\(/m;

/**
 * A line of the block, built by hand.
 *
 * This is what re-deciding the layout actually looks like: an object literal
 * carrying the shape letterheadDesignLines returns. Deliberately not bound to
 * any variable name, unlike the first version of the gap check below.
 */
const HAND_BUILT_LINE = /\{[^{}]*\btext:[^{}]*\bsize:[^{}]*\}/;

/**
 * The line gap, written out rather than read.
 *
 * The first version of this matched `line.size + N` and `l.size + N`, which
 * bound the check to two variable names and meant renaming the loop variable
 * defeated it. Any identifier now, and either sign.
 */
const HAND_WRITTEN_GAP = /\.size\s*[+-]\s*\d/;

describe('every surface that draws a designed letterhead reads the one layout function', () => {
  for (const surface of SURFACES) {
    it(`${surface.what} asks lib/letterhead-design for the lines`, () => {
      const source = read(surface.path);
      expect(source).toMatch(LAYOUT_CALL);
      expect(source).toMatch(/from '(\.|@\/lib)\/letterhead-design'/);
    });

    it(`${surface.what} uses what the layout function returned`, () => {
      expect(DISCARDED_CALL.test(read(surface.path))).toBe(false);
    });

    it.skipIf(surface.buildsLineShapedObjects)(
      `${surface.what} does not rebuild a line of the block by hand`,
      () => {
        expect(HAND_BUILT_LINE.test(read(surface.path))).toBe(false);
      },
    );

    it(`${surface.what} does not write the line gap out by hand`, () => {
      // The gap under each line was a literal 4 in two places before it was
      // named. A third or fourth copy is how a preview starts disagreeing with
      // the document, which is worse than having no preview at all, because
      // the firm trusts it and finds out at the recipient.
      const source = read(surface.path);
      expect(HAND_WRITTEN_GAP.test(source)).toBe(false);
      if (surface.advancesItsOwnCursor) {
        expect(source).toMatch(/LETTERHEAD_LINE_GAP_PT/);
      }
    });
  }
});

describe('the guard reads code rather than the comments about it', () => {
  // These pin the stripper itself. Every hole found in it so far was a comment
  // form it did not remove, and each one was worth a round of review.
  it('strips a block comment', () => {
    expect(read('tests/fixtures/letterhead-guard-sample.ts')).not.toMatch(
      /a block comment naming letterheadDesignLines\(\)/,
    );
  });

  it('strips a whole-line comment and a TRAILING one', () => {
    const source = read('tests/fixtures/letterhead-guard-sample.ts');
    expect(source).not.toMatch(/whole line/);
    expect(source).not.toMatch(/trailing/);
  });

  it('keeps a URL, which is not a comment however much it looks like one', () => {
    expect(read('tests/fixtures/letterhead-guard-sample.ts')).toMatch(
      /https:\/\/example\.test\/keep-me/,
    );
  });
});
