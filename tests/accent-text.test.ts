import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AA_SMALL_TEXT,
  ACCENT_ON_DARK,
  ACCENT_ON_LIGHT,
  ACCENT_ON_SPLIT,
  ACCENT_TEXT_SURFACES,
  ACCENT_TEXT_TONES,
  ACHROMATIC_CHROMA,
  DEFAULT_ACCENT,
  accentOn,
  contrastRatio,
  deriveAccentText,
  relativeLuminance,
  toOklch,
} from '../lib/accent-text';

const globalsCss = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

/**
 * Every colour a customer can put in firms.accent_color, at a stride
 * that still lands on the gamut corners (0 and 255 are both included,
 * so pure red / green / blue / yellow / cyan / magenta / black / white
 * are all in the set). 6^3 = 216 corners plus the interior: 4913 hexes.
 */
function everyAccent(step = 17): string[] {
  const out: string[] = [];
  for (let r = 0; r <= 255; r += step)
    for (let g = 0; g <= 255; g += step)
      for (let b = 0; b <= 255; b += step)
        out.push(
          '#' +
            [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''),
        );
  return out;
}

const ACCENTS = everyAccent();

/*
 * How far the hue may move. Nothing here gamut-maps, so this budget is
 * purely the 8-bit rounding of the returned hex: at a low chroma a
 * single least-significant bit is a couple of degrees of angle. The
 * chroma round-trip assertion below is what actually proves no gamut
 * mapping happened, because clipping moves chroma far more than
 * rounding does. The CSS oklch() path does not quantise at all, so this
 * budget applies to the TypeScript helper and not to the paint.
 */
const HUE_QUANTISATION_DEGREES = 3;

/**
 * The colours most likely to be picked by a real firm AND most likely
 * to break a naive derivation: fully saturated primaries, the pale
 * yellow and the navy from the brief, plus the achromatic edge cases.
 */
const NAMED_WORST_CASES = {
  'pure red': '#ff0000',
  'pure green': '#00ff00',
  'pure blue': '#0000ff',
  'pure yellow': '#ffff00',
  'pure cyan': '#00ffff',
  'pure magenta': '#ff00ff',
  'pale yellow': '#fff9c4',
  navy: '#1f3a93',
  'deep forest': '#0f2d24',
  black: '#000000',
  white: '#ffffff',
  'mid grey': '#808080',
  'advottic gold': DEFAULT_ACCENT,
};

