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
const HOME = stripComments(readFileSync(join(ROOT, 'app/page.tsx'), 'utf8'));

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

describe('the home cover gives the sheet a real column', () => {
  it('does not lay the cover on a twelve track grid', () => {
    // Eleven gutters at `gap-14` are 693px. No twelve track grid on this page
    // survives that, whatever the spans on its children say.
    expect(HOME).not.toMatch(/grid-cols-12/);
    expect(HOME).not.toMatch(/col-span-\d/);
  });

  it('splits the cover into two tracks with one gutter', () => {
    const at = HOME.indexOf('Left: editorial copy block');
    expect(at, 'the cover copy column is gone').toBeGreaterThan(-1);
    const grid = /<div className="(grid [^"]*)">\s*$/m.exec(HOME.slice(0, at))?.[1] ?? '';
    expect(grid, 'the cover is no longer a grid').toBeTruthy();
    expect(grid).toMatch(/grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  });

  it('holds the split back to xl, because lg is where the binder tab opens', () => {
    // Section turns on its 200px tab column at lg, which leaves 689px for the
    // whole cover at 1024. Split there, the sheet cannot be wider than about
    // 260px and the 61px display headline cannot be narrower than its own
    // longest word; below xl the cover stacks instead.
    const at = HOME.indexOf('Left: editorial copy block');
    const grid = /<div className="(grid [^"]*)">\s*$/m.exec(HOME.slice(0, at))?.[1] ?? '';
    expect(grid).toMatch(/\bxl:grid-cols-/);
    expect(grid).not.toMatch(/\blg:grid-cols-/);
  });
});
