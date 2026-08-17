import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The homepage hero, held to docs/DESIGN.md.
 *
 * WHAT THIS FILE IS FOR. The spec allows the accent ONE claim per view.
 * Measured on a production build before this change, the hero made five
 * claims on a light ground and eight on a dark one (the extra three were
 * statistic labels that only turn gold under `dark:`), and the first
 * viewport of the page made 11 to 16, none of which were the hero's,
 * because the hero starts 1637px down at 1280px wide.
 *
 * Every assertion below is a specific thing that was true, was wrong, and
 * is cheap to reintroduce by pasting a class from another section.
 */

const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Source with comments removed.
 *
 * NOT CAUTION FOR ITS OWN SAKE. The notes beside each fix in the hero
 * quote the thing being removed, including the literal
 * `rgba(213,187,126,0.45)` and the words "gold-shine-ink" and "italic".
 * A sweep over raw source therefore reads the defect back out of the
 * sentence that explains the defect, and every assertion here would fail
 * on a file that is correct. Worse, the inverse also happens: a guard
 * asserting the PRESENCE of a token passes on the comment alone, so it
 * keeps passing after someone deletes the code. This repo has shipped
 * that exact bug more than once, so the stripping is load-bearing and
 * `strips its own explanatory comments` below proves it still works.
 *
 * Same shape as the helper in tests/dark-panel-contrast.test.ts.
 */