describe('deriveAccentText clears AA on every surface it can land on', () => {
  for (const tone of ['dark', 'light'] as const) {
    for (const [surfaceName, surface] of Object.entries(
      ACCENT_TEXT_SURFACES[tone],
    )) {
      it(`${tone}: any accent is >= ${AA_SMALL_TEXT}:1 on ${surfaceName}`, () => {
        let worst = { ratio: Infinity, accent: '', token: '' };
        for (const accent of ACCENTS) {
          const token = deriveAccentText(accent, tone);
          const ratio = contrastRatio(token, surface);
          if (ratio < worst.ratio) worst = { ratio, accent, token };
        }
        expect(
          worst.ratio,
          `worst accent ${worst.accent} -> ${worst.token} on ${surface} measured ${worst.ratio.toFixed(3)}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }
  }
});

describe('the named worst cases, with their measured numbers', () => {
  for (const [label, accent] of Object.entries(NAMED_WORST_CASES)) {
    it(`${label} (${accent}) is legible in both tones`, () => {
      const onDark = deriveAccentText(accent, 'dark');
      const onLight = deriveAccentText(accent, 'light');
      // The tightest surface of each tone.
      expect(
        contrastRatio(onDark, ACCENT_TEXT_SURFACES.dark['counsel .bg-cream-200']),
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      expect(
        contrastRatio(onLight, ACCENT_TEXT_SURFACES.light['cream-200']),
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});

describe('the derivation keeps the firm hue', () => {
  it('preserves hue to within the quantisation budget for a chromatic accent', () => {
    for (const accent of ['#1f3a93', '#e11d48', '#059669', '#d5bb7e']) {
      const source = toOklch(accent);
      for (const tone of ['dark', 'light'] as const) {
        const derived = toOklch(deriveAccentText(accent, tone));
        // Shortest angular distance, so 359 -> 1 counts as 2 and not 358.
        const delta = Math.abs(((derived.h - source.h + 540) % 360) - 180);
        expect(
          delta,
          `${accent} ${tone}: hue moved from ${source.h.toFixed(1)} to ${derived.h.toFixed(1)}`,
        ).toBeLessThan(HUE_QUANTISATION_DEGREES);
      }
    }
  });

  it('pins the lightness it says it pins', () => {
    for (const tone of ['dark', 'light'] as const) {
      for (const accent of ['#000000', '#ffffff', '#1f3a93', '#fff9c4']) {
        expect(toOklch(deriveAccentText(accent, tone)).l).toBeCloseTo(
          ACCENT_TEXT_TONES[tone].lightness,
          2,
        );
      }
    }
  });

  it('caps chroma, so a vivid accent cannot clip its way under the floor', () => {
    for (const tone of ['dark', 'light'] as const) {
      for (const accent of ['#ff0000', '#00ff00', '#0000ff', '#ff00ff']) {
        expect(toOklch(deriveAccentText(accent, tone)).c).toBeLessThanOrEqual(
          ACCENT_TEXT_TONES[tone].maxChroma + 0.005,
        );
      }
    }
  });

  it('never leaves sRGB, so no browser gamut mapping can move the result', () => {
    // This is the claim the contrast floor rests on. If a cap is ever
    // raised past the sRGB boundary at its pinned lightness, the derived
    // colour starts depending on whether the browser clips channels or
    // reduces chroma, and the arithmetic above stops describing the
    // paint. Round-tripping through the hex is the check: a value that
    // had to be clamped comes back with a different chroma or hue.
    for (const tone of ['dark', 'light'] as const) {
      const { lightness, maxChroma } = ACCENT_TEXT_TONES[tone];
      for (const accent of ACCENTS) {
        const source = toOklch(accent);
        if (source.c < ACHROMATIC_CHROMA) continue;
        const derived = toOklch(deriveAccentText(accent, tone));
        const expectedChroma = Math.min(source.c, maxChroma);
        // 8-bit hex quantisation alone is worth about 0.002 of chroma.
        expect(
          Math.abs(derived.c - expectedChroma),
          `${accent} ${tone}: chroma ${expectedChroma.toFixed(4)} came back as ${derived.c.toFixed(4)}`,
        ).toBeLessThan(0.005);
        expect(Math.abs(derived.l - lightness)).toBeLessThan(0.005);
        const hueDrift = Math.abs(
          ((derived.h - source.h + 540) % 360) - 180,
        );
        expect(
          hueDrift,
          `${accent} ${tone}: hue drifted ${hueDrift.toFixed(2)} degrees`,
        ).toBeLessThan(HUE_QUANTISATION_DEGREES);
      }
    }
  });

  it('gives an achromatic accent a deterministic neutral, not a tinted grey', () => {
    for (const tone of ['dark', 'light'] as const) {
      const fromBlack = deriveAccentText('#000000', tone);
      const fromWhite = deriveAccentText('#ffffff', tone);
      const fromGrey = deriveAccentText('#808080', tone);
      expect(fromBlack).toBe(fromWhite);
      expect(fromBlack).toBe(fromGrey);
      expect(toOklch(fromBlack).c).toBeLessThan(ACHROMATIC_CHROMA);
    }
  });
});

describe('accentOn covers the whole fill range', () => {
  it('is >= 4.5:1 on every accent a customer can pick', () => {
    let worst = { ratio: Infinity, accent: '', fg: '' };
    for (const accent of ACCENTS) {
      const fg = accentOn(accent);
      const ratio = contrastRatio(fg, accent);
      if (ratio < worst.ratio) worst = { ratio, accent, fg };
    }
    expect(
      worst.ratio,
      `worst fill ${worst.accent} with ${worst.fg} measured ${worst.ratio.toFixed(3)}:1`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('picks the readable one at the split, in both directions', () => {
    // Below the split white wins, above it black does. Both sides of the
    // boundary must still clear the floor, which is the whole reason the
    // split sits inside the overlap of the two passing intervals.
    const justBelow = ACCENT_ON_SPLIT - 0.005;
    const justAbove = ACCENT_ON_SPLIT + 0.005;
    const greyAt = (y: number) => {
      // Solve for the neutral hex with this WCAG luminance.
      let lo = 0,
        hi = 255;
      for (let i = 0; i < 32; i++) {
        const mid = Math.round((lo + hi) / 2);
        const hex = '#' + mid.toString(16).padStart(2, '0').repeat(3);
        if (relativeLuminance(hex) < y) lo = mid;
        else hi = mid;
      }
      return '#' + hi.toString(16).padStart(2, '0').repeat(3);
    };
    const below = greyAt(justBelow);
    const above = greyAt(justAbove);
    expect(accentOn(below)).toBe(ACCENT_ON_LIGHT);
    expect(accentOn(above)).toBe(ACCENT_ON_DARK);
    expect(contrastRatio(accentOn(below), below)).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    );
    expect(contrastRatio(accentOn(above), above)).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    );
  });

  it('rejects the hardcoded text-white and text-black these sites used to carry', () => {
    // Not a style preference: each of these was a shipped call site.
    // Gold with white on it is the counsel/signer header avatar, navy
    // with black on it is the portal rail avatar.
    expect(contrastRatio('#ffffff', DEFAULT_ACCENT)).toBeLessThan(AA_SMALL_TEXT);
    expect(contrastRatio('#000000', '#1f3a93')).toBeLessThan(AA_SMALL_TEXT);
    // And the token fixes both.
    expect(contrastRatio(accentOn(DEFAULT_ACCENT), DEFAULT_ACCENT)).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    );
    expect(contrastRatio(accentOn('#1f3a93'), '#1f3a93')).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    );
  });
});

describe('the fixed status tokens clear the same floor', () => {
  const cases: Array<[string, string, string]> = [
    ['--warn-text dark', '#fbbf24', ACCENT_TEXT_SURFACES.dark['counsel .bg-cream-200']],
    ['--danger-text dark', '#f87171', ACCENT_TEXT_SURFACES.dark['counsel .bg-cream-200']],
    ['--warn-text light', '#92400e', ACCENT_TEXT_SURFACES.light['cream-200']],
    ['--danger-text light', '#b91c1c', ACCENT_TEXT_SURFACES.light['cream-200']],
  ];
  for (const [label, token, surface] of cases) {
    it(`${label} is >= ${AA_SMALL_TEXT}:1 on ${surface}`, () => {
      expect(contrastRatio(token, surface)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }

  it('each token value is the one globals.css actually declares', () => {
    for (const token of ['#fbbf24', '#f87171', '#92400e', '#b91c1c']) {
      expect(globalsCss).toContain(token);
    }
  });
});

/*
 * The tokens ship as CSS, so the arithmetic above only proves the
 * shipped product if the CSS carries the same numbers. This reads
 * app/globals.css and fails on any drift, which is the closest a
 * node-environment suite can get to asserting on the paint.
 */
describe('app/globals.css agrees with lib/accent-text.ts', () => {
  it('declares the pinned lightness and chroma cap for each tone', () => {
    for (const tone of ['dark', 'light'] as const) {
      const { lightness, maxChroma } = ACCENT_TEXT_TONES[tone];
      const declaration = `oklch(from var(--firm-accent, ${DEFAULT_ACCENT}) ${lightness} min(c, ${maxChroma}) h)`;
      expect(
        globalsCss,
        `globals.css is missing the ${tone} derivation: ${declaration}`,
      ).toContain(declaration);
    }
  });

  it('uses the derivation itself as the no-relative-colour fallback', () => {
    for (const tone of ['dark', 'light'] as const) {
      const fallback = deriveAccentText(DEFAULT_ACCENT, tone);
      expect(
        globalsCss,
        `globals.css should fall back to ${fallback} for the ${tone} tone`,
      ).toContain(`--accent-text: ${fallback};`);
    }
  });

  it('guards the relative-colour form behind @supports', () => {
    // Without the guard an unsupported browser resolves --accent-text to
    // the guaranteed-invalid value, which for `color` means inherit, and
    // accent text silently becomes body text.
    expect(globalsCss).toContain(
      '@supports (color: oklch(from red 0.5 min(c, 0.1) h))',
    );
  });
});
