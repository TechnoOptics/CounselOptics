import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/*
 * The counsel icon system, held to the two rules it states about itself.
 *
 * STROKE WIDTH IS A RENDERED WEIGHT, NOT A NUMBER. What a reader sees is
 * `sw x box / 24`, so the same 1.7 that draws the reference line in the rail's
 * 18px box draws a 19 percent thinner one in a 14px box. Every glyph that
 * fixes its own box in the markup therefore has to solve for that box, and
 * this file does the arithmetic rather than trusting that a number which
 * looked right was right. That is the defect that produced this test: the
 * numbers all looked plausible and three of them rendered light.
 *
 * A STROKE-ONLY SET HAS NO FILLS. Both sets say so in their own docstrings,
 * and until today both had glyphs that disagreed with the sentence above them
 * - a solid play triangle, and a flag drawn twice, once filled at 0.16 and
 * once stroked. Comments are not enforcement, so the code is read instead.
 *
 * EVERY LIST HERE IS DERIVED FROM SOURCE. Nothing below names a glyph. A new
 * glyph added to either file is picked up on the next run without anyone
 * remembering to add it, which is the only version of this guard worth having.
 *
 * AND EVERY READ STRIPS COMMENTS FIRST. The prose above talks about fills,
 * opacity and stroke widths, and so do the files being checked; a search that
 * matched a comment would pass on the strength of a file describing the rule
 * it breaks.
 *
 * WHAT THIS CANNOT TELL YOU: that a glyph is legible, that it is the right
 * picture for its row, or that it is distinguishable from its neighbours.
 * Those were judged by rendering the set at every shipped size and looking.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f: string) => stripComments(readFileSync(join(root, f), 'utf8'));

/** The rail set is the reference. Everything else is measured against it. */
const REFERENCE_PX = 1.275;
const GRID = 24;

/** Rendered stroke, in CSS pixels, of `sw` on a 24 grid drawn in `box` px. */
const rendered = (sw: number, box: number) => (sw * box) / GRID;

describe('the rail set defines the reference weight', () => {
  const src = read('components/counsel/icons.tsx');

  it('renders at 1.275px, derived from the shared SVG constant', () => {
    const box = Number(src.match(/\bwidth:\s*([\d.]+)/)?.[1]);
    const height = Number(src.match(/\bheight:\s*([\d.]+)/)?.[1]);
    const sw = Number(src.match(/strokeWidth:\s*([\d.]+)/)?.[1]);
    expect(Number.isFinite(box) && Number.isFinite(sw)).toBe(true);
    expect(height, 'the rail box is square').toBe(box);
    expect(rendered(sw, box)).toBeCloseTo(REFERENCE_PX, 4);
  });

  it('draws every glyph through the shared wrapper, so none can carry its own weight', () => {
    const glyphs = [...src.matchAll(/export function (\w+)\(\)\s*\{([\s\S]*?)\n\}/g)];
    expect(glyphs.length, 'no glyphs found - the file shape changed').toBeGreaterThan(20);
    for (const [, name, body] of glyphs) {
      expect(body, `${name} must render inside <Icon>`).toMatch(/<Icon>/);
      expect(body, `${name} sets its own stroke width; the set has one`).not.toMatch(
        /strokeWidth|stroke-width/,
      );
      expect(body, `${name} sets its own stroke; the set inherits currentColor`).not.toMatch(
        /\bstroke=/,
      );
    }
  });
});

/*
 * Every OTHER hand-drawn glyph that fixes its own box. Found by source, not
 * listed: an svg with a literal width in px and a strokeWidth somewhere under
 * it is a glyph with a box of its own, and it owes the reference weight.
 */
const FIXED_BOX_FILES = [
  'app/counsel/documents/[id]/status-changer.tsx',
  'components/intake/RecordSection.tsx',
  'components/intake/IntakeConversation.tsx',
];