function code(rel: string): string {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The body of a top-level `function <name>(` up to the next one. */
function fn(rel: string, name: string): string {
  const source = code(rel);
  const start = source.search(new RegExp(`^function ${name}\\b`, 'm'));
  expect(
    start,
    `${name} should exist as a top-level function in ${rel}`
  ).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/^function \w/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const PAGE = 'app/page.tsx';
const SPLIT = 'components/AudienceSplit.tsx';

/**
 * Everything the hero owns, not just `Hero` itself.
 *
 * `ProductPreview`, `Sparkline`, `Tile` and `Stat` are private to the
 * hero, and the raw gold halo this change removed lived in
 * `ProductPreview`, NOT in `Hero`. A first version of the raw-colour
 * assertion below was scoped to `Hero` alone, and the mutation harness
 * put the halo back into `ProductPreview` and the guard stayed green.
 * `ArrowRight` is the first function after them that is shared with
 * sections further down the page, so it is the boundary.
 */
function heroRegion(): string {
  const source = code(PAGE);
  const start = source.search(/^function Hero\b/m);
  const end = source.search(/^function ArrowRight\b/m);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Count non-overlapping literal occurrences. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('the comment stripper the rest of this file depends on', () => {
  it('strips its own explanatory comments', () => {
    // The raw file DOES contain these, inside the notes beside each fix.
    expect(src(PAGE)).toContain('rgba(213,187,126,0.45)');
    expect(src(PAGE)).toContain('gold-shine-ink');
    // Stripped, they are gone from the hero, which is the real claim.
    expect(fn(PAGE, 'Hero')).not.toContain('rgba(213,187,126');
    expect(fn(PAGE, 'Hero')).not.toContain('gold-shine');
  });

  it('removes both comment forms', () => {
    expect(code(PAGE)).not.toContain('THE ACCENT IS SPENT ONCE');
    // A `//` line comment exists in ProductPreview's preamble.
    expect(code(PAGE)).not.toMatch(/^\s*\/\/ When NEXT_PUBLIC_HERO/m);
  });
});

describe('the hero spends the accent once, on the button', () => {
  const hero = () => fn(PAGE, 'Hero');

  it('has no gold gradient clipped to text', () => {
    expect(hero()).not.toContain('gold-shine');
    expect(hero()).not.toContain('bg-clip-text');
  });

  it('does not animate a shimmer across the headline', () => {
    expect(hero()).not.toContain('gold-pan');
  });

  it('sets no italic, because Fraunces ships no italic face here', () => {
    // app/layout.tsx loads Fraunces with `weight` only and no `style`,
    // so any `italic` in the hero is a synthesised slant, not a face.
    expect(hero()).not.toMatch(/\bitalic\b/);
    const layout = code('app/layout.tsx');
    const decl = layout.slice(layout.indexOf('Fraunces({'));
    expect(
      decl.slice(0, decl.indexOf('})')),
      'if a real italic axis is ever loaded, revisit the assertion above'
    ).not.toContain('italic');
  });

  it('carries no raw colour in the hero itself, only tokens', () => {
    expect(hero()).not.toMatch(/rgba?\(\s*213/);
    expect(hero()).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('states the accent through tokens across everything the hero owns', () => {
    /* Scoped to the whole hero region, because the halo this replaces was
       in `ProductPreview` rather than `Hero`, and a guard scoped to `Hero`
       stayed green when the mutation harness put it back.

       Gold LITERALS only, not every hex: the unreachable card stack in
       `ProductPreview` paints a `#10b981` sparkline, which is semantic
       emerald and is a separate question from the accent. docs/DESIGN.md
       keeps "good, warning and critical" as their own hues precisely so
       they are not confused with the gold. */
    const region = heroRegion();
    expect(region).not.toContain('213,187,126');
    expect(region).not.toContain('213, 187, 126');
    for (const goldHex of [
      '#d5bb7e',
      '#c2a66a',
      '#f2d896',
      '#e5c07c',
      '#b08229',
      '#d4a14a',
      '#c79532',
    ]) {
      expect(region.toLowerCase()).not.toContain(goldHex);
    }
  });

  it('never turns text gold under dark:, so dark is designed not inverted', () => {
    // This was the light/dark asymmetry: five claims became eight purely
    // through `dark:text-gold-300` on the eyebrow and three <dt> labels.
    expect(hero()).not.toMatch(/dark:text-gold-/);
  });

  it('claims the accent with exactly one resting spelling', () => {
    const RESTING_GOLD = /(?<!hover:)(?<!dark:hover:)\b(?:bg|text|ring|border|from|via|to)-gold-[a-z0-9]+/g;
    const found = new Set(hero().match(RESTING_GOLD) ?? []);
    // `bg-gold-metal` is the button fill and is the one claim. It appears
    // twice in source because the signed-in and signed-out CTAs are
    // mutually exclusive branches, so only one ever paints.
    expect([...found].sort()).toEqual(['bg-gold-metal']);
  });

  it('keeps the gold on the primary action and nothing else', () => {
    const h = hero();
    for (const m of h.matchAll(/bg-gold-metal/g)) {
      const line = h.slice(0, m.index).split('\n').pop() ?? '';
      const context = h.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
      expect(
        /<Link/.test(context) || /<Link/.test(line),
        'bg-gold-metal should only ever dress a CTA link'
      ).toBe(true);
    }
  });
});

describe('the headline', () => {
  it('wraps with text-balance and no manual break', () => {
    const hero = fn(PAGE, 'Hero');
    const h1 = hero.slice(hero.indexOf('<h1'), hero.indexOf('</h1>'));
    expect(h1).toContain('text-balance');
    // A hard <br/> between two words previously collapsed them in
    // innerText ("happenall") for screen readers and crawlers. There is
    // no manual break left to get wrong.
    expect(h1).not.toContain('<br');
  });

  it('keeps the display face and does not reach for font-serif', () => {
    const hero = fn(PAGE, 'Hero');
    const h1 = hero.slice(hero.indexOf('<h1'), hero.indexOf('</h1>'));
    expect(h1).toContain('font-display');
    // docs/DESIGN.md reserves font-serif for rendered documents, where it
    // means "this is the instrument".
    expect(fn(PAGE, 'Hero')).not.toContain('font-serif');
  });
});

describe('the hero product shot', () => {
  const preview = () => fn(PAGE, 'ProductPreview');

  it('picks its image by the same authority as the rest of the page', () => {
    // components/ThemeBoot.tsx themes by toggling a `dark` CLASS on
    // <html>, resolved from localStorage['advottic-theme'] then a
    // serverTheme that defaults to 'light'. A <picture> keyed on
    // prefers-color-scheme therefore disagreed with the page in two of
    // the four combinations.
    expect(preview()).not.toContain('prefers-color-scheme');
    expect(preview()).not.toContain('<picture');
    expect(preview()).toContain('dark:hidden');
    expect(preview()).toContain('hidden dark:block');
  });

  it('scales instead of cropping', () => {
    // 2880x2160 sources in an aspect-[4/5] box under object-cover lost
    // 40% of the width to a centre crop.
    const shot = preview().slice(0, preview().indexOf('NOTE') + 1 || undefined);
    const screenshotBranch = preview().slice(
      0,
      preview().indexOf('Back card')
    );
    expect(screenshotBranch).not.toContain('object-cover');
    expect(screenshotBranch).toContain('h-auto');
  });

  it('still describes itself to a screen reader', () => {
    const screenshotBranch = preview().slice(
      0,
      preview().indexOf('Back card')
    );
    const alts = screenshotBranch.match(/alt="/g) ?? [];
    // One per themed copy, and neither may be empty.
    expect(alts.length).toBe(2);
    expect(screenshotBranch).not.toContain('alt=""');
  });
});

describe('the statistics strip', () => {
  it('does not claim tabular figures for values with no figures', () => {
    const hero = fn(PAGE, 'Hero');
    const dl = hero.slice(hero.indexOf('<dl'), hero.indexOf('</dl>'));
    // "Daily", "A -> Z+" and "Yours" contain no digit, and tabular-nums
    // only aligns digits.
    const values = [...dl.matchAll(/<dd[^>]*>\s*([^<]+?)\s*<\/dd>/g)].map(
      (m) => m[1]
    );
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      if (!/\d/.test(v)) {
        // find the dd that holds it and assert it is not tabular
        const idx = dl.indexOf(v);
        const openTag = dl.slice(0, idx).lastIndexOf('<dd');
        expect(
          dl.slice(openTag, idx),
          `"${v}" has no digits, so tabular-nums does nothing`
        ).not.toContain('tabular-nums');
      }
    }
  });

  it('has no comment asserting these are numbers', () => {
    // The note here used to claim "every claim is paired with a specific
    // number", which was false for all three. A comment that describes
    // behaviour the code does not have is how the dead tabular-nums
    // survived review.
    expect(src(PAGE)).not.toContain('every claim is paired with a specific number');
    expect(src(PAGE)).not.toContain('Numeric proof strip');
  });
});

describe('the fold above the hero', () => {
  const header = () => {
    const s = code(SPLIT);
    return s.slice(s.indexOf('<header'), s.indexOf('</header>'));
  };

  it('drops the gold rule so the fold has one claim', () => {
    expect(header()).not.toMatch(/bg-gold-(400|500)/);
  });

  it('drops the synthesised italic gradient from its heading', () => {
    expect(header()).not.toContain('gold-shine');
    expect(header()).not.toMatch(/\bitalic\b/);
    expect(header()).not.toContain('gold-pan');
  });

  it('keeps the eyebrow label itself, which is that one claim', () => {
    // Deliberately still gold. If this ever goes too, the fold has no
    // accent at all, which is a different decision and wants its own
    // conversation rather than a silent drift.
    expect(header()).toContain('text-gold-700');
  });

  it('is otherwise untouched: the cards keep their own treatment', () => {
    /* Scope guard. This change was allowed exactly two removals in this
       file, both in the <header>; the card grid below it was not in scope
       and a later "while I am here" sweep is what this catches.

       COUNTS, NOT PRESENCE. The first version asserted only that
       `ring-gold-500` still appeared somewhere, and the mutation harness
       deleted one of its three occurrences and the guard stayed green.
       "At least one survives" is not the invariant; "none of them left"
       is. */
    const s = code(SPLIT);
    const cards = s.slice(s.indexOf('</header>'));
    const EXPECTED: Record<string, number> = {
      'bg-gold-metal': 3,
      'ring-gold-500': 3,
      'bg-gold-500': 1,
      'text-gold-300': 9,
      'text-gold-700': 2,
      'bg-gold-100': 3,
      'text-gold-800': 3,
      'bg-gold-400': 7,
    };
    const actual = Object.fromEntries(
      Object.keys(EXPECTED).map((k) => [k, count(cards, k)])
    );
    expect(actual).toEqual(EXPECTED);
  });
});
