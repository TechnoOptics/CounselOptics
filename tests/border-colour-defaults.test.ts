import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import resolveConfig from 'tailwindcss/resolveConfig';
import { stripComments } from './support/strip-comments';
import tailwindConfig from '../tailwind.config';

/*
 * Where a border gets its colour when nobody said.
 *
 * Tailwind's preflight paints EVERY element's border before any utility
 * runs: `*, ::before, ::after { border: 0 solid theme(borderColor.DEFAULT) }`.
 * Stock, that DEFAULT is #e5e7eb, a light grey chosen for a white page.
 * Nothing in this repo overrode it, so any border that ended up without a
 * colour of its own painted near-white. On the cream surfaces that is
 * invisible and on every dark shell it is a white line, which is what the
 * owner reported and why it turned up on surface after surface rather than
 * in one component.
 *
 * The same hole exists three more times over: `divideColor.DEFAULT` is the
 * same grey, `ringOffsetColor.DEFAULT` is pure #fff, and `ringColor.DEFAULT`
 * is Tailwind's marketing blue, rgba(59,130,246,.5), which is not a colour
 * this product owns anywhere. A ring that loses its colour does not fail
 * quietly, it turns blue.
 *
 * So all four are pinned to tokens. `--border` and `--background` are
 * declared on `:root` and redefined under `.dark` and the shell classes, so
 * a border that falls back now falls back to the right colour in BOTH
 * themes instead of to a value designed for somebody else's white page.
 * This is the token rule in docs/DESIGN.md ("edges | `edge` | one border
 * colour, everywhere") applied to the one declaration every call site
 * inherits from.
 *
 * HOW A COLOUR GOES MISSING IN THE FIRST PLACE, which is the second half.
 * Tailwind only generates an opacity modifier whose value is in
 * `theme.opacity` (multiples of 5) or is written in the arbitrary form
 * `/[0.12]`. A bare `border-cream-100/12` matches neither, so Tailwind
 * emits NO rule at all: no error, no warning, no class. The markup asks for
 * a faint cream edge, no stylesheet answers, and preflight paints. Measured
 * on the deployed /enterprise page, four such elements resolved to
 * rgb(229, 231, 235) on a near-black panel.
 *
 * WHAT THIS CANNOT TELL YOU: that the borders which DO have a colour are
 * the right colour, or that any of it is legible. Only a rendered page says
 * that. See docs/DESIGN.md, "What done means for a surface".
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const resolved = resolveConfig(tailwindConfig);

/*
 * Tailwind's internal, reached with `require` because it ships no types for
 * `lib/`. Worth the awkwardness: this is the exact function the ring reset
 * calls, so the assertion below exercises the real code path rather than a
 * local restatement of what that path is believed to do.
 */
const { withAlphaValue } = createRequire(import.meta.url)(
  'tailwindcss/lib/util/withAlphaVariable',
) as { withAlphaValue: (c: unknown, a: string, fallback: string) => string };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(path)) {
      out.push(path);
    }
  }
  return out;
}

const FILES = ['app', 'components', 'lib'].flatMap((d) => sourceFiles(join(root, d)));

describe('the colour a border falls back to', () => {
  it('is the edge token, not Tailwind stock grey', () => {
    expect(resolved.theme?.borderColor?.DEFAULT).toBe('var(--border)');
    expect(resolved.theme?.divideColor?.DEFAULT).toBe('var(--border)');
  });

  /*
   * Asserted through Tailwind's own `withAlphaValue` rather than by reading
   * the theme key, because that call IS the ring reset and it is where a
   * plausible-looking value gets thrown away. Given the bare string
   * 'var(--border)' it returns its fallback instead, so the build stays
   * green, the config diff reads like a fix, and the compiled CSS still
   * says a blue. Asking the same function the same question is the only
   * form of this test that can tell those two apart.
   */
  it('never leaves a ring to paint Tailwind blue or a white halo', () => {
    const asRingReset = withAlphaValue(
      resolved.theme?.ringColor?.DEFAULT,
      resolved.theme?.ringOpacity?.DEFAULT ?? '0.5',
      'TAILWIND FELL BACK TO ITS OWN BLUE',
    );

    expect(asRingReset).toBe('var(--border)');
    expect(resolved.theme?.ringOffsetColor?.DEFAULT).toBe('var(--background)');
  });

  /*
   * Read back the stock values explicitly rather than only asserting the new
   * ones. A future config edit that drops the override does not fail the
   * assertions above with a helpful message; it fails with `undefined`, and
   * somebody reads that as "the key moved" rather than "the white border is
   * back".
   */
  it('is not the value that produced the reported defect', () => {
    expect(resolved.theme?.borderColor?.DEFAULT).not.toBe('#e5e7eb');
    expect(resolved.theme?.divideColor?.DEFAULT).not.toBe('#e5e7eb');
    expect(resolved.theme?.ringOffsetColor?.DEFAULT).not.toBe('#fff');
    expect(
      withAlphaValue(resolved.theme?.ringColor?.DEFAULT, '0.5', 'FELL BACK'),
    ).not.toBe('FELL BACK');
  });
});

describe('opacity modifiers Tailwind will actually compile', () => {
  /*
   * The scale is asked of the resolved config rather than written out as
   * "multiples of 5", so this keeps agreeing with Tailwind if the project
   * ever extends `theme.opacity` to include the values it currently drops.
   */
  const SCALE = new Set(Object.keys(resolved.theme?.opacity ?? {}));

  /*
   * Colour utilities only. `w-1/2`, `top-1/3` and `aspect-4/3` are fractions
   * and share the slash, so a pattern that is not anchored to a colour
   * family reports every layout class in the repo.
   */
  const MODIFIER =
    /\b(?:(?:[a-z-]+:)*)(border|divide|ring|outline)(?:-[trblxy])?-(?!\[)([a-z]+-\d{2,3}|black|white|current|transparent)\/(\d{1,3})\b/g;

  it('are the only ones used on a border, divide, ring or outline colour', () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      MODIFIER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = MODIFIER.exec(src))) {
        if (SCALE.has(match[3])) continue;
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${file.replace(`${root}`, '')}:${line}  ${match[0]}`);
      }
    }

    expect(
      offenders,
      'These compile to no CSS at all, so preflight paints the border instead. ' +
        `Use a value from theme.opacity (${[...SCALE].slice(0, 8).join(', ')}, ...) ` +
        'or the arbitrary form, e.g. border-cream-100/[0.12].',
    ).toEqual([]);
  });

  /*
   * The guard above is a regex over source text, so it is exactly the kind of
   * check a comment can satisfy by accident: a note explaining the fix that
   * happens to spell `border-cream-100/12` would be scanned as a call site
   * and turn the guard red for no reason, and the usual reaction to that is
   * to weaken the pattern until it no longer catches anything. Proving the
   * stripper runs first is what keeps the guard honest in both directions.
   */
  it('does not read the fix out of a comment', () => {
    const withComment = stripComments(
      ['const a = 1;', '// className="border-cream-100/12"', '/* divide-cream-100/8 */', 'const b = 2;'].join('\n'),
    );

    MODIFIER.lastIndex = 0;
    expect(MODIFIER.test(withComment)).toBe(false);

    MODIFIER.lastIndex = 0;
    expect(MODIFIER.test('className="border-cream-100/12"')).toBe(true);
  });
});