describe('a glyph that fixes its own box solves for that box', () => {
  for (const file of FIXED_BOX_FILES) {
    it(file, () => {
      const src = read(file);
      const svgs = [...src.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
      const boxed = svgs.filter(
        (s) => /width="\d+"/.test(s) && /strokeWidth="[\d.]+"/.test(s),
      );
      expect(boxed.length, `${file} draws no fixed-box glyph any more`).toBeGreaterThan(0);
      for (const svg of boxed) {
        const box = Number(svg.match(/width="(\d+)"/)![1]);
        // One svg may hold several paths; each is its own line.
        for (const m of svg.matchAll(/strokeWidth="([\d.]+)"/g)) {
          const px = rendered(Number(m[1]), box);
          expect(
            px,
            `${file}: strokeWidth ${m[1]} in a ${box}px box renders at ${px.toFixed(3)}px, ` +
              `not the set's ${REFERENCE_PX}px. Solve sw = ${REFERENCE_PX} * 24 / ${box}.`,
          ).toBeCloseTo(REFERENCE_PX, 2);
        }
      }
    });
  }
});

describe('the content-kind set', () => {
  const src = read('components/counsel/KindIcon.tsx');

  it('carries the rail set 24-grid weight, so both draw one line at one size', () => {
    const railSw = Number(
      read('components/counsel/icons.tsx').match(/strokeWidth:\s*([\d.]+)/)?.[1],
    );
    const sw = Number(src.match(/strokeWidth="([\d.]+)"/)?.[1]);
    expect(Number.isFinite(sw)).toBe(true);
    // This set has no box of its own: the caller sizes it through className,
    // from h-3.5 to h-14. The grid weight is the invariant it can hold.
    expect(sw).toBe(railSw);
  });

  it('is stroke only, in every glyph, derived from source', () => {
    const glyphs = [...src.matchAll(/function (\w+)\(p: Props\)\s*\{([\s\S]*?)\n\}/g)];
    expect(glyphs.length, 'no glyphs found - the file shape changed').toBeGreaterThan(5);
    for (const [, name, body] of glyphs) {
      expect(body, `${name} fills a shape in a stroke-only set`).not.toMatch(/fill=/);
      expect(body, `${name} carries an opacity, which is a second weight`).not.toMatch(
        /opacity=/,
      );
      expect(body, `${name} sets its own stroke width; the set has one`).not.toMatch(
        /strokeWidth|stroke-width/,
      );
    }
  });
});

describe('the counsel rail', () => {
  const src = read('components/counsel/CounselSidebar.tsx');

  it('gives every menu destination a glyph of its own', () => {
    // Both lists derived: the menu is the source of destinations, the rail is
    // the source of glyphs. A route that ships without one falls through to
    // the generic document icon, which is how Reports and My work shipped.
    const menu = read('lib/menu-config.ts');
    const hrefs = [...menu.matchAll(/href:\s*'(\/counsel[^']*)'/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(15);
    const mapped = new Set(
      [...src.matchAll(/'(\/counsel[^']*)':\s*</g)].map((m) => m[1]),
    );
    const missing = hrefs.filter((h) => !mapped.has(h));
    expect(missing, `these rail rows fall back to the generic glyph: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('spells the eyebrow once, and lets the group labels recede', () => {
    // The firm name and the section labels are one typographic object. Two
    // trackings in one rail is the defect this pins.
    const trackings = [...src.matchAll(/tracking-\[([\d.]+em)\]/g)].map((m) => m[1]);
    expect(new Set(trackings).size, `rail eyebrows disagree: ${trackings.join(', ')}`).toBe(1);
    expect(src).toMatch(/const EYEBROW = '[^']*text-\[10px\][^']*'/);
    expect(src, 'the eyebrow is 700, not 600').toMatch(/const EYEBROW = '[^']*font-bold[^']*'/);
    expect(src, 'group labels sit back from the firm name').toMatch(
      /opacity-70 \$\{EYEBROW\}/,
    );
  });

  it('keeps every label starting on the same x', () => {
    // The fixed-width box is what aligns the labels. Losing flex-none lets a
    // wide glyph push its label right and the column stops being a column.
    const boxes = [...src.matchAll(/inline-flex h-\[18px\] w-\[18px\][^"`]*/g)];
    expect(boxes.length).toBeGreaterThan(0);
    for (const [box] of boxes) expect(box).toMatch(/flex-none/);
  });
});
