import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dark panels that sit inside the consumer LIGHT pages.
 *
 * tests/consumer-light-legibility.test.ts measures the light ground and
 * says so; this is the other half, and it is the half a class sweep
 * cannot judge at all. A bare `text-cream-100/45` tells that sweep
 * nothing about whether it is cream on a dark mock (right) or cream on
 * the white page (invisible), so it lists rather than measures them.
 * The answer came from rendering instead - scripts/test/
 * rendered-contrast-audit.mjs samples the pixels under each run's own
 * glyph boxes - and what that harness found is written down here as
 * values, so the fixes cannot quietly drift back.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. It reads the shipped source and
 * does the WCAG arithmetic on it. It cannot see the composited page, so
 * it does NOT re-derive the grounds: each ground below is a measured
 * constant with the run it came from named next to it. The pairing is
 * deliberate - the harness proves the ground, this proves the ink still
 * clears it, and neither has to be run to trust the other.
 *
 * Every threshold is the ground's OWN requirement, computed from the
 * measured luminance rather than a copied number, so a test that passes
 * is a statement about contrast and not about a hex.
 */

const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Source with comments removed.
 *
 * Not caution for its own sake: the notes next to each fix in this
 * branch quote the value being fixed - "the terminal stop was #b89853"
 * - so a sweep for hexes over raw source reads the defect back out of
 * the sentence explaining it and fails a file that is correct. This
 * test found exactly that on its first run.
 */
function code(rel: string): string {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const TAILWIND = src('tailwind.config.ts');
const GLOBALS = src('app/globals.css');

/** WCAG relative luminance for 0-255 channels. */
function luminance(r: number, g: number, b: number): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  return luminance(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  );
}

/** The ink luminance a ground of `groundL` needs to reach `floor`:1. */
function inkLuminanceFor(groundL: number, floor: number): number {
  return floor * (groundL + 0.05) - 0.05;
}

