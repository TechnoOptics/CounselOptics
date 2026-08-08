import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../tailwind.config';
import {
  AA_SMALL_TEXT,
  DARK_SURFACE_GROUPS,
  LIGHT_SURFACE_GROUPS,
  contrastRatio,
  tightestInGroup,
} from '../lib/accent-text';

/**
 * A class a component names must actually compile.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * `gold-metal` was declared under `theme.extend.backgroundImage` and
 * nowhere else. Tailwind generates exactly ONE utility from a
 * backgroundImage key, `bg-<key>`, so `text-gold-metal`,
 * `ring-gold-metal`, `border-gold-metal`, `via-gold-metal`,
 * `accent-gold-metal` and even `bg-gold-metal/12` all matched no rule
 * and were dropped on the floor. 174 occurrences across 40 files, and
 * a full `next build` was green the whole time, because nothing checks
 * that a class a component writes resolves to a declaration.
 *
 * The fallbacks were not neutral. Tailwind's preflight sets
 * `--tw-ring-color: rgba(59,130,246,.5)`, so 46 rings rendered BLUE on
 * a product whose firm-facing brand is gold, and a bare `border`
 * rendered the preflight grey.
 *
 * WHAT THIS SWEEPS
 * ----------------
 * Every key under `backgroundImage`, every class token in app/,
 * components/ and lib/ that names one, and then the real Tailwind
 * compiler over exactly those tokens. A token whose selector is absent
 * from the compiled sheet fails. That is a stronger claim than "the key
 * exists in two places in the config": it is the build's own answer.
 *
 * It is deliberately not gold-specific. `forest-gradient`, `gold-shine`
 * and `gold-veil` go through the same sweep, so the next gradient added
 * without a colour twin fails the first time somebody writes
 * `border-<it>`.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Every key Tailwind will turn into exactly one `bg-*` utility. */
const IMAGE_KEYS = Object.keys(
  (config.theme?.extend?.backgroundImage ?? {}) as Record<string, unknown>,
);

/**
 * Colour keys as Tailwind flattens them: a nested `{ gold: { metal } }`
 * becomes `gold-metal`, which is the same name a backgroundImage key
 * can carry. That overlap is the point rather than an accident, so the
 * flattening has to match Tailwind's own.
 */
function flattenColors(
  value: unknown,
  prefix = '',
  out: string[] = [],
): string[] {
  if (typeof value === 'string' || typeof value === 'function') {
    if (prefix) out.push(prefix);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const name = k === 'DEFAULT' ? prefix : prefix ? `${prefix}-${k}` : k;
      flattenColors(v, name, out);
    }
  }
  return out;
}

const COLOR_KEYS = new Set(
  flattenColors((config.theme?.extend?.colors ?? {}) as Record<string, unknown>),
);

/** The globs tailwind.config.ts itself scans, as plain directories. */
const SOURCE_DIRS = ['app', 'components', 'lib'];

