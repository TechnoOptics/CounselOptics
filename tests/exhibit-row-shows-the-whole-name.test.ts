import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * THE DEFECT, live on advottic.com from the marketing redesign of
 * 2026-09-22 until this guard was written the same day.
 *
 * SheetRow's middle column carried `truncate`, and the cover it sits on was
 * laid out on `lg:grid-cols-12 lg:gap-14`. A twelve track grid applies its
 * gutter eleven times, so 693px of the cover's 865px row went to gaps and
 * the sheet rendered 324px; at 1024, the first pixel of the `lg` breakpoint,
 * the gutters exceeded the row, every track resolved to 0 and the sheet came
 * out 252px. Measured against the running site, the four exhibit names on
 * the home cover were shown 24 to 32px of the 210 to 235px they need: about
 * three characters, "Signed leas...", "Move-out p...". Eight more rows on
 * /enterprise were cut the same way at every width.
 *
 * WHY A GUARD AT ALL. tsc, vitest, next build and the audit-guard suite were
 * all green while that shipped, because none of them measures a rendered
 * width. This is a source-reading guard and it is therefore a weak
 * instrument; it holds the two decisions that the rendering depended on, and
 * the widths themselves were verified in a real browser at 390, 768, 1024,
 * 1280 and 1440 in both themes.
 *
 * COMMENTS ARE STRIPPED before every match. The comments on both files
 * discuss `truncate` and `grid-cols-12` at length, so a guard reading raw
 * source would be satisfied by the prose explaining the fix rather than by
 * the fix. That has happened twice in this repo.
 */

const ROOT = join(__dirname, '..');
const SHEET = stripComments(readFileSync(join(ROOT, 'components/marketing/file/Sheet.tsx'), 'utf8'));

/**
 * The two covers that lay copy beside a Sheet, and the breakpoint each one
 * splits at. They are held by one parameterised block rather than two
 * copies: the enterprise cover carried this exact defect and was left out of
 * the first fix because it was latent there, and a second hand-written copy
 * of these assertions is how the two would drift.
 *
 * The breakpoints differ on purpose and the difference is the point of the
 * last assertion. The home cover is inside a Section, which opens a 200px
 * binder tab at `lg` and leaves 689px for the whole cover at 1024; the
 * enterprise cover is inside a Band, which is full bleed with FilePage's own
 * column and has 934px there, so it can split a breakpoint earlier.
 */
const COVERS = [
  {
    page: 'home',
    file: 'app/page.tsx',
    marker: 'Left: editorial copy block',
    split: 'xl',
    tooEarly: 'lg',
  },
  {
    page: 'enterprise',
    file: 'app/enterprise/page.tsx',
    marker: 'Advottic for firms. In-house. Counsel.',
    split: 'lg',
    tooEarly: 'md',
  },
] as const;

/** SheetRow's body, so a class on Sheet or Stamp cannot answer for a row. */
function sheetRowBody(): string {
  const at = SHEET.indexOf('export function SheetRow');
  expect(at, 'SheetRow is gone from Sheet.tsx').toBeGreaterThan(-1);
  const rest = SHEET.slice(at);
  const end = rest.indexOf('\nexport function ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The classes on the nth `<span>` of SheetRow, in source order. */
function rowSpanClasses(): string[] {
  return [...sheetRowBody().matchAll(/<span className="([^"]*)"/g)].map((m) => m[1]);
}

describe('a SheetRow shows the whole exhibit name', () => {
  it('does not truncate the name column', () => {
    const [name] = rowSpanClasses();
    expect(name, 'SheetRow has no name column').toBeTruthy();
    // `truncate` is the shorthand; the three longhands are the same defect
    // spelled out, and one of them on its own would still clip.
    expect(name.split(/\s+/)).not.toContain('truncate');
    expect(name).not.toMatch(/text-ellipsis|whitespace-nowrap|overflow-hidden/);
  });

  it('keeps the name column from widening the sheet, which is why it truncated', () => {
    // The recorded intent (scripts/design/render-marketing.cjs) is that a long
    // filename must never set the sheet's width. Wrapping holds that only if
    // the track's min-content contribution is floored at zero, which takes
    // both of these: `min-w-0` on the item and a break opportunity inside an
    // unbroken run of characters.
    const [name] = rowSpanClasses();
    expect(name.split(/\s+/)).toContain('min-w-0');
    expect(name).toMatch(/\[overflow-wrap:anywhere\]|break-all|break-words/);
  });

  it('keeps the right column on one line and tabular', () => {
    // A date is short and fixed and it is the row's label, not its content,
    // so it keeps the max-content track. "Mar 30, 2025" breaking after the
    // comma would read as two values.
    const right = rowSpanClasses()[1];
    expect(right, 'SheetRow has no right column').toBeTruthy();
    expect(right.split(/\s+/)).toContain('whitespace-nowrap');
    expect(right.split(/\s+/)).toContain('tabular-nums');
  });

  it('keeps the row on one grid with the name in the flexible track', () => {
    // The mark is fixed, the name flexes, the date takes its own width. If
    // the name ever stopped being the `1fr`, it would lose to the date again.
    expect(sheetRowBody()).toContain('grid-cols-[34px_1fr_auto]');
  });
});

describe.each(COVERS)('the $page cover gives the sheet a real column', (cover) => {
  const src = stripComments(readFileSync(join(ROOT, cover.file), 'utf8'));

  /**
   * The classes on the innermost grid that opens above the copy column: the
   * LAST match before the marker, not the first. app/enterprise/page.tsx has
   * an `Entry`-shaped `grid gap-8 lg:grid-cols-2` further up the file, and a
   * first-match read picks that one up, where it would satisfy the
   * breakpoint assertion and fail the tracks one for the wrong reason.
   */
  function coverGrid(): string {
    const at = src.indexOf(cover.marker);
    expect(at, `the cover copy column is gone from ${cover.file}`).toBeGreaterThan(-1);
    const all = [...src.slice(0, at).matchAll(/<div className="(grid [^"]*)">\s*$/gm)];
    const grid = all.length ? all[all.length - 1][1] : '';
    expect(grid, 'the cover is no longer a grid').toBeTruthy();
    return grid;
  }

  it('does not lay the cover on a twelve track grid', () => {
    // Eleven gutters at `gap-14` are 693px. No twelve track grid on this page
    // survives that, whatever the spans on its children say.
    expect(src).not.toMatch(/grid-cols-12/);
    expect(src).not.toMatch(/col-span-\d/);
  });

  it('splits the cover into two tracks with one gutter', () => {
    expect(coverGrid()).toMatch(/grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  });

  it(`splits at ${cover.split}, and no earlier`, () => {
    // Home: Section turns on its 200px tab column at lg, which leaves 689px
    // for the whole cover at 1024. Split there, the sheet cannot be wider
    // than about 260px and the 61px display headline cannot be narrower than
    // its own longest word. Enterprise: Band has no tab, so 1024 leaves
    // 934px and an even split is 435.5px a column, which the rendered page
    // carries. Below its own breakpoint each cover stacks instead.
    const grid = coverGrid();
    expect(grid).toMatch(new RegExp(`\\b${cover.split}:grid-cols-`));
    expect(grid).not.toMatch(new RegExp(`\\b${cover.tooEarly}:grid-cols-`));
  });
});