/** `alpha` of cream #fbf7e9 composited over an opaque ground. */
function creamOver(alpha: number, ground: [number, number, number]): number {
  const ink = [251, 247, 233];
  return luminance(
    ink[0] * alpha + ground[0] * (1 - alpha),
    ink[1] * alpha + ground[1] * (1 - alpha),
    ink[2] * alpha + ground[2] * (1 - alpha),
  );
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every #rrggbb stop in a named backgroundImage key. */
function gradientStops(config: string, key: string): string[] {
  const at = config.indexOf(`'${key}':`);
  expect(at, `${key} is not declared in tailwind.config.ts`).toBeGreaterThan(-1);
  const value = config.slice(at, config.indexOf('\n', config.indexOf(')', at)));
  const stops = value.match(/#[0-9a-f]{6}/gi) ?? [];
  expect(stops.length, `${key} parsed to no stops at all`).toBeGreaterThan(3);
  return stops;
}

describe('the gold-shine ramp is legible on the ground it is for', () => {
  /*
   * `bg-clip-text` makes the GRADIENT the ink and leaves `color`
   * transparent, so the floor is asked of every stop rather than of an
   * average - the dark half of a ramp is not shading, it is a third of
   * each letter.
   *
   * Ground 0.14 is measured: the closing band of /example, where a 34px
   * heading sits directly under a .hero-orb--cream. It is the lightest
   * ground any gold-shine heading gets, lighter than the homepage's,
   * because that heading is shorter and nearer the orb's centre.
   */
  const HERO_LIGHTEST = 0.14;
  const LARGE_TEXT = 3;

  it('clears the large-text floor on the lightest hero ground, at every stop', () => {
    const need = inkLuminanceFor(HERO_LIGHTEST, LARGE_TEXT);
    for (const stop of gradientStops(TAILWIND, 'gold-shine')) {
      const L = hexLuminance(stop);
      expect(
        L,
        `gold-shine stop ${stop} is ${contrast(L, HERO_LIGHTEST).toFixed(2)}:1 on the ` +
          `lightest hero ground and needs ${LARGE_TEXT}:1`,
      ).toBeGreaterThanOrEqual(need);
    }
  });

  it('keeps a shimmer rather than flattening to one value', () => {
    // The reason the ramp was moved UP the same hue instead of being
    // replaced by a solid: the sweep is the one piece of motion these
    // headings spend on themselves. If a future edit satisfies the
    // floor by collapsing the range, that is a different design and
    // should not pass silently.
    const ls = gradientStops(TAILWIND, 'gold-shine').map(hexLuminance);
    expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThan(0.1);
  });

  it('still has a dark-ink counterpart for the light page', () => {
    // gold-shine-ink is the same shimmer for a WHITE ground. The two
    // must stay on opposite sides of any ground they share, or a call
    // site pairing them with `dark:` is pairing two of the same thing.
    const ink = gradientStops(TAILWIND, 'gold-shine-ink').map(hexLuminance);
    const shine = gradientStops(TAILWIND, 'gold-shine').map(hexLuminance);
    expect(Math.max(...ink)).toBeLessThan(Math.min(...shine));
  });
});

describe('the hero washes stay inside the contrast budget they were given', () => {
  /*
   * The wash and orb alphas are not only a look: they set the ground
   * every heading, eyebrow and body line on the band is read against.
   * At the shipped values they took that ground to luminance 0.19,
   * where even pure white is 2.7:1 - outside what a 3:1 floor can be
   * met on by ANY ink. Halving them is what made the ramp above, the
   * gold-200 eyebrow and the cream-100/85 body copy possible, so a
   * later edit that lightens them again silently un-fixes all three.
   */
  function heroBlock(): string {
    const start = GLOBALS.indexOf('.hero-bg {');
    expect(start, '.hero-bg is gone from globals.css').toBeGreaterThan(-1);
    return GLOBALS.slice(start, GLOBALS.indexOf('}', start));
  }

  it('holds every .hero-bg wash at or below its measured alpha', () => {
    const CEILINGS = [0.16, 0.19, 0.11, 0.05];
    const alphas = [...heroBlock().matchAll(/rgba\([^)]*?,\s*([0-9.]+)\)/g)].map((m) =>
      parseFloat(m[1]),
    );
    expect(alphas, 'the four .hero-bg washes are no longer four').toHaveLength(4);
    alphas.forEach((a, i) => {
      expect(a, `.hero-bg wash ${i + 1} is lighter than the budget allows`).toBeLessThanOrEqual(
        CEILINGS[i],
      );
    });
  });

  it('holds .hero-orb opacity at or below its measured value', () => {
    const start = GLOBALS.indexOf('.hero-orb {');
    expect(start).toBeGreaterThan(-1);
    const block = GLOBALS.slice(start, GLOBALS.indexOf('}', start));
    const opacity = parseFloat(/opacity:\s*([0-9.]+)/.exec(block)?.[1] ?? 'NaN');
    // A .hero-orb--cream sits directly behind the display heading in
    // both closing bands; at 0.55 it was the single biggest lightener
    // under any text on the site.
    expect(opacity).toBeLessThanOrEqual(0.32);
  });
});

describe('the cream alpha ramp clears the panels it is painted on', () => {
  /*
   * Grounds are measured, one per step, each the darkest panel that
   * step is actually painted on:
   *   near-black  the /enterprise firm mocks and the marketing portal
   *               mocks, #0b0b0c to #17161a
   *   forest      the /features and homepage hero cards, rgb(18,47,39)
   *   hero wash   the /example case header, rgb(45,89,69)
   */
  const PANELS: Record<string, [number, number, number]> = {
    '35': [11, 11, 12],
    '40': [11, 11, 12],
    '45': [11, 11, 12],
    '50': [18, 47, 39],
    '55': [45, 89, 69],
  };
  const SMALL_TEXT = 4.5;

  /** The alpha globals.css actually paints for `text-cream-100/<step>`. */
  function raisedAlpha(step: string): number {
    const re = new RegExp(
      `html \\.text-cream-100\\\\/${step}\\s*\\{\\s*color:\\s*rgba\\(251,\\s*247,\\s*233,\\s*([0-9.]+)\\)`,
    );
    const m = re.exec(GLOBALS);
    expect(m, `no raised alpha is declared for text-cream-100/${step}`).not.toBeNull();
    return parseFloat(m![1]);
  }

  it('clears 4.5:1 at every step, on that step’s own darkest panel', () => {
    for (const [step, ground] of Object.entries(PANELS)) {
      const groundL = luminance(...ground);
      const ratio = contrast(creamOver(raisedAlpha(step), ground), groundL);
      expect(
        ratio,
        `text-cream-100/${step} measures ${ratio.toFixed(2)}:1 on rgb(${ground.join(',')})`,
      ).toBeGreaterThanOrEqual(SMALL_TEXT);
    }
  });

  it('raises every step rather than lowering any', () => {
    for (const step of Object.keys(PANELS)) {
      expect(
        raisedAlpha(step),
        `text-cream-100/${step} is painted fainter than the call site asked for`,
      ).toBeGreaterThan(Number(step) / 100);
    }
  });

  it('keeps the five steps a ramp, not one value wearing five names', () => {
    // The whole reason the alpha moves and the colour does not: these
    // are five levels of quiet and the design depends on them being
    // distinguishable from each other.
    const alphas = Object.keys(PANELS)
      .sort((a, b) => Number(a) - Number(b))
      .map(raisedAlpha);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i], `step ${i} does not sit above the one below it`).toBeGreaterThan(
        alphas[i - 1],
      );
    }
  });
});