function sourceFiles(): string[] {
  return execFileSync(
    'find',
    [
      ...SOURCE_DIRS,
      '-type',
      'f',
      '(',
      '-name',
      '*.tsx',
      '-o',
      '-name',
      '*.ts',
      '-o',
      '-name',
      '*.jsx',
      '-o',
      '-name',
      '*.js',
      ')',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\n')
    .filter(Boolean);
}

/**
 * Class-shaped tokens that name one of the image keys.
 *
 * Split on the delimiters a className can use rather than matched with
 * one regex per utility family, so a prefix nobody thought of
 * (`divide-`, `outline-`, `decoration-`) is swept too. Comments are
 * stripped first: a note that names a class it replaced is not paint,
 * and a sweep that measures the note is the shape of a guard that stops
 * seeing the thing it guards.
 */
const TOKEN = new RegExp(
  `^(?:[a-z][a-z0-9-]*:)*[a-z][a-z0-9-]*-(${IMAGE_KEYS.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})(?:\\/(?:[0-9.]+|\\[[^\\]\\s]+\\]))?$`,
);

type Hit = { token: string; key: string; file: string };

function hitsIn(rel: string): Hit[] {
  const code = readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const out: Hit[] = [];
  for (const raw of code.split(/[\s"'`{}()<>,;=]+/)) {
    const m = TOKEN.exec(raw);
    if (m) out.push({ token: raw, key: m[1], file: rel });
  }
  return out;
}

const HITS = sourceFiles().flatMap(hitsIn);

/** The tokens that are NOT the one utility a backgroundImage key gives. */
const NON_IMAGE_HITS = HITS.filter((h) => h.token !== `bg-${h.key}`);

/**
 * Compile exactly the swept tokens with the project's real config and
 * return the class names that produced a rule.
 *
 * The Tailwind CLI rather than the PostCSS API on purpose: it is the
 * same binary `next build` runs, so a rule this reports as missing is a
 * rule the shipped stylesheet does not have either.
 */
function compiled(tokens: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-keys-'));
  writeFileSync(join(dir, 'probe.html'), `<div class="${tokens.join(' ')}"></div>`);
  writeFileSync(join(dir, 'in.css'), '@tailwind utilities;\n');
  return execFileSync(
    join(ROOT, 'node_modules/.bin/tailwindcss'),
    [
      '-c',
      join(ROOT, 'tailwind.config.ts'),
      '-i',
      join(dir, 'in.css'),
      '--content',
      join(dir, 'probe.html'),
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/**
 * Does the compiled sheet carry a rule for this class?
 *
 * Matched as "the escaped selector, not followed by another name
 * character" rather than by looking for a brace: a variant leaves the
 * class name butted against its own pseudo-selector
 * (`.dark\:bg-gold-metal:is(.dark *)`), so anything stricter reports
 * every `dark:` and `hover:` spelling as missing.
 */
function isCompiled(css: string, token: string): boolean {
  const selector = '.' + token.replace(/[:./[\]%]/g, (c) => `\\${c}`);
  return new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])',
  ).test(css);
}

const CSS = compiled([...new Set(HITS.map((h) => h.token))]);

describe('no utility names a key that only exists as a gradient', () => {
  it('finds the gradient keys and their call sites at all', () => {
    // An empty sweep passes every assertion below without measuring
    // anything, which is exactly how this defect survived.
    expect(IMAGE_KEYS.length).toBeGreaterThanOrEqual(4);
    expect(HITS.length).toBeGreaterThanOrEqual(180);
    expect(NON_IMAGE_HITS.length).toBeGreaterThanOrEqual(150);
  });

  it('gives every gradient key a colour of the same name where one is used as a colour', () => {
    // `bg-<key>` is the one utility a backgroundImage key generates. Any
    // other prefix, and `bg-<key>/<alpha>` too, resolves through the
    // COLOUR palette, so the key has to exist there as well.
    const missing = [
      ...new Set(
        NON_IMAGE_HITS.filter((h) => !COLOR_KEYS.has(h.key)).map(
          (h) => `${h.file}: ${h.token}`,
        ),
      ),
    ].sort();
    expect(
      missing,
      'these utilities name a key declared only under backgroundImage',
    ).toEqual([]);
  });

  it('compiles every swept token to a real rule', () => {
    const dropped = [
      ...new Set(
        HITS.filter((h) => !isCompiled(CSS, h.token)).map(
          (h) => `${h.file}: ${h.token}`,
        ),
      ),
    ].sort();
    expect(dropped, 'these classes compile to nothing').toEqual([]);
  });

  it('keeps every gradient a gradient', () => {
    // The cheap way to make the sweep above pass is to delete the
    // gradient and leave a flat colour. `bg-gold-metal` is used 123
    // times as the brand's metallic fill and must stay one.
    for (const key of IMAGE_KEYS) {
      const declared = (
        config.theme?.extend?.backgroundImage as Record<string, string>
      )[key];
      expect(declared, `${key} is no longer a gradient`).toContain('gradient(');
    }
    expect(CSS, 'bg-gold-metal lost its gradient').toContain(
      'background-image: linear-gradient(180deg, #f2d896 0%',
    );
  });

  it('states the regression this guard exists for, as arithmetic', () => {
    // The shipped config, reconstructed: gold-metal as a gradient and
    // nothing else. Every non-bg utility on it compiles to nothing, so
    // a future edit that moves a key back out of `colors` cannot pass
    // the sweep above by accident.
    const dir = mkdtempSync(join(tmpdir(), 'tw-keys-regress-'));
    const shipped = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8')
      .replace(/^\s*metal: '#[0-9a-fA-F]{6}',\s*$/m, '');
    writeFileSync(join(dir, 'tailwind.config.ts'), shipped);
    writeFileSync(
      join(dir, 'probe.html'),
      '<div class="bg-gold-metal bg-gold-metal/12 text-gold-metal ring-gold-metal/25 border-gold-metal/40"></div>',
    );
    writeFileSync(join(dir, 'in.css'), '@tailwind utilities;\n');
    const before = execFileSync(
      join(ROOT, 'node_modules/.bin/tailwindcss'),
      ['-c', join(dir, 'tailwind.config.ts'), '-i', join(dir, 'in.css'), '--content', join(dir, 'probe.html')],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    expect(before, 'the gradient-only key still emitted a background').toContain(
      '.bg-gold-metal {',
    );
    for (const gone of [
      '.bg-gold-metal\\/12',
      '.text-gold-metal',
      '.ring-gold-metal\\/25',
      '.border-gold-metal\\/40',
    ]) {
      expect(
        before.includes(gone),
        `${gone} compiled without a colour of the same name, so the guard proves nothing`,
      ).toBe(false);
    }
  });
});

/*
 * The gold, now that it is a colour, has to be READABLE as one.
 *
 * Making `text-gold-metal` compile is only half the fix. A class that
 * resolves to a hex the ground cannot carry is a different defect, not
 * a fixed one, so the same discipline the status palette is held to
 * applies here: measure the value on every surface the class can land
 * on, on both grounds, and record the arithmetic rather than the
 * intention.
 *
 * WHERE IT LANDS. Every `text-gold-metal` call site is inside the
 * counsel shell except two: app/share/[token]/unlock-form.tsx, whose
 * viewer paints its own `bg-forest-950` in both themes, and
 * app/changelog/page.tsx, which is white in the consumer light theme
 * and therefore carries an explicit light value at the call site. So
 * the dark claim is the counsel group, and the light claim is the light
 * counsel group via the repaint in app/globals.css.
 */
describe('the metallic gold reads as words on both grounds', () => {
  const METAL = (
    (config.theme?.extend?.colors as Record<string, Record<string, string>>)
      .gold
  ).metal;

  /** The light counsel repaint, read back out of the stylesheet. */
  const LIGHT_METAL = (() => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rule = new RegExp(
      String.raw`\.counsel-shell:not\(\.dark\)\s+\.text-gold-metal\s*,[\s\S]*?\{\s*color:\s*(#[0-9a-fA-F]{6})\s*;`,
    ).exec(css);
    return rule?.[1] ?? null;
  })();

  it('is a plain hex the config actually carries', () => {
    // Anchored on the config object rather than on the file text, so a
    // key that is commented out or renamed fails here instead of
    // quietly making every measurement below vacuous.
    expect(METAL, 'gold.metal is gone from tailwind.config.ts').toMatch(
      /^#[0-9a-fA-F]{6}$/,
    );
    expect(LIGHT_METAL, 'the light counsel repaint is gone').toMatch(
      /^#[0-9a-fA-F]{6}$/,
    );
  });

  it(`clears ${AA_SMALL_TEXT}:1 on every dark counsel surface`, () => {
    for (const [name, surface] of Object.entries(
      DARK_SURFACE_GROUPS.counsel.surfaces,
    )) {
      const ratio = contrastRatio(METAL, surface);
      expect(
        ratio,
        `text-gold-metal ${METAL} measures ${ratio.toFixed(3)}:1 on the ${name} (${surface})`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it(`clears ${AA_SMALL_TEXT}:1 on every light counsel surface, after the repaint`, () => {
    for (const [name, surface] of Object.entries(
      LIGHT_SURFACE_GROUPS.counselLight.surfaces,
    )) {
      const ratio = contrastRatio(LIGHT_METAL as string, surface);
      expect(
        ratio,
        `the repaint ${LIGHT_METAL} measures ${ratio.toFixed(3)}:1 on the ${name} (${surface})`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it('states why the repaint exists, as arithmetic', () => {
    // Without it the dark value lands on the light page unchanged.
    for (const surface of Object.values(
      LIGHT_SURFACE_GROUPS.counselLight.surfaces,
    )) {
      expect(
        contrastRatio(METAL, surface),
        'the dark gold is legible on light counsel, so the repaint is unnecessary',
      ).toBeLessThan(AA_SMALL_TEXT);
    }
  });

  it('lets no faded spelling of the gold back in as text', () => {
    /*
     * `text-gold-metal/60` through `/90` were written 24 times while
     * the class compiled to nothing, so no alpha was ever painted and
     * none is being taken away. Composited they do not clear the floor
     * on the tightest surface those labels sit on: 2.79:1 at 60
     * percent, 3.30:1 at 70, and still 4.13:1 at 85. Decoration keeps
     * its alpha; words do not.
     */
    const faded = sourceFiles()
      .flatMap((rel) => {
        const code = readFileSync(join(ROOT, rel), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        return [...code.matchAll(/[a-z:-]*text-gold-metal\/[\w.[\]]+/g)].map(
          (m) => `${rel}: ${m[0]}`,
        );
      })
      .sort();
    expect(faded, 'faded gold text is under the floor on its own ground').toEqual(
      [],
    );

    const ch = (hex: string) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const over = (fg: string, bg: string, a: number) =>
      '#' +
      ch(fg)
        .map((v, i) =>
          Math.round(v * a + ch(bg)[i] * (1 - a))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    const ground = tightestInGroup('counsel');
    for (const alpha of [0.6, 0.7, 0.8, 0.85]) {
      expect(
        contrastRatio(over(METAL, ground, alpha), ground),
        `gold at ${alpha} would have cleared the floor, so the collapse was unnecessary`,
      ).toBeLessThan(AA_SMALL_TEXT);
    }
  });
});