describe('the hand-painted dark panels clear their own grounds', () => {
  it('keeps the firm mock palette legible, and keeps its two levels apart', () => {
    const mocks = src('components/marketing/PortalMocks.tsx');
    const alpha = (name: string) => {
      const m = new RegExp(`${name}:\\s*'rgba\\(243,238,225,([0-9.]+)\\)'`).exec(mocks);
      expect(m, `PortalMocks no longer declares ${name}`).not.toBeNull();
      return parseFloat(m![1]);
    };
    // The panel these sit on, from the same file.
    const panel: [number, number, number] = [0x16, 0x16, 0x16];
    const panelL = luminance(...panel);
    const inkOver = (a: number) =>
      luminance(
        243 * a + panel[0] * (1 - a),
        238 * a + panel[1] * (1 - a),
        225 * a + panel[2] * (1 - a),
      );
    // 21 runs of `faint` are content at 8.5-10px: "Total items",
    // "Analyzed", "Processing", the citation under a result.
    expect(contrast(inkOver(alpha('faint')), panelL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(inkOver(alpha('dim')), panelL)).toBeGreaterThanOrEqual(4.5);
    expect(
      alpha('dim') - alpha('faint'),
      'dim and faint have converged into one grey',
    ).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps every stop of the Bella monogram on its forest disc', () => {
    const bella = code('components/BellaAvatar.tsx');
    const stops = bella.match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length, 'the monogram gradient is gone').toBeGreaterThanOrEqual(3);
    // Measured ground under the "B": the from-forest-700/via-800/to-950
    // disc, rgb(25,59,48).
    const groundL = luminance(25, 59, 48);
    const need = inkLuminanceFor(groundL, 4.5);
    for (const stop of stops) {
      expect(
        hexLuminance(stop),
        `monogram stop ${stop} is ${contrast(hexLuminance(stop), groundL).toFixed(2)}:1 on the disc`,
      ).toBeGreaterThanOrEqual(need);
    }
  });

  it('gives the enterprise sector tagline the full ink on its gold tab', () => {
    // forest-950 at 65% on bg-gold-metal measured 3.50:1. The alpha was
    // buying nothing the gold ground did not already give.
    const tabs = src('components/EnterpriseSectorTabs.tsx');
    expect(tabs).not.toMatch(/text-forest-950\/\d+/);
    expect(tabs).toContain("'text-forest-950'");
  });

  it('names the theme on the dark strips that paint from status tokens', () => {
    // `--warn-text` and `--danger-text` are declared per theme. A dark
    // panel that does not say which theme it paints gets the LIGHT
    // value on a dark ground - the amber figure measured 1.37:1. The
    // fix is to say so, NOT to hard-code a dark-only amber, which is
    // what tests/accent-text.test.ts refuses for a file like this that
    // also has a light ground.
    const example = src('app/example/page.tsx');
    for (const token of ['text-warn-text', 'text-danger-text']) {
      expect(example, `${token} is no longer painted here`).toContain(token);
    }
    expect(
      example,
      'the stat cell no longer declares the theme it is painted in',
    ).toMatch(/className="dark px-4/);
  });
});

describe('a full-screen panel does not render site chrome underneath itself', () => {
  /*
   * /safe paints `fixed inset-0 z-[90]`. The consumer header and footer
   * rendered beneath it: invisible to a sighted reader, but present in
   * the accessibility tree and the tab order, so a screen-reader or
   * keyboard user walked a header and footer nobody can see. The
   * rendered audit measured 18 such runs, the worst at 1.06:1, which
   * reads as a contrast catastrophe and is really this.
   */
  const LAYOUT = src('app/layout.tsx');

  it('knows /safe is an overlay route', () => {
    expect(LAYOUT).toMatch(/const isOverlayRoute =[\s\S]{0,120}'\/safe'/);
  });

  it('gates BOTH the header and the footer on the same flag', () => {
    const gated = LAYOUT.match(/\{showSiteChrome && \(/g) ?? [];
    expect(
      gated.length,
      'the header and footer no longer share one chrome gate',
    ).toBe(2);
  });

  it('does not reach for isShellMode, which would drop translation too', () => {
    // Folding /safe into isShellMode would also switch off consumer
    // AutoTranslate, and Safe Witness is the screen someone opens to
    // tell people where they are. It has to keep working in the
    // reader's own language; only the chrome goes.
    expect(LAYOUT).toMatch(/const isShellMode = [^\n]*isEmbedMode;/);
    expect(LAYOUT).not.toMatch(/isShellMode = [^\n]*isOverlayRoute/);
  });
});
