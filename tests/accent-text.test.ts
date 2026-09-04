import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';

import {
  AA_SMALL_TEXT,
  ACCENT_ON_DARK,
  ACCENT_ON_LIGHT,
  ACCENT_ON_SPLIT,
  ACCENT_TEXT_SURFACES,
  ACCENT_TEXT_TONES,
  ACHROMATIC_CHROMA,
  DARK_SURFACE_GROUPS,
  DEFAULT_ACCENT,
  LIGHT_SURFACE_GROUPS,
  PLATFORM_DEFAULT_FIRM_ACCENT,
  PORTAL_ACCENT,
  accentOn,
  portalAccent,
  contrastRatio,
  deriveAccentText,
  relativeLuminance,
  tightestInGroup,
  tightestSurface,
  toOklch,
} from '../lib/accent-text';
import type { AccentTone, DarkSurfaceGroup } from '../lib/accent-text';
import { counselShellClass } from '../lib/counsel-theme-values';
import {
  PILL_COLORS,
  PILL_COLORS_LIGHT,
  PILL_DEFAULT,
  pillInk,
} from '../lib/pill-colors';
import type { PillTone } from '../lib/pill-colors';
// The chip's own style objects, so the assertions below are about the
// paint and not about a helper the component could stop calling.
import { pillStyle, pillSurface } from '../components/counsel/StatusPill';

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
 * The marker class every element that sets an inline `--firm-accent`
 * wears, so the derivation is declared ON that element rather than
 * above it. Named once here because two tests read it and app/globals.css
 * declares it.
 */
const ACCENT_SCOPE = '.accent-scope';

/**
 * The marker as it appears in a call site: the FIRST class in a quoted
 * class list, `"accent-scope min-h-screen ..."`.
 *
 * Deliberately not a bare search for the word. The first version of
 * this guard counted every occurrence in the file, and it passed when
 * the marker was taken off the signer page, because the comment above
 * that className still named it. A guard a comment can satisfy is not a
 * guard. Anchoring on the opening quote also rules out backticked
 * prose, and costs only a convention that all four sites already keep.
 */
const MARKER_IN_CLASS_LIST = /['"]accent-scope\s/g;

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
      for (const tone of ['dark', 'light'] as const) {
        const surface = tightestSurface(tone);
        expect(
          contrastRatio(deriveAccentText(accent, tone), surface),
          `${label} ${tone} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    });
  }
});

/*
 * The gap this closes is not an arithmetic one. The dark tone is
 * declared on `html.dark, .dark, .counsel-shell, .enterprise-shell,
 * .hq-shell`, and for a while the proof set held only the five counsel
 * neutrals while the consumer dark theme repainted the very same
 * utilities green. `.dark .bg-cream-200` is #2a5a47, three times the
 * luminance of the counsel #2c2c31, and the token failed there at
 * 3.78:1 with no firm involved at all.
 *
 * An arithmetic assertion could not have caught that, because the
 * arithmetic was right about the surfaces it was given. So this reads
 * the repaint rules straight out of the stylesheet: every solid
 * background any dark-scoped `bg-*` rule declares has to appear in
 * ACCENT_TEXT_SURFACES.dark, which means adding a new one to
 * app/globals.css without proving the token on it fails here.
 */
/**
 * Every group, either tone. The sweep below reads SELECTORS out of the
 * stylesheet, and a selector does not announce its tone: `.counsel-shell`
 * and `.counsel-shell:not(.dark)` are the same shape and paint opposite
 * grounds. So both maps are searched together for attribution, and each
 * group is then measured against its own surfaces.
 */
const ALL_SURFACE_GROUPS = {
  ...DARK_SURFACE_GROUPS,
  ...LIGHT_SURFACE_GROUPS,
} as const;
type SurfaceGroup = keyof typeof ALL_SURFACE_GROUPS;

describe('the proof set covers every surface each group can land on', () => {
  /**
   * A solid `background-color` declared under a dark scope, split into
   * the scope it hangs off and the rest of the selector, in source
   * order. `.dark .bg-cream-200` is scope `.dark`, key `.bg-cream-200`.
   */
  type BackgroundRule = {
    selector: string;
    scope: string | null;
    key: string;
    hex: string;
    order: number;
  };

  /** Every selector any group claims, so an unclaimed one is visible. */
  const CLAIMED_SCOPES = [
    ...new Set(
      Object.values(ALL_SURFACE_GROUPS).flatMap(
        (g) => g.scopes as readonly string[],
      ),
    ),
  ]
    // Longest first, so `.dark.counsel-shell .card` attributes to the
    // counsel-shell compound and not to a shorter scope that happens to
    // prefix it. `.find` returns the first match, and the compound
    // selectors only arrived with the light theme.
    .sort((a, b) => b.length - a.length);

  /**
   * Anything shaped like a dark shell scope, claimed or not. This is
   * what turns "a new shell was added" from a silent gap into a failure:
   * `.partner-shell .bg-cream-200` matches here, finds no group, and
   * fails the attribution test below. It is deliberately blind to TONE:
   * `.counsel-shell:not(.dark)` has the same shape as `.counsel-shell`
   * and paints the opposite ground, so a light shell cannot slip past it
   * by not looking dark.
   */
  const LOOKS_SHELL_SCOPED = /^(?:html)?\.[\w-]*(?:dark|shell)\b/;

  function shellScopedBackgrounds(): BackgroundRule[] {
    const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: BackgroundRule[] = [];
    let order = 0;
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      order += 1;
      const parts = selectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) continue;
      if (!parts.every((s) => LOOKS_SHELL_SCOPED.test(s))) continue;
      const hex = body.match(/background-color:\s*(#[0-9a-fA-F]{6})\s*;/);
      // Translucent overlays composite onto whatever is behind them and
      // can never be lighter than it, so rgba() rules are not surfaces.
      if (!hex) continue;
      for (const part of parts) {
        const scope =
          CLAIMED_SCOPES.find((s) => part === s || part.startsWith(`${s} `)) ??
          null;
        out.push({
          selector: part,
          scope,
          key: scope ? part.slice(scope.length).trim() : part,
          hex: hex[1].toLowerCase(),
          order,
        });
      }
    }
    return out;
  }

  /**
   * What a group actually paints, cascade and all.
   *
   * The cascade matters and cannot be skipped. Counsel markup is
   * `dark counsel-shell` on ONE element, so `.dark .bg-cream-200`
   * (#2a5a47, green) and `.counsel-shell .bg-cream-200` (#2c2c31) both
   * match the same descendant at the same specificity, and only source
   * order decides. Attributing the green to counsel because `.dark` is
   * in its scope list would be wrong in the direction that matters: it
   * would put the consumer's worst case back under a counsel-scoped
   * token and make the split impossible to state.
   *
   * A shell's own page background is the exception. `.hq-shell` and
   * `html.dark body` paint different ELEMENTS, so they do not override
   * one another and both are surfaces of the group.
   */
  function paintedBy(group: SurfaceGroup): Map<string, BackgroundRule> {
    const scopes = ALL_SURFACE_GROUPS[group].scopes as readonly string[];
    const winners = new Map<string, BackgroundRule>();
    for (const rule of shellScopedBackgrounds()) {
      if (!rule.scope || !scopes.includes(rule.scope)) continue;
      const key = rule.key === '' ? rule.selector : rule.key;
      const held = winners.get(key);
      if (!held || rule.order >= held.order) winners.set(key, rule);
    }
    return winners;
  }

  it('finds the repaint rules at all, so an empty sweep cannot pass', () => {
    // Without this the guards below are vacuously true the moment the
    // regex stops matching the stylesheet.
    const found = shellScopedBackgrounds();
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(new Set(found.map((r) => r.hex)).size).toBeGreaterThanOrEqual(8);
  });

  it('attributes every shell-scoped background to a group that claims it', () => {
    for (const rule of shellScopedBackgrounds()) {
      expect(
        rule.scope,
        `\`${rule.selector}\` paints ${rule.hex} from a selector no group claims; add it to the scopes of a group in DARK_SURFACE_GROUPS or LIGHT_SURFACE_GROUPS`,
      ).not.toBeNull();
    }
  });

  for (const group of Object.keys(ALL_SURFACE_GROUPS) as SurfaceGroup[]) {
    it(`lists every solid background the ${group} group is painted on`, () => {
      const proven = new Set(
        Object.values(ALL_SURFACE_GROUPS[group].surfaces).map((s) =>
          s.toLowerCase(),
        ),
      );
      const painted = paintedBy(group);
      expect(
        painted.size,
        `no repaint rule reaches the ${group} group at all`,
      ).toBeGreaterThan(0);
      for (const rule of painted.values()) {
        expect(
          proven.has(rule.hex),
          `\`${rule.selector}\` paints ${rule.hex} inside the ${group} group, which is not in that group's \`surfaces\``,
        ).toBe(true);
      }
    });
  }

  it('rests each pin where the measurement says it rests', () => {
    // Naming the surfaces here rather than only deriving them, because
    // the whole failure was believing the counsel neutrals were the
    // worst case. If any of these moves, the pins need re-deriving.
    expect(tightestSurface('dark')).toBe('#2a5a47');
    expect(tightestSurface('light')).toBe('#f5edd6');
    expect(tightestInGroup('consumer')).toBe('#2a5a47');
    expect(tightestInGroup('counsel')).toBe('#2c2c31');
  });
});

/*
 * Light counsel is a repaint layer, not a token swap, so most of its
 * text colours never pass through `--accent-text` and nothing above
 * measures them. There are 36 of them and they are the difference
 * between a readable workspace and a white page with white words on it,
 * which is the specific failure this whole theme can produce.
 *
 * So this reads every `color:` the layer declares back out of the
 * stylesheet and measures it on every surface the same layer paints.
 * It is deliberately blind to which rule sits on which surface: a
 * repaint rule cannot know where its call site lands, so each colour
 * has to clear the floor on all of them.
 */
describe('every colour light counsel repaints is legible on every surface it paints', () => {
  const SCOPE = LIGHT_SURFACE_GROUPS.counselLight.scopes[0];
  const surfaces = Object.entries(
    LIGHT_SURFACE_GROUPS.counselLight.surfaces,
  );

  function repaintedTextColours(): { selector: string; hex: string }[] {
    const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: { selector: string; hex: string }[] = [];
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      const parts = selectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) continue;
      if (!parts.every((s) => s.startsWith(`${SCOPE} `) || s === SCOPE)) {
        continue;
      }
      // `color:` only, anchored on a declaration boundary so
      // `border-color` and `background-color` are not swept in.
      const hex = body.match(/(?:^|[;\s])color:\s*(#[0-9a-fA-F]{6})\s*;/);
      if (!hex) continue;
      for (const part of parts) out.push({ selector: part, hex: hex[1] });
    }
    return out;
  }

  const colours = repaintedTextColours();

  it('finds the layer at all, so an empty sweep cannot pass', () => {
    expect(colours.length).toBeGreaterThanOrEqual(30);
    expect(new Set(colours.map((c) => c.hex.toLowerCase())).size).toBeGreaterThanOrEqual(4);
  });

  it(`holds every one of them to ${AA_SMALL_TEXT}:1`, () => {
    for (const { selector, hex } of colours) {
      for (const [name, surface] of surfaces) {
        expect(
          contrastRatio(hex, surface),
          `\`${selector}\` paints ${hex}, which measures ${contrastRatio(hex, surface).toFixed(3)}:1 on the ${name} (${surface})`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    }
  });

  it('keeps the light pin where it was, so the existing proof still holds', () => {
    // Adding light counsel's surfaces to ACCENT_TEXT_SURFACES.light only
    // costs nothing because every one of them is LIGHTER than cream-200.
    // If a future light counsel surface goes darker than that, every
    // light-tone number in this file needs re-deriving, and this is
    // where that shows up.
    expect(tightestSurface('light')).toBe('#f5edd6');
  });
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
    // The perfect neutrals are the easy half: their chroma is exactly
    // zero, so they come out neutral with or without the clamp and
    // prove nothing on their own. The NEAR neutrals are the reason the
    // clamp exists. #84807c is chroma 0.0077 at hue 67.7 and #7f8082 is
    // chroma 0.0032 at hue 264.5: two greys a human would call the same
    // colour, whose hue angles are 197 degrees apart because at that
    // chroma the angle is 8-bit rounding and nothing else. Without the
    // clamp each firm gets its own faintly tinted grey out of that
    // noise.
    const neutrals = ['#000000', '#ffffff', '#808080'];
    const nearNeutrals = ['#807f80', '#828081', '#7f8082', '#84807c', '#a0a2a4'];
    for (const near of nearNeutrals) {
      const c = toOklch(near).c;
      expect(c, `${near} should be a near neutral, not an exact one`).toBeGreaterThan(0);
      expect(c).toBeLessThan(ACHROMATIC_CHROMA);
    }
    for (const tone of ['dark', 'light'] as const) {
      const expected = deriveAccentText('#808080', tone);
      for (const accent of [...neutrals, ...nearNeutrals]) {
        expect(
          deriveAccentText(accent, tone),
          `${accent} (${tone}) should derive to the same neutral as a pure grey`,
        ).toBe(expected);
      }
      expect(toOklch(expected).c).toBeLessThan(0.005);
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

/*
 * The status tokens do not share one selector list any more, and that
 * is what this block had to be rebuilt around.
 *
 * It used to measure each value against tightestSurface(), the single
 * lightest ground in the product, and ban `--danger-text: #f87171` by
 * string. Both were right while one value served every ground. Neither
 * survives the split: the global worst case now fails a value that is
 * correct where it is actually declared, and a string ban says nothing
 * about the selector the string sits on, which is the only thing that
 * decides whether it is readable.
 *
 * So nothing below names a value. It reads every `--warn-text` and
 * `--danger-text` declaration out of app/globals.css, works out which
 * groups each declaration's selectors can reach, and measures it on
 * EVERY surface of every group it reaches. #f87171 arriving on the
 * consumer ground through any selector, including one that does not
 * exist yet, lands back on #2a5a47 at 2.86:1 and fails here.
 *
 * A declaration reaches a group when its selector list names any of
 * that group's scopes, which over-counts on purpose: the shared block's
 * #fecaca is measured against counsel even though the scoped block
 * overrides it there. Over-counting can only add work, never hide a
 * failure, and it means the test needs no opinion about which
 * declaration wins.
 */
describe('the fixed status tokens clear the floor on every surface they reach', () => {
  const STATUS_TOKENS = ['--warn-text', '--danger-text'] as const;

  type Declaration = {
    token: string;
    value: string;
    selectors: string[];
    order: number;
  };

  function statusDeclarations(): Declaration[] {
    const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: Declaration[] = [];
    let order = 0;
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      order += 1;
      const parts = selectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const token of STATUS_TOKENS) {
        // Anchored on a declaration boundary so a `var(--danger-text)`
        // read is not mistaken for a write.
        const pattern = new RegExp(`(?:^|[;\\s])${token}:\\s*([^;]+);`, 'g');
        for (const [, value] of body.matchAll(pattern)) {
          out.push({
            token,
            value: value.trim().toLowerCase(),
            selectors: parts,
            order,
          });
        }
      }
    }
    return out;
  }

  const declarations = statusDeclarations();

  /** The declaration a group ends up with, which is the last one it reaches. */
  function effective(token: string, group: DarkSurfaceGroup): string {
    const scopes = DARK_SURFACE_GROUPS[group].scopes as readonly string[];
    const reaching = declarations
      .filter(
        (d) => d.token === token && d.selectors.some((s) => scopes.includes(s)),
      )
      .sort((a, b) => a.order - b.order);
    return reaching[reaching.length - 1]?.value ?? '';
  }

  it('finds the declarations at all, so an empty sweep cannot pass', () => {
    for (const token of STATUS_TOKENS) {
      expect(
        declarations.filter((d) => d.token === token).length,
        `${token} should be declared for the light tone and for at least one dark group`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('declares every status token as a literal hex, not an indirection', () => {
    // contrastRatio() can only measure a hex. A var() or a colour
    // function here would be measured as the fallback gold, and every
    // number below would be arithmetic about the wrong colour.
    for (const d of declarations) {
      expect(
        d.value,
        `${d.token} on \`${d.selectors.join(', ')}\` is not a plain hex`,
      ).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('declares every status token from a selector some group claims', () => {
    // This is the half that stops a new shell going unmeasured. Adding
    // `.partner-shell` to a token block without registering it in
    // DARK_SURFACE_GROUPS fails here rather than shipping a colour
    // nothing ever measured.
    const claimed = new Set<string>([
      ':root',
      ...Object.values(ALL_SURFACE_GROUPS).flatMap(
        (g) => g.scopes as readonly string[],
      ),
    ]);
    for (const d of declarations) {
      for (const selector of d.selectors) {
        expect(
          claimed.has(selector),
          `\`${selector}\` declares ${d.token} but belongs to no surface group; add it to the scopes of a group in DARK_SURFACE_GROUPS, with the surfaces it paints`,
        ).toBe(true);
      }
    }
  });

  for (const groupName of Object.keys(
    DARK_SURFACE_GROUPS,
  ) as DarkSurfaceGroup[]) {
    const group = DARK_SURFACE_GROUPS[groupName];
    for (const token of STATUS_TOKENS) {
      it(`${token} is >= ${AA_SMALL_TEXT}:1 on every ${groupName} surface`, () => {
        const reaching = declarations.filter(
          (d) =>
            d.token === token &&
            d.selectors.some((s) =>
              (group.scopes as readonly string[]).includes(s),
            ),
        );
        expect(
          reaching.length,
          `no ${token} declaration reaches the ${groupName} group`,
        ).toBeGreaterThan(0);
        for (const d of reaching) {
          for (const [surfaceName, surface] of Object.entries(group.surfaces)) {
            expect(
              contrastRatio(d.value, surface),
              `${token}: ${d.value} from \`${d.selectors.join(', ')}\` measures ${contrastRatio(d.value, surface).toFixed(3)}:1 on the ${groupName} ${surfaceName} (${surface})`,
            ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
          }
        }
      });
    }
  }

  it('holds the light tone to the same floor', () => {
    const rootDeclarations = declarations.filter((d) =>
      d.selectors.includes(':root'),
    );
    expect(rootDeclarations.length).toBeGreaterThanOrEqual(2);
    for (const d of rootDeclarations) {
      for (const [surfaceName, surface] of Object.entries(
        ACCENT_TEXT_SURFACES.light,
      )) {
        expect(
          contrastRatio(d.value, surface),
          `${d.token}: ${d.value} measures ${contrastRatio(d.value, surface).toFixed(3)}:1 on ${surfaceName} (${surface})`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    }
  });

  it('keeps the split, which passing alone does not prove', () => {
    // Everything above still passes if the scoped block is deleted: the
    // pale red clears AA on the counsel neutrals easily. What it does
    // there is read as pink rather than as a warning, which is the
    // complaint this change answers and is not a number. So the split
    // itself is pinned, and undoing it has to be deliberate.
    expect(effective('--danger-text', 'counsel')).toBe('#f87171');
    expect(effective('--danger-text', 'consumer')).toBe('#fecaca');
  });

  it('states the regression this guard exists for, as arithmetic', () => {
    // #f87171 shipped once on the consumer ground and could not be
    // read. It is scoped rather than banned because on the counsel
    // ground the same hex is fine, and the ban would have cost counsel
    // the stronger warning for a surface counsel never paints.
    expect(contrastRatio('#f87171', tightestInGroup('consumer'))).toBeLessThan(
      AA_SMALL_TEXT,
    );
    expect(
      contrastRatio('#f87171', tightestInGroup('counsel')),
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
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

  /*
   * The bug this pins shipped, passed every other test in this file,
   * and was found by rendering the page.
   *
   * `--firm-accent` is an inline style on the SHELL element, never on
   * :root, because it is per firm. A custom property resolves against
   * the element the declaration lands on, so a derivation declared at
   * :root reads a `--firm-accent` that is not set there and quietly
   * falls back to Advottic gold. The dark tone was declared on `.dark`
   * and `.counsel-shell`, which are that element, and was right. The
   * light tone was declared only at :root, so the moment a reader
   * switched to light EVERY firm's accent text became gold. The
   * employee portal made it obvious: teal at hue 186 came back at 87.
   *
   * The arithmetic in this file could not see it, because the
   * arithmetic was right about a colour the browser never computed.
   */
  /** Every selector each tone's derivation is declared on. */
  function derivationSelectors(tone: AccentTone): string[] {
    const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const { lightness, maxChroma } = ACCENT_TEXT_TONES[tone];
    const derivation = `oklch(from var(--firm-accent, ${DEFAULT_ACCENT}) ${lightness} min(c, ${maxChroma}) h)`;
    const out: string[] = [];
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      if (!body.includes(derivation)) continue;
      for (const s of selectors.split(',').map((x) => x.trim())) {
        if (s) out.push(s);
      }
    }
    return out;
  }

  it('computes each tone on an element that carries --firm-accent', () => {
    for (const tone of ['dark', 'light'] as const) {
      const selectors = derivationSelectors(tone);
      expect(
        selectors.length,
        `no block declares the ${tone} derivation at all`,
      ).toBeGreaterThan(0);
      // The marker is what makes the claim general. A shell selector
      // covers counsel and the portal; only the marker reaches an
      // element that sets --firm-accent and is not a shell, which is
      // what the signer page is.
      expect(
        selectors.some((s) => s.split(/\s+/).some((part) => part.includes(ACCENT_SCOPE))),
        `the ${tone} derivation is declared on [${selectors.join(', ')}], none of which is \`${ACCENT_SCOPE}\`; a derivation that does not land on the element carrying --firm-accent resolves against the gold fallback and hands every firm somebody else's brand`,
      ).toBe(true);
      // And it must not be reachable ONLY from the document root, which
      // is exactly the shape the bug had.
      expect(
        selectors.some((s) => s !== ':root' && s !== 'html'),
        `the ${tone} derivation is only declared at the document root`,
      ).toBe(true);
    }
  });

  it('marks every element that sets an inline --firm-accent', () => {
    /*
     * The other half of the same claim, read off the call sites rather
     * than off the stylesheet. A selector that exists proves nothing if
     * the element never wears it, and the signer page is exactly how
     * that goes wrong: it set the accent for a year and matched no
     * derivation at all.
     */
    const root = fileURLToPath(new URL('..', import.meta.url));

    /**
     * The opening JSX tag the given offset sits inside.
     *
     * This used to compare two COUNTS per file: how many elements set the
     * accent, and how many times the marker was named anywhere in the same
     * file. Moving the marker off the accent-setting div in
     * app/portal/layout.tsx and onto its sibling rail kept both counts at one
     * and kept the guard green, while the element carrying --firm-accent no
     * longer wore the marker, which is exactly the gold fallback this exists
     * to prevent. A count is not a binding.
     *
     * Returns null when the tag cannot be located, and the caller treats that
     * as a failure rather than as a pass, so a shape this cannot parse is
     * loud.
     *
     * Comments are removed before any of this runs. They are not decoration
     * here: app/sign/[token]/page.tsx explains the marker in a comment INSIDE
     * the opening tag, and the backticks in that prose left the quote scanner
     * below permanently inside a template literal, so the tag never closed.
     */
    const openingTagAt = (src: string, at: number): string | null => {
      let start = -1;
      for (const m of src.slice(0, at).matchAll(/<[A-Za-z][\w.]*/g)) {
        start = m.index ?? -1;
      }
      if (start === -1) return null;
      let depth = 0;
      let quote = '';
      for (let i = start; i < src.length; i += 1) {
        const c = src[i];
        if (quote) {
          if (c === quote) quote = '';
          continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) {
          return i >= at ? src.slice(start, i + 1) : null;
        }
      }
      return null;
    };

    const sites: { file: string; at: number; marked: boolean }[] = [];
    const walk = (rel: string) => {
      let entries;
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const next = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(e.name)) {
          const src = stripComments(readFileSync(join(root, next), 'utf8'));
          for (const m of src.matchAll(/\[['"]--firm-accent['"] as string\]/g)) {
            const tag = openingTagAt(src, m.index ?? 0);
            sites.push({
              file: next.replace(/^\//, ''),
              at: m.index ?? 0,
              marked: tag != null && MARKER_IN_CLASS_LIST.test(tag),
            });
            MARKER_IN_CLASS_LIST.lastIndex = 0;
          }
        }
      }
    };
    for (const base of ['app', 'components']) walk(base);

    // Sites, not files: app/counsel/layout.tsx carries two of the four.
    expect(
      sites.length,
      `only ${sites.length} inline --firm-accent site(s) found; the sweep has stopped matching and this guard is vacuous`,
    ).toBeGreaterThanOrEqual(4);
    const unmarked = sites.filter((s) => !s.marked).map((s) => `${s.file}@${s.at}`);
    expect(
      unmarked,
      `these elements set --firm-accent without wearing \`${ACCENT_SCOPE.slice(1)}\` on the same tag; a derivation that does not land on the element carrying the accent resolves against the gold fallback and hands every firm somebody else's brand`,
    ).toEqual([]);
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

/*
 * Slice 6: counsel and the employee portal are off the per-class theme
 * override block in app/globals.css.
 *
 * That block reassigns what `text-forest-900`, `text-ink-500`, `bg-white`
 * and thirty-three other Tailwind palette classes MEAN inside `.dark`.
 * Any call site reading one of them is pinned to it, which is why counsel
 * could not have a light mode: the shell is `dark counsel-shell`, so those
 * rules always win and a theme toggle would change nothing.
 *
 * 1043 call sites across 99 files moved onto the tokens. This pins that,
 * because the failure mode is silent: one reintroduced `text-ink-500` on
 * a counsel page still looks right today (the block paints it cream) and
 * only turns invisible on the day the block is deleted.
 *
 * The two allowed exceptions are call sites whose dark half is a status
 * colour, not neutral text, so a neutral token would have flattened them.
 */
describe('counsel and portal do not read colour from the override block', () => {
  const OVERRIDDEN = `text-forest-900 text-forest-800 text-forest-700 text-ink-950 text-ink-900
text-ink-800 text-ink-700 text-ink-600 text-ink-500 text-ink-400 hover:text-forest-900
hover:text-forest-700 hover:text-ink-900 hover:text-ink-700 bg-white bg-cream-50 bg-cream-50/40
bg-cream-50/50 bg-cream-100 bg-cream-200 bg-ink-50 bg-ink-50/40 bg-ink-50/50 bg-forest-50
bg-forest-100 bg-ink-100 hover:bg-white hover:bg-cream-50 hover:bg-cream-100 hover:bg-forest-50
hover:bg-ink-50 hover:bg-ink-100 border-ink-100 border-ink-200 border-forest-200 ring-ink-200`
    .split(/\s+/)
    .filter(Boolean);

  /**
   * Left on the palette on purpose. Keyed by file AND class, so an
   * exemption cannot quietly cover the next call site added to the same
   * file.
   */
  const ALLOWED = new Map([
    [
      'app/portal/check/policy-check-client.tsx|text-forest-700',
      'the policy score is a three-way status colour and only its green arm is a forest class',
    ],
    [
      'app/counsel/settings/partner-integration-manager.tsx|text-forest-700',
      'the "Saved." confirmation is a success colour, paired with dark:text-emerald-300',
    ],
  ]);

  /** Rebuilt on another branch; not this slice's to hold. */
  const NOT_OURS = [
    'app/counsel/cases/',
    'app/counsel/forms/',
    'components/counsel/ui.tsx',
  ];

  function sweptFiles(): string[] {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const out: string[] = [];
    const walk = (rel: string) => {
      let entries;
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const next = `${rel}/${e.name}`;
        if (NOT_OURS.some((p) => next.startsWith(p))) continue;
        if (e.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(e.name)) out.push(next);
      }
    };
    for (const base of ['app/counsel', 'app/portal', 'components/counsel']) {
      walk(base);
    }
    return out;
  }

  const bare = [...new Set(OVERRIDDEN.map((c) => c.split(':').pop() as string))]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const pattern = new RegExp(
    `(?<![\\w:/-])((?:[a-z-]+:)*)(${bare.join('|')})(?![\\w/-])`,
    'g',
  );
  const overridden = new Set(OVERRIDDEN);

  /**
   * COMMENTS STRIPPED BEFORE MATCHING.
   *
   * A CALL SITE is a class in the class list. A class NAMED IN A COMMENT is
   * the opposite: it is almost always a note explaining why that class was not
   * used, which is exactly the reasoning this guard wants written down. Read
   * raw, the guard punished the explanation and pushed authors towards
   * deleting it, which is how the next person repeats the mistake.
   *
   * It cannot hide a real offender. A class that paints something is in a JSX
   * className, and stripComments only removes comments; the danger it
   * documents runs the other way, and its own header explains the one shape it
   * would eat.
   */
  const swept = (rel: string) =>
    stripComments(
      readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8'),
    );

  it('leaves no palette call site behind except the two documented ones', () => {
    const offenders: string[] = [];
    for (const rel of sweptFiles()) {
      const src = swept(rel);
      for (const m of src.matchAll(pattern)) {
        const cls = m[1] + m[2];
        if (!overridden.has(cls)) continue;
        if (ALLOWED.has(`${rel}|${cls}`)) continue;
        offenders.push(`${rel}: ${cls}`);
      }
    }
    expect(
      offenders,
      'these read their colour from the .dark palette overrides in app/globals.css; use a token (text-foreground, text-muted, bg-surface, bg-surface-2, border-edge, ring-edge) instead',
    ).toEqual([]);
  });

  it('the exemption list stays honest', () => {
    // An exemption that no longer has a call site is an exemption that
    // will silently cover the next one added to that file.
    for (const [key, why] of ALLOWED) {
      const [rel, cls] = key.split('|');
      // The same stripped read as the sweep above. An exemption is only
      // earned by a real call site, and measuring it against a different
      // string from the one the sweep measures is how an exemption outlives
      // the code it was granted for.
      const src = swept(rel);
      const hits = [...src.matchAll(pattern)].filter(
        (m) => m[1] + m[2] === cls,
      );
      expect(hits.length, `${rel} no longer needs its ${cls} exemption: ${why}`)
        .toBeGreaterThan(0);
    }
  });
});

/*
 * The employee portal's own accent.
 *
 * The portal is a second audience on the same shell, and it paints with
 * PORTAL_ACCENT rather than with the firm's platform-default forest. A
 * second accent is a second chance to ship an unreadable one, so it is
 * held to exactly the floor every customer-chosen hex is held to, on
 * every surface either tone can land on, rather than to a glance at a
 * screenshot.
 *
 * The last test is the registration this file exists for. The portal
 * does NOT get a shell selector of its own: it renders inside the same
 * `.counsel-shell` neutrals that are already proved above, and that is
 * the whole reason no new surface had to be added. If someone later
 * gives it `.portal-shell`, this fails until that selector is added to
 * a surface group with the backgrounds it paints, which is the same
 * gate `attributes every shell-scoped background to a group that claims
 * it` applies to the stylesheet.
 */
describe('the employee portal accent is measured, not assumed', () => {
  it('is a plain six-digit hex', () => {
    expect(PORTAL_ACCENT).toMatch(/^#[0-9a-f]{6}$/);
    expect(PLATFORM_DEFAULT_FIRM_ACCENT).toMatch(/^#[0-9a-f]{6}$/);
  });

  for (const tone of ['dark', 'light'] as const) {
    for (const [surfaceName, surface] of Object.entries(
      ACCENT_TEXT_SURFACES[tone],
    )) {
      it(`${tone}: portal accent text is >= ${AA_SMALL_TEXT}:1 on ${surfaceName}`, () => {
        const token = deriveAccentText(PORTAL_ACCENT, tone);
        expect(
          contrastRatio(token, surface),
          `${PORTAL_ACCENT} -> ${token} on ${surface} measured ${contrastRatio(token, surface).toFixed(3)}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }
  }

  it('is legible as a FILL, which is the other half of an accent', () => {
    // Buttons, the avatar chip and the tile icon squares paint the raw
    // hex and put accentOn() on top of it. A hue that passes as text
    // and fails as a fill is still a broken accent.
    expect(
      contrastRatio(accentOn(PORTAL_ACCENT), PORTAL_ACCENT),
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('reads as a different room from counsel, in hue and not in adjective', () => {
    // The claim the second accent is FOR. Counsel gold is hue 87.4 and
    // the portal teal is 186.4. Anything under this and the two
    // workspaces stop being distinguishable at a glance, which is the
    // only thing a separate accent buys.
    const gold = toOklch(DEFAULT_ACCENT).h;
    const portal = toOklch(PORTAL_ACCENT).h;
    const apart = Math.abs(((portal - gold + 540) % 360) - 180);
    expect(apart, `gold ${gold.toFixed(1)}, portal ${portal.toFixed(1)}`)
      .toBeGreaterThan(60);
    for (const tone of ['dark', 'light'] as const) {
      expect(deriveAccentText(PORTAL_ACCENT, tone)).not.toBe(
        deriveAccentText(DEFAULT_ACCENT, tone),
      );
    }
  });

  it('yields to a firm that chose its own accent, and only then', () => {
    // A white-label firm's staff are looking at their own employer's
    // workspace. The portal accent is the default for a firm that never
    // picked one, not an override of one that did.
    expect(portalAccent('#e11d48')).toBe('#e11d48');
    expect(portalAccent(PLATFORM_DEFAULT_FIRM_ACCENT)).toBe(PORTAL_ACCENT);
    expect(portalAccent(PLATFORM_DEFAULT_FIRM_ACCENT.toUpperCase())).toBe(
      PORTAL_ACCENT,
    );
    // Unparseable or absent falls to the portal accent rather than to
    // whatever `oklch(from <garbage> ...)` would inherit.
    expect(portalAccent(null)).toBe(PORTAL_ACCENT);
    expect(portalAccent('')).toBe(PORTAL_ACCENT);
    expect(portalAccent('rebeccapurple')).toBe(PORTAL_ACCENT);
  });

  it('renders on a shell every surface group already claims', () => {
    const claimed = new Set(
      Object.values({
        ...DARK_SURFACE_GROUPS,
        ...LIGHT_SURFACE_GROUPS,
      }).flatMap((g) => g.scopes as readonly string[]),
    );
    for (const theme of ['dark', 'light'] as const) {
      for (const token of counselShellClass(theme, '').trim().split(/\s+/)) {
        if (!token) continue;
        expect(
          [...claimed].some((s) => s.split(/[.:]+/).includes(token)),
          `the portal shell carries \`${token}\`, which no surface group claims; register it in DARK_SURFACE_GROUPS or LIGHT_SURFACE_GROUPS with the backgrounds it paints`,
        ).toBe(true);
      }
    }
  });
});

/*
 * The status chips, on BOTH grounds.
 *
 * lib/pill-colors.ts carried its own measurements in a comment, and
 * those measurements were right when they were written: the only
 * grounds a chip could land on in early 2026 were the counsel page and
 * the counsel card, both near-black. Light counsel shipped afterwards,
 * the palette was never re-measured, and every one of the seven chips
 * went under the floor on the new ground at once. `flagged` is the
 * loudest at 2.20:1 but `waiting` is the worst at 1.38:1.
 *
 * Nothing here re-derives the palette. It measures the chip the way
 * StatusPill paints it and holds both halves to the same floor, so the
 * next ground that arrives cannot be added without a number.
 */
describe('the status palette clears the floor on both grounds', () => {
  /**
   * The alpha StatusPill's `pillStyle` puts behind the label, as a
   * fraction. The style object writes it as the two hex digits `1a`,
   * which is 26/255.
   */
  const CHIP_FILL_ALPHA = 26 / 255;

  function channels(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * The chip's fill: the label's own colour at CHIP_FILL_ALPHA over
   * whatever surface the chip sits on.
   *
   * Measuring the label against the BARE surface is the mistake this
   * helper exists to avoid. The fill is always a step from the surface
   * towards the label, so the bare-surface number is optimistic by
   * about half a point and would pass colours the eye cannot read.
   */
  function chipFill(hex: string, surface: string): string {
    const label = channels(hex);
    const ground = channels(surface);
    return (
      '#' +
      label
        .map((v, i) =>
          Math.round(v * CHIP_FILL_ALPHA + ground[i] * (1 - CHIP_FILL_ALPHA))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }

  const chipRatio = (hex: string, surface: string) =>
    contrastRatio(hex, chipFill(hex, surface));

  /**
   * The dark grounds the palette actually claims.
   *
   * Not every counsel surface: the palette clears AA on the three
   * darkest and stops there. `quiet` measures 4.46:1 on
   * `.bg-cream-50` (#1a1a1e) and 3.56:1 on `.bg-cream-200`, so listing
   * those would fail on a DARK value this change is not touching.
   * `.bg-cream-200` has a single counsel call site and it is a button
   * hover, not a chip ground; the lighter counsel utilities are
   * recorded as a separate, pre-existing gap rather than silently
   * folded into a light-mode fix. Pulled by key out of the group the
   * suite already proves against app/globals.css, so a repaint of any
   * of the three moves this measurement too.
   */
  const DARK_GROUND_KEYS = [
    'counsel page',
    'counsel .bg-ink-50',
    'counsel card',
  ] as const;

  const DARK_GROUNDS = Object.fromEntries(
    DARK_GROUND_KEYS.map((key) => [
      key,
      DARK_SURFACE_GROUPS.counsel.surfaces[key],
    ]),
  ) as Record<(typeof DARK_GROUND_KEYS)[number], string>;

  /** Every solid surface light counsel paints, as registered for the tone. */
  const LIGHT_GROUNDS = LIGHT_SURFACE_GROUPS.counselLight.surfaces;

  const tones = Object.keys(PILL_COLORS) as PillTone[];

  it('finds the palette at all, so an empty sweep cannot pass', () => {
    expect(tones.length).toBeGreaterThanOrEqual(7);
    expect(Object.values(DARK_GROUNDS).every(Boolean)).toBe(true);
    expect(Object.keys(LIGHT_GROUNDS).length).toBeGreaterThanOrEqual(3);
  });

  it('gives every dark value a light twin, and a different one', () => {
    // A light map that is a copy of the dark map passes nothing below
    // by accident: it fails the light measurements outright. This is
    // here for the opposite case, a tone added to one map only.
    for (const tone of tones) {
      expect(
        PILL_COLORS_LIGHT[tone],
        `${tone} has no light twin`,
      ).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(
        PILL_COLORS_LIGHT[tone].toLowerCase(),
        `${tone} uses its dark hex on the light ground`,
      ).not.toBe(PILL_COLORS[tone].toLowerCase());
    }
  });

  for (const tone of tones) {
    it(`${tone} is >= ${AA_SMALL_TEXT}:1 on every dark ground`, () => {
      for (const [name, surface] of Object.entries(DARK_GROUNDS)) {
        expect(
          chipRatio(PILL_COLORS[tone], surface),
          `${tone} ${PILL_COLORS[tone]} measures ${chipRatio(PILL_COLORS[tone], surface).toFixed(3)}:1 on the ${name} (${surface})`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    });

    it(`${tone} is >= ${AA_SMALL_TEXT}:1 on every light ground`, () => {
      for (const [name, surface] of Object.entries(LIGHT_GROUNDS)) {
        expect(
          chipRatio(PILL_COLORS_LIGHT[tone], surface),
          `${tone} ${PILL_COLORS_LIGHT[tone]} measures ${chipRatio(PILL_COLORS_LIGHT[tone], surface).toFixed(3)}:1 on the ${name} (${surface})`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    });
  }

  it('states the regression this guard exists for, as arithmetic', () => {
    // The shipped palette on the ground it was never measured on. Every
    // one of the seven, not just the red one that was reported.
    const tightestLight = '#eeeef1';
    for (const tone of tones) {
      expect(
        chipRatio(PILL_COLORS[tone], tightestLight),
        `${tone} would still be legible on light counsel, so the twin is unnecessary`,
      ).toBeLessThan(AA_SMALL_TEXT);
    }
  });

  it('keeps the two greys apart, and the two yellows', () => {
    // Both pairs are deliberate and neither is visible in a contrast
    // number: `neutral` and `quiet` share a hue and differ only in
    // lightness, `gold` and `waiting` share a hue and differ only in
    // chroma. A future edit that clears AA by flattening either pair
    // has broken the palette without failing anything above.
    //
    // The greys INVERT between grounds: on dark `neutral` is the
    // brighter of the two, on light it is the darker, because on a
    // light ground prominence reads as depth.
    expect(relativeLuminance(PILL_COLORS.neutral)).toBeGreaterThan(
      relativeLuminance(PILL_COLORS.quiet),
    );
    expect(relativeLuminance(PILL_COLORS_LIGHT.neutral)).toBeLessThan(
      relativeLuminance(PILL_COLORS_LIGHT.quiet),
    );
    expect(
      contrastRatio(PILL_COLORS_LIGHT.neutral, PILL_COLORS_LIGHT.quiet),
      'the light greys have collapsed into one grey',
    ).toBeGreaterThanOrEqual(1.2);
    expect(
      toOklch(PILL_COLORS_LIGHT.waiting).c -
        toOklch(PILL_COLORS_LIGHT.gold).c,
      'light gold is no longer the muted one of the two yellows',
    ).toBeGreaterThan(0.03);
  });

  it('proves no single hex could have served both grounds', () => {
    // The reason this file now carries two maps rather than one
    // corrected one. Clearing AA on the darkest ground bounds the
    // label's luminance from BELOW and clearing it on the lightest
    // ground bounds the same quantity from ABOVE, and the two bounds
    // do not overlap for any colour of any hue. Swept over the greys
    // because a grey is the best case: at a given luminance nothing
    // else has a better ratio against a neutral ground.
    const darkest = DARK_GROUNDS['counsel page'];
    const lightest = '#eeeef1';
    for (let v = 0; v <= 255; v++) {
      const grey = '#' + v.toString(16).padStart(2, '0').repeat(3);
      const bothPass =
        chipRatio(grey, darkest) >= AA_SMALL_TEXT &&
        chipRatio(grey, lightest) >= AA_SMALL_TEXT;
      expect(bothPass, `${grey} clears the floor on both grounds`).toBe(false);
    }
  });

  it('resolves each palette colour to a value that follows the shell', () => {
    for (const tone of tones) {
      expect(pillInk(PILL_COLORS[tone])).toBe(
        `light-dark(${PILL_COLORS_LIGHT[tone]}, ${PILL_COLORS[tone]})`,
      );
      // The chip's fill and edge are the same colour at an alpha, and
      // the alpha has to reach BOTH halves or one theme loses its tint.
      expect(pillInk(PILL_COLORS[tone], '1a')).toBe(
        `light-dark(${PILL_COLORS_LIGHT[tone]}1a, ${PILL_COLORS[tone]}1a)`,
      );
    }
    // The default a caller gets for a state with no colour of its own.
    expect(pillInk(PILL_DEFAULT)).toContain('light-dark(');
    // An unrecognised colour is passed through rather than dropped, so
    // a call site that invents a hex still renders something.
    expect(pillInk('#123456', '40')).toBe('#12345640');
  });

  it('paints every layer of the chip through that resolver', () => {
    // The arithmetic above is about two maps. This is about the paint.
    // A chip whose style object still writes the bare dark hex is one
    // where the light map is measured, proved and never rendered, and
    // every number above would be about a colour nobody sees. Both
    // helpers are asserted because they are separate call sites:
    // pillStyle is the chip, pillSurface is the filter and status
    // controls that take the state's fill without its foreground.
    for (const tone of tones) {
      const dark = PILL_COLORS[tone];
      const light = PILL_COLORS_LIGHT[tone];
      expect(pillStyle(dark)).toEqual({
        color: `light-dark(${light}, ${dark})`,
        background: `light-dark(${light}1a, ${dark}1a)`,
        border: `1px solid light-dark(${light}40, ${dark}40)`,
      });
      expect(pillSurface(dark)).toEqual({
        background: `light-dark(${light}1a, ${dark}1a)`,
        boxShadow: `0 0 0 1px light-dark(${light}40, ${dark}40)`,
      });
    }
  });
});

/*
 * The signer page, registered.
 *
 * app/sign/[token]/page.tsx is the one surface outside the workspace
 * that is deliberately painted in a firm's own colour: clients and
 * opposing counterparties open it, and the firm's mark, its accent fill
 * and its accent text are the whole point. It is also the page where
 * showing the WRONG firm's brand reads worst, and it did, in both
 * tones, because its wrapper is a plain gradient and matched no
 * derivation at all.
 *
 * Fixing the cascade is not the same as proving the colour. This names
 * the grounds that page actually paints and measures every accent a
 * customer can pick on each of them, so the surface is in the guard by
 * name rather than by assumption.
 *
 * The dark grounds are not re-derived here: the signer inherits its
 * dark theme from `html.dark`, which is the consumer repaint family, so
 * each one is asserted to BE a member of that group rather than being
 * a second hand-kept copy of it. If the consumer group moves, this
 * fails rather than drifting.
 */
describe('the signer page is a registered surface, not an assumed one', () => {
  /** What app/sign/[token]/page.tsx paints, read off its own classes. */
  const SIGNER_SURFACES = {
    light: {
      // `bg-gradient-to-b from-cream-50 to-white`, the header's
      // `bg-white/95`, the footer's `bg-white`, and `.card`.
      'signer gradient head (cream-50)': '#fefcf3',
      'signer gradient foot, header, footer, card (white)': '#ffffff',
    },
    dark: {
      // `html.dark` repaints the same utilities into the consumer
      // family, and `bg-forest-950` is the page itself.
      'signer dark page (bg-forest-950)': '#0a1f19',
      'signer dark .bg-cream-50': '#173b30',
      'signer dark .bg-white': '#1a3d31',
    },
  } as const;

  it('paints only grounds the dark consumer group already proves', () => {
    const consumer = new Set(
      Object.values(DARK_SURFACE_GROUPS.consumer.surfaces).map((s) =>
        s.toLowerCase(),
      ),
    );
    for (const [name, hex] of Object.entries(SIGNER_SURFACES.dark)) {
      expect(
        consumer.has(hex),
        `the signer's ${name} (${hex}) is not one of the consumer dark group's surfaces; the signer inherits its dark theme from html.dark, so if it paints something that group does not, the group is what needs updating`,
      ).toBe(true);
    }
  });

  it('paints only light grounds the light tone already proves', () => {
    const light = new Set(
      Object.values(ACCENT_TEXT_SURFACES.light).map((s) => s.toLowerCase()),
    );
    for (const [name, hex] of Object.entries(SIGNER_SURFACES.light)) {
      expect(
        light.has(hex),
        `the signer's ${name} (${hex}) is not in ACCENT_TEXT_SURFACES.light`,
      ).toBe(true);
    }
  });

  for (const tone of ['dark', 'light'] as const) {
    for (const [name, surface] of Object.entries(SIGNER_SURFACES[tone])) {
      it(`${tone}: any firm accent is >= ${AA_SMALL_TEXT}:1 on the ${name}`, () => {
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

  it('puts a readable foreground on the firm mark, which is a fill', () => {
    // The header mark and the signing button paint the raw accent with
    // accentOn() on top. That is a different claim from the text one and
    // is the half a lightness pin cannot make.
    let worst = { ratio: Infinity, accent: '' };
    for (const accent of ACCENTS) {
      const ratio = contrastRatio(accentOn(accent), accent);
      if (ratio < worst.ratio) worst = { ratio, accent };
    }
    expect(worst.ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });
});

/*
 * The Advottic Review grade badge.
 *
 * A different defect from the chips and an older one: the badge is a
 * SOLID fill with a hard-coded foreground, so it never depended on the
 * theme and it failed on both. `bg-emerald-500` with `text-white` is
 * 2.54:1, and the B and D rows of the same five-row map were 3.77:1
 * and 3.67:1. app/globals.css says of the light counsel layer that
 * `text-white` is left alone because "white is correct in both themes"
 * on the saturated fills it sits on. That was true of the fills it was
 * checked against and not of these.
 *
 * The grade map is written out twice, identically, so this reads both
 * files rather than trusting that they still agree. A third copy lived in
 * the counsel request inbox until that list became a table; the table has no
 * grade badge (four coloured marks on a row across twenty-five rows is the
 * siren docs/DESIGN.md warns about), and it is swept here for the priority
 * chip, which is a solid fill with a hardcoded foreground of exactly the same
 * shape.
 */
describe('every solid badge pairs a fill with a foreground that can be read on it', () => {
  const FILES = [
    'app/counsel/intake/create-intake-form.tsx',
    'components/ReviewScorecard.tsx',
    'app/counsel/inbox/requests-table.tsx',
  ];

  /**
   * The Tailwind classes these badges use, resolved to the paint.
   *
   * `text-forest-950` is the one that is not a literal in
   * tailwind.config.ts: the forest ramp is a CSS variable the shells
   * remap, so the class resolves to #0a1f19 on the consumer root,
   * #0a0a0b inside a dark counsel shell, and #17171b under the light
   * counsel repaint. The lightest of the three is pinned here, which
   * is the worst case for a foreground on a bright fill.
   */
  const PAINT: Record<string, string> = {
    'bg-emerald-400': '#34d399',
    'bg-emerald-500': '#10b981',
    'bg-emerald-600': '#059669',
    'bg-amber-500': '#f59e0b',
    'bg-rose-500': '#f43f5e',
    'bg-rose-600': '#e11d48',
    'bg-rose-700': '#be123c',
    'bg-ink-400': '#a1a1aa',
    'bg-ink-500': '#71717a',
    'text-white': '#ffffff',
    'text-forest-950': '#17171b',
  };

  /**
   * A background class immediately followed by a foreground class, which
   * is how every one of these badges is written. The lookbehind keeps
   * variant-prefixed spellings out: `hover:bg-gold-300 text-forest-950`
   * is a hover fill paired with the base foreground and pairing them
   * would measure a state that never co-occurs.
   */
  const PAIR = /(?<![\w:-])(bg-[a-z]+-\d+) (text-(?:white|[a-z]+-\d+))(?![\w-])/g;

  function pairsIn(rel: string): { fill: string; fg: string }[] {
    const src = readFileSync(
      fileURLToPath(new URL(`../${rel}`, import.meta.url)),
      'utf8',
    );
    // Comments are not paint. Each of these maps now carries a note
    // naming the pair it replaced, and without this the sweep measures
    // the note and fails on a spelling that no longer renders anywhere.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    return [...code.matchAll(PAIR)].map((m) => ({ fill: m[1], fg: m[2] }));
  }

  const found = FILES.flatMap((rel) =>
    pairsIn(rel).map((p) => ({ ...p, rel })),
  );

  it('finds the badges at all, so an empty sweep cannot pass', () => {
    // Five grades plus a fallback badge in each of the two grade files,
    // plus the two filled priority chips on the request queue. The other
    // two priorities are outlined rather than filled, so they have no pair
    // to measure and are deliberately not counted here.
    expect(found.length).toBeGreaterThanOrEqual(14);
  });

  it('knows the paint behind every class it swept', () => {
    // A class with no entry would otherwise be skipped, which is the
    // shape of a guard that stops seeing the thing it guards.
    for (const { rel, fill, fg } of found) {
      expect(PAINT[fill], `${rel} uses ${fill}, which has no pinned hex`).toBeDefined();
      expect(PAINT[fg], `${rel} uses ${fg}, which has no pinned hex`).toBeDefined();
    }
  });

  it(`holds every pair to ${AA_SMALL_TEXT}:1`, () => {
    for (const { rel, fill, fg } of found) {
      const ratio = contrastRatio(PAINT[fill], PAINT[fg]);
      expect(
        ratio,
        `${rel}: \`${fill} ${fg}\` measures ${ratio.toFixed(3)}:1`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it('states the regression this guard exists for, as arithmetic', () => {
    expect(contrastRatio('#10b981', '#ffffff')).toBeLessThan(AA_SMALL_TEXT);
    expect(contrastRatio('#059669', '#ffffff')).toBeLessThan(AA_SMALL_TEXT);
    expect(contrastRatio('#f43f5e', '#ffffff')).toBeLessThan(AA_SMALL_TEXT);
  });
});

/*
 * Error and warning banners, on the ground the reader is actually on.
 *
 * THE DEFECT
 * ----------
 * Twenty-one of them were painted for the dark shell only, and light
 * counsel is now live. `text-amber-200` on `bg-amber-500/10` over a
 * white counsel card measures 1.01:1, which is not low contrast, it is
 * invisible; `text-rose-100` on `bg-rose-500/20` is 1.08:1 and
 * `text-rose-200` on `bg-rose-950/30` is 1.39:1. A user whose action
 * failed and who cannot see why has no way forward, which is what makes
 * this the worst class of contrast bug rather than a cosmetic one.
 *
 * WHAT REPLACES THEM
 * ------------------
 * `--danger-text` and `--warn-text`, which already exist, are already
 * declared per ground, and are already held to the floor on the bare
 * surfaces by the block above. Nothing new is invented here: the call
 * sites stop naming a palette step and name the semantic token, and the
 * token does the per-ground work it was built for.
 *
 * MEASURED THE WAY THE PRODUCT PAINTS
 * -----------------------------------
 * A tinted banner is not text on the surface. It is text on its own
 * fill, and the fill is a step from the surface TOWARDS the tint, so
 * the bare-surface number is optimistic. Every pair below is measured
 * as label against `fill over surface`, on every solid surface the
 * file's ground family paints, on BOTH tones.
 *
 * WHICH FAMILY A FILE IS IN is not a judgement call: it is which shell
 * renders it. `/counsel` and `/portal` render inside `.counsel-shell`,
 * which has two themes; everything else in the consumer app resolves
 * `:root` light or the `.dark` green repaint.
 *
 * WHAT IS DELIBERATELY OUT
 * ------------------------
 * A surface that paints its own opaque ground in both themes has one
 * ground, not two, and measuring it against a shell it never sits on
 * would fail a colour that is correct. Each is named in SELF_GROUNDED
 * with the ground it carries, so the exemption is a statement that can
 * be checked rather than a silence.
 */
describe('every error and warning surface can be read on both of its grounds', () => {
  /** The file, and which shell family decides its two grounds. */
  const SURFACE_FILES: Record<string, 'counsel' | 'consumer'> = {
    'app/counsel/cases/[id]/approach-builder.tsx': 'counsel',
    'app/counsel/cases/[id]/case-file-panel.tsx': 'counsel',
    'app/counsel/cases/[id]/evidence/evidence-intake.tsx': 'counsel',
    'app/counsel/cases/[id]/evidence/evidence-viewer.tsx': 'counsel',
    'app/counsel/request/request-form.tsx': 'counsel',
    'app/portal/profile/profile-form.tsx': 'counsel',
    'app/portal/trainings/complete-button.tsx': 'counsel',
    'app/portal/trainings/page.tsx': 'counsel',
    'components/counsel/AskAdvottic.tsx': 'counsel',
    // The dashboard metric board paints --warn-text and --danger-text as
    // the figure and its state word, on the bare card surface.
    'components/counsel/CounselDashboardTiles.tsx': 'counsel',
    'components/counsel/DashboardCustomizer.tsx': 'counsel',
    'components/counsel/GuestPasswordForm.tsx': 'counsel',
    'components/counsel/import/ImportPanels.tsx': 'counsel',
    // The inbound authorisation panel. It paints --warn-text as the failure
    // message under its note field, on the bare counsel card the panel is.
    'components/counsel/InboundAuthorization.tsx': 'counsel',
    // Already painting from the tokens before this change. Registered
    // so the same proof covers them: the sweep below fails if a file
    // uses a semantic status token and no group claims it, which is
    // what stops the next banner being added outside the measurement.
    'app/counsel/cases/[id]/page.tsx': 'counsel',
    'app/counsel/contracts/page.tsx': 'counsel',
    'app/counsel/documents/[id]/page.tsx': 'counsel',
    'app/counsel/documents/page.tsx': 'counsel',
    'app/counsel/forms/forms-manage-client.tsx': 'counsel',
    // The request detail and the controls in its action bar. The
    // breached-deadline reading and the controls' failure messages moved
    // off the rose palette onto --danger-text when the bar was gathered,
    // so they are measured on the counsel card the bar paints on.
    // convert-to-matter.tsx was here until the take-it-on-as-a-matter path
    // was deliberately removed; see tests/ticket-not-a-matter.test.ts.
    'app/counsel/intake/[id]/page.tsx': 'counsel',
    'app/counsel/intake/[id]/analyze-attachments.tsx': 'counsel',
    'app/counsel/intake/[id]/intake-owner-select.tsx': 'counsel',
    'app/counsel/intake/[id]/ticket-management.tsx': 'counsel',
    // The legal team's administrative block in the ticket rail. Paints
    // --danger-text as its failure message, on the counsel card it is.
    'app/counsel/intake/[id]/administrative-tools.tsx': 'counsel',
    'app/counsel/letters/letters-studio.tsx': 'counsel',
    'app/counsel/policies/policies-manage-client.tsx': 'counsel',
    'app/counsel/signing/[id]/page.tsx': 'counsel',
    'app/counsel/templates/template-studio.tsx': 'counsel',
    'app/portal/layout.tsx': 'counsel',
    'components/portal/RequestHeader.tsx': 'counsel',
    'app/cases/[id]/activity-list.tsx': 'consumer',
    'app/cases/[id]/page.tsx': 'consumer',
    // Both moved onto a status token when the consumer light surface was
    // swept: the admin-preview banner's two quiet amber tiers were 2.95:1
    // and 3.54:1 on their own amber-50 fill, and the Safe Witness badge's
    // rose-600 was 3.85:1 on its rose tint. Consumer family, not HQ - these
    // render on the case timeline and the profile page, which have two
    // themes, unlike anything under app/admin.
    'app/cases/[id]/timeline/admin-preview-toggle.tsx': 'consumer',
    'app/profile/page.tsx': 'consumer',
    'app/cases/page.tsx': 'consumer',
    'app/changelog/page.tsx': 'consumer',
    'app/example/page.tsx': 'consumer',
    'app/guest-login/guest-login-form.tsx': 'consumer',
    'app/join/join-form.tsx': 'consumer',
    'components/Sidebar.tsx': 'consumer',
  };

  /**
   * Surfaces that carry their own opaque ground in BOTH themes, and the
   * ground each one carries. A dark-only foreground is correct on these
   * and rewriting it to a per-ground token would put dark red on a dark
   * red overlay.
   */
  const SELF_GROUNDED: Record<string, string> = {
    'app/admin': 'the HQ shell renders `dark hq-shell`, one theme',
    'app/enterprise/page.tsx': '`.enterprise-shell`, one theme',
    'components/EnterpriseInquiryForm.tsx':
      'rendered only inside app/enterprise/page.tsx',
    'components/DistressOverlay.tsx':
      'a full-screen `bg-rose-950/80` crisis overlay it paints itself',
    'components/SafeWitness.tsx':
      'a full-screen forest gradient it paints itself; gradient stops are not repainted per theme',
    'app/page.tsx': 'the marketing tile sits on the forest hero gradient',
  };

  /** The palette steps these banners fill with, resolved to their hex. */
  const FILL_PAINT: Record<string, string> = {
    'rose-400': '#fb7185',
    'rose-500': '#f43f5e',
    'rose-950': '#4c0519',
    'red-500': '#ef4444',
    'amber-400': '#fbbf24',
    'amber-500': '#f59e0b',
    'yellow-500': '#eab308',
  };

  /**
   * The two grounds each family paints, and the token value each one
   * resolves. The hexes are read back out of app/globals.css rather
   * than repeated here, so a token retuned in the stylesheet is
   * measured at its new value instead of at a stale copy.
   *
   * `.bg-cream-200` is left out of both dark sets, and this is the one
   * exclusion. It is the lightest solid either dark theme paints, and
   * `--warn-text` clears the floor on it BARE (4.74:1) but not under a
   * 10 percent amber tint (4.21:1). No file in SURFACE_FILES paints a
   * `bg-cream-200` container, which the sweep below asserts rather than
   * assumes, so no registered banner can land there. Retuning a shared
   * status token to buy that surface is a different change from this
   * one, and app/globals.css already records why the paler amber was
   * rejected.
   */
  function tokenValue(token: string, scopes: readonly string[]): string {
    const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    let value = '';
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    )) {
      const parts = selectors.split(',').map((s) => s.trim());
      if (!parts.some((s) => scopes.includes(s))) continue;
      const m = new RegExp(`(?:^|[;\\s])${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(
        body,
      );
      if (m) value = m[1].toLowerCase();
    }
    return value;
  }

  const withoutCream200 = (surfaces: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(surfaces).filter(([name]) => !name.endsWith('cream-200')),
    );

  const FAMILIES = {
    counsel: [
      {
        tone: 'dark',
        surfaces: withoutCream200(DARK_SURFACE_GROUPS.counsel.surfaces),
        danger: tokenValue('--danger-text', DARK_SURFACE_GROUPS.counsel.scopes),
        warn: tokenValue('--warn-text', DARK_SURFACE_GROUPS.counsel.scopes),
      },
      {
        tone: 'light',
        surfaces: LIGHT_SURFACE_GROUPS.counselLight.surfaces as Record<
          string,
          string
        >,
        // Resolved on the SHELL, not on :root, and that is a fix rather
        // than a detail. A custom property inherits, so a light counsel
        // under a dark `html` - a reader whose profile is dark who has
        // switched this workspace to light, which the color-scheme
        // block in app/globals.css exists for - inherited #fecaca and
        // painted a pale red banner on a white card at 1.45:1. Reading
        // the value off `.counsel-shell:not(.dark)` means deleting that
        // declaration fails here instead of quietly inheriting.
        danger: tokenValue('--danger-text', ['.counsel-shell:not(.dark)']),
        warn: tokenValue('--warn-text', ['.counsel-shell:not(.dark)']),
      },
    ],
    consumer: [
      {
        tone: 'dark',
        surfaces: withoutCream200(DARK_SURFACE_GROUPS.consumer.surfaces),
        danger: tokenValue('--danger-text', DARK_SURFACE_GROUPS.consumer.scopes),
        warn: tokenValue('--warn-text', DARK_SURFACE_GROUPS.consumer.scopes),
      },
      {
        tone: 'light',
        surfaces: {
          white: '#ffffff',
          'cream-50': '#fefcf3',
          'cream-100': '#fbf7e9',
        },
        danger: tokenValue('--danger-text', [':root']),
        warn: tokenValue('--warn-text', [':root']),
      },
    ],
  } as const;

  const channels = (hex: string): [number, number, number] => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /** The banner's fill: the tint at its own alpha over the surface. */
  function bannerFill(tint: string, alpha: number, surface: string): string {
    const t = channels(tint);
    const g = channels(surface);
    return (
      '#' +
      t
        .map((v, i) =>
          Math.round(v * alpha + g[i] * (1 - alpha))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }

  function source(rel: string): string {
    return readFileSync(
      fileURLToPath(new URL(`../${rel}`, import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
  }

  /**
   * The quoted run a match sits inside, found by scanning outward from
   * the match rather than by pairing every quote in the file.
   *
   * Pairing globally was tried and it silently loses class strings: a
   * lone apostrophe in JSX prose ("didn't") opens a run that swallows
   * everything to the next apostrophe, and every className in between
   * drops out of the sweep. The bug surfaced as a mutation that stayed
   * green, which is the failure mode this whole file exists to catch,
   * so the scan is local and cannot desynchronise.
   */
  function runAround(src: string, index: number): string {
    const DELIM = /['"`]/;
    let start = index;
    while (start > 0 && !DELIM.test(src[start - 1])) start -= 1;
    let end = index;
    while (end < src.length && !DELIM.test(src[end])) end += 1;
    return src.slice(start, end);
  }

  const FG = /(?<![\w:-])text-(danger|warn)-text(?![\w-])/g;
  /**
   * A tint from the tone's OWN family. A template literal often carries
   * several branches at once, so a run can hold a sky or emerald fill
   * that belongs to a different branch entirely; pairing a danger label
   * with one of those would measure a combination that never renders.
   */
  const FILL_FAMILY = {
    danger: /(?<![\w:-])(?:hover:|focus:|group-hover:)?bg-((?:rose|red)-\d+)\/(\[[\d.]+\]|\d+)(?![\w-])/g,
    warn: /(?<![\w:-])(?:hover:|focus:|group-hover:)?bg-((?:amber|yellow|orange)-\d+)\/(\[[\d.]+\]|\d+)(?![\w-])/g,
  } as const;

  type Pair = { rel: string; tone: 'danger' | 'warn'; fill: string | null; alpha: number };

  function pairsIn(rel: string): Pair[] {
    const out: Pair[] = [];
    const src = source(rel);
    const seen = new Set<string>();
    for (const hit of src.matchAll(FG)) {
      const run = runAround(src, hit.index ?? 0);
      const key = `${hit[1]}\u0000${run}`;
      if (seen.has(key)) continue;
      seen.add(key);
      {
        const tone = hit[1] as 'danger' | 'warn';
        const fills = [...run.matchAll(FILL_FAMILY[tone])].map((m) => ({
          fill: m[1],
          alpha: m[2].startsWith('[')
            ? parseFloat(m[2].slice(1, -1))
            : parseInt(m[2], 10) / 100,
        }));
        if (!fills.length) out.push({ rel, tone, fill: null, alpha: 0 });
        for (const f of fills) out.push({ rel, tone, fill: f.fill, alpha: f.alpha });
      }
    }
    return out;
  }

  const PAIRS = Object.keys(SURFACE_FILES).flatMap(pairsIn);

  it('finds the surfaces at all, so an empty sweep cannot pass', () => {
    expect(Object.keys(SURFACE_FILES).length).toBeGreaterThanOrEqual(30);
    expect(PAIRS.length).toBeGreaterThanOrEqual(45);
    for (const [name, family] of Object.entries(FAMILIES)) {
      for (const g of family) {
        expect(g.danger, `${name}/${g.tone} has no --danger-text`).toMatch(
          /^#[0-9a-f]{6}$/,
        );
        expect(g.warn, `${name}/${g.tone} has no --warn-text`).toMatch(
          /^#[0-9a-f]{6}$/,
        );
      }
    }
  });

  it('knows the paint behind every fill it swept', () => {
    for (const p of PAIRS) {
      if (p.fill === null) continue;
      expect(
        FILL_PAINT[p.fill],
        `${p.rel} fills a banner with ${p.fill}, which has no pinned hex`,
      ).toBeDefined();
    }
  });

  it('earns the one surface it leaves out', () => {
    // The exclusion above is only honest if no registered banner can
    // land on that surface. Asserted rather than assumed.
    for (const rel of Object.keys(SURFACE_FILES)) {
      expect(
        source(rel).includes('bg-cream-200'),
        `${rel} paints a bg-cream-200 container, so the excluded surface is reachable`,
      ).toBe(false);
    }
  });

  it(`holds every banner to ${AA_SMALL_TEXT}:1 on both of its grounds`, () => {
    for (const p of PAIRS) {
      for (const ground of FAMILIES[SURFACE_FILES[p.rel]]) {
        const ink = ground[p.tone];
        for (const [surfaceName, surface] of Object.entries(ground.surfaces)) {
          const fill =
            p.fill === null
              ? surface
              : bannerFill(FILL_PAINT[p.fill], p.alpha, surface);
          const ratio = contrastRatio(ink, fill);
          expect(
            ratio,
            `${p.rel}: --${p.tone}-text ${ink} on ${p.fill ?? 'the bare surface'}${p.fill ? `/${p.alpha}` : ''} over the ${ground.tone} ${surfaceName} (${surface}) measures ${ratio.toFixed(3)}:1`,
          ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
        }
      }
    }
  });

  it('leaves no dark-only danger or warning foreground anywhere it can be painted light', () => {
    // The half that makes this the whole family rather than the
    // twenty-one that were reported. A pale danger or warning tone with
    // no light counterpart is legible on exactly one ground, so it may
    // only appear in a file that HAS one ground.
    const DARK_ONLY =
      /(?<![\w:-])text-(?:rose|red|amber|yellow|orange)-(?:100|200|300|400)(?![\w-])/;
    const walk = (rel: string): string[] =>
      readdirSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), {
        withFileTypes: true,
      }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${rel}/${e.name}`)
          : e.name.endsWith('.tsx')
            ? [`${rel}/${e.name}`]
            : [],
      );
    const files = [...walk('app'), ...walk('components')];
    expect(files.length, 'the sweep found no files at all').toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const rel of files) {
      if (Object.keys(SELF_GROUNDED).some((p) => rel.startsWith(p))) continue;
      source(rel)
        .split('\n')
        .forEach((line, i) => {
          if (DARK_ONLY.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders, 'these foregrounds are legible on one ground only').toEqual(
      [],
    );
  });

  it('claims every file that paints from a status token', () => {
    // The other half of the loop. Without this, dropping a file out of
    // SURFACE_FILES silently drops its measurement while the file goes
    // on rendering, which is the shape of a guard that stops seeing the
    // thing it guards.
    const walk = (rel: string): string[] =>
      readdirSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), {
        withFileTypes: true,
      }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${rel}/${e.name}`)
          : e.name.endsWith('.tsx')
            ? [`${rel}/${e.name}`]
            : [],
      );
    const unclaimed = [...walk('app'), ...walk('components')].filter(
      (rel) =>
        /(?<![\w:-])text-(?:danger|warn)-text(?![\w-])/.test(source(rel)) &&
        !(rel in SURFACE_FILES),
    );
    expect(
      unclaimed,
      'these files paint from a status token but no ground family claims them',
    ).toEqual([]);
  });

  it('states the regression this guard exists for, as arithmetic', () => {
    // The shipped pairs on the ground nobody measured them on. The
    // light counsel card is the surface the reported numbers were taken
    // against.
    const card = LIGHT_SURFACE_GROUPS.counselLight.surfaces['light counsel card'];
    const shipped: [string, string, string, number][] = [
      ['approach-builder banner', '#fde68a', 'amber-500', 0.1],
      ['evidence-viewer banner', '#ffe4e6', 'rose-500', 0.2],
      ['guest password banner', '#fecdd3', 'rose-950', 0.3],
    ];
    for (const [name, ink, fill, alpha] of shipped) {
      const ratio = contrastRatio(ink, bannerFill(FILL_PAINT[fill], alpha, card));
      expect(
        ratio,
        `the ${name} was already legible on light counsel, so this change is unnecessary`,
      ).toBeLessThan(2);
    }
  });
});

/*
 * The shared counsel primitives, measured as they are COMPOSED rather
 * than as tokens.
 *
 * THE HOLE THIS CLOSES, which is the more useful half of the fix.
 * Everything above measures either a VALUE (a derived accent, a status
 * token, a pill hex, a badge fill) or a DECLARATION read out of
 * app/globals.css. Nothing measured a component's class string. So a
 * primitive that names a Tailwind palette class the light counsel layer
 * does not repaint was invisible to the whole file: the class carries
 * its raw palette value, no `color:` declaration exists under the light
 * scope for the repaint sweep to find, and no token exists for the token
 * sweep to find. `SectionTitle`'s `label` variant sat there as
 * `text-ink-500 dark:text-cream-100/60`, which is 5.70:1 in dark and
 * 4.17:1 in light, and was correct in exactly the half somebody checked.
 *
 * The palette sweep further up would not have caught it either, for a
 * second and different reason: its `NOT_OURS` list names
 * components/counsel/ui.tsx, so the one existing net that touches this
 * file was slack by construction. That exclusion is left alone. It bans
 * a CLASS, which would force a full migration of a file another branch
 * is rebuilding; this block measures the PAINT, which is the claim that
 * actually matters and costs no migration.
 *
 * WHAT IS MEASURED. Every neutral text colour these two files paint, on
 * every solid ground the counsel shell paints, in both themes. Counsel
 * and the employee portal are the same shell (`counselShellClass`), so
 * one set of grounds covers both; the portal's own accent does not reach
 * these headings, which are neutral by construction, and the accent
 * itself is proved for all 4913 customer hexes further up.
 *
 * THE CASCADE IS NOT ASSUMED, it was read out of the built stylesheet.
 * A `dark:` variant compiles to `.dark\:x:is(.dark *)`, which is two
 * classes, the same specificity as the `.dark .x` override block, and
 * lands AFTER it in the emitted CSS. So a run carrying both paints the
 * `dark:` one in dark mode and the override block is dead there. A run
 * carrying only a bare palette class paints the override block's value.
 * Both arms are resolved below rather than guessed.
 */
describe('the shared counsel primitives paint no neutral under AA on a counsel ground', () => {
  /**
   * The two shared primitive files, plus the counsel dashboard's tiles.
   *
   * The tiles are here because they were the counterexample to the whole
   * mechanism: every eyebrow on that page painted the firm's raw
   * `accent_color` through an inline `style`, so there was no class for
   * this sweep to find, no repaint rule behind it, and no measurement of
   * any kind on the one colour a customer chooses. They now paint
   * `text-accent-text`, which the derivation blocks above prove for every
   * hex a customer can type, and the file's remaining neutrals are held
   * to the same floor as the primitives'. It is the dashboard: it is the
   * first counsel screen anybody sees, in either theme.
   */
  const FILES = [
    'components/counsel/ui.tsx',
    'components/counsel/patterns.tsx',
    'components/counsel/CounselDashboardTiles.tsx',
  ];

  /** The raw Tailwind values of the neutral ramps, from tailwind.config.ts. */
  const PALETTE: Record<string, string> = {
    'ink-400': '#a1a1aa',
    'ink-500': '#71717a',
    'ink-600': '#52525b',
    'ink-700': '#3f3f46',
    'ink-800': '#27272a',
    'ink-900': '#18181b',
    'ink-950': '#09090b',
    'cream-50': '#fefcf3',
    'cream-100': '#fbf7e9',
    'cream-200': '#f5edd6',
  };

  /** Neutral tokens, and the custom property each one reads. */
  const TOKEN_VAR: Record<string, string> = {
    muted: '--muted',
    foreground: '--foreground',
  };

  /**
   * Colours these files paint that are NOT neutrals, and which guard
   * covers each instead. Registered rather than ignored: a brand or
   * status colour added to one of these files fails the sweep below
   * until somebody says here which proof it falls under, which is what
   * stops "not a neutral" quietly becoming "not measured".
   */
  const NON_NEUTRAL: Record<string, string> = {
    'accent-text':
      'the per-firm derived accent, proved on every surface for every customer hex by the blocks above',
    'warn-text':
      'a fixed status token, held to AA on both grounds of its file by "holds every banner to 4.5:1 on both of its grounds" above',
    'danger-text':
      'a fixed status token, held to AA on both grounds of its file by "holds every banner to 4.5:1 on both of its grounds" above',
  };

  /**
   * Left on the palette on purpose, keyed by file AND class so an
   * exemption cannot quietly cover the next call site in the same file.
   */
  const ALLOWED = new Map([
    [
      'components/counsel/ui.tsx|text-ink-400',
      "EmptyState's icon well is `aria-hidden`, so it is decoration and carries no contrast requirement; it is deliberately quieter than the copy beside it",
    ],
    [
      'components/counsel/ui.tsx|dark:text-cream-100/40',
      'the dark half of that same aria-hidden icon well',
    ],
  ]);

  /** Class fragments that are type, not colour. */
  const NOT_A_COLOUR =
    /^(?:xs|sm|base|lg|xl|\d?xl|left|right|center|justify|start|end|balance|pretty|wrap|nowrap|ellipsis|clip)$/;

  const stripped = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');

  type Paint = { hex: string; alpha: number };

  function parseColour(value: string): Paint | null {
    const hex = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
    if (hex) return { hex: `#${hex[1].toLowerCase()}`, alpha: 1 };
    const rgba = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(
      value.trim(),
    );
    if (!rgba) return null;
    const to2 = (n: string) => Number(n).toString(16).padStart(2, '0');
    return {
      hex: `#${to2(rgba[1])}${to2(rgba[2])}${to2(rgba[3])}`,
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  /**
   * The last `color:` any rule declares for `<scope> .<class>`.
   *
   * A VARIANT class is escaped twice over, and both escapes have to be
   * reproduced or the lookup silently misses. Tailwind compiles
   * `hover:text-cream-100` to the class `.hover\:text-cream-100`, and the
   * repaint rule then hangs `:hover` off it, so the selector reads
   * `.hover\:text-cream-100:hover`. Escaping only `/` matched the
   * unprefixed spelling and nothing else, which made every `hover:`
   * palette class resolve to its RAW value in both themes - cream-100 on
   * near-white, 1.007:1 - and the guard reported a defect the stylesheet
   * had already fixed. A miss in this direction is the harmless one; the
   * same blindness pointed at a class the layer does NOT repaint would
   * have been the other kind.
   */
  function repaint(scope: string, cls: string): Paint | null {
    const escaped = cls.replace(/([:/])/g, '\\$1');
    const prefix = `${scope} .${escaped}`;
    let found: Paint | null = null;
    for (const [, selectors, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const parts = selectors.split(',').map((s) => s.trim());
      // A trailing `:not(...)` is still the same class; a trailing word
      // character is a different, longer class name.
      if (!parts.some((s) => s.startsWith(prefix) && !/^[\w\\/-]/.test(s.slice(prefix.length))))
        continue;
      const m = /(?:^|[;\s])color:\s*([^;]+);/.exec(body);
      if (m) found = parseColour(m[1]);
    }
    return found;
  }

  /** The last value any rule on `scopes` gives a custom property. */
  function varValue(name: string, scopes: string[]): Paint | null {
    let found: Paint | null = null;
    for (const [, selectors, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const parts = selectors.split(',').map((s) => s.trim());
      if (!parts.some((s) => scopes.includes(s))) continue;
      const m = new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`).exec(body);
      if (m) found = parseColour(m[1]);
    }
    return found;
  }

  const DARK_SCOPES = ['html.dark', '.dark', '.enterprise-shell', '.hq-shell'];
  const LIGHT_COUNSEL = '.counsel-shell:not(.dark)';

  /**
   * What a class actually paints in one theme.
   *
   * Light counsel takes the repaint layer if it declares one and the raw
   * palette otherwise, which is the exact asymmetry that hid the defect.
   * Dark takes the `.dark` override block for a bare class; a class that
   * only exists under a `dark:` variant is a plain utility and takes the
   * raw palette. Tokens read their custom property on the scope that
   * declares it, `:root` being what light counsel falls through to.
   */
  function resolve(cls: string, theme: 'light' | 'dark'): Paint | null {
    const bare = cls.replace(/^dark:/, '');
    const body = bare.replace(/^(?:[a-z-]+:)*text-/, '');
    const arbitrary = /^\[(#[0-9a-fA-F]{6})\]$/.exec(body);
    if (arbitrary) return { hex: arbitrary[1].toLowerCase(), alpha: 1 };
    const [name, alphaPart] = body.split('/');
    const alpha = alphaPart ? Number(alphaPart) / 100 : 1;
    if (TOKEN_VAR[name]) {
      const value = varValue(
        TOKEN_VAR[name],
        theme === 'dark' ? DARK_SCOPES : [':root'],
      );
      return value && { ...value, alpha: value.alpha * alpha };
    }
    // A `dark:`-prefixed class is its own utility; no repaint rule names
    // it, so it goes straight to the raw palette value.
    if (!cls.startsWith('dark:')) {
      const rule =
        theme === 'dark'
          ? repaint('.dark', bare)
          : repaint(LIGHT_COUNSEL, bare);
      // The repaint layers come first, not last. `forest-*` has no raw
      // value at all - it is `rgb(var(--forest-900))` and every shell
      // remaps the channels - so a rule is the ONLY way to resolve it,
      // and for `ink-*` the rule is what the two themes disagree about.
      if (rule) return rule;
    }
    if (!PALETTE[name]) return null;
    return { hex: PALETTE[name], alpha };
  }

  const composite = (paint: Paint, surface: string): string => {
    if (paint.alpha >= 1) return paint.hex;
    const ch = (h: string) => {
      const n = parseInt(h.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const f = ch(paint.hex);
    const g = ch(surface);
    return (
      '#' +
      f
        .map((v, i) =>
          Math.round(v * paint.alpha + g[i] * (1 - paint.alpha))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };

  /* ---------------- the sweep ---------------- */

  /** Every `text-*` class, with the variant chain in front of it. */
  const TEXT_CLASS =
    /(?<![\w:-])((?:[a-z-]+:)*)text-(\[[^\]]+\]|[a-z0-9]+(?:-[a-z0-9]+)*(?:\/\d+)?)(?![\w/[-])/g;

  /** The quoted run a match sits in: one element's class list. */
  function runAround(src: string, index: number): [number, string] {
    const DELIM = /['"`]/;
    let start = index;
    while (start > 0 && !DELIM.test(src[start - 1])) start -= 1;
    let end = index;
    while (end < src.length && !DELIM.test(src[end])) end += 1;
    return [start, src.slice(start, end)];
  }

  type Occurrence = {
    rel: string;
    cls: string;
    chain: string;
    name: string;
    run: string;
  };

  function occurrencesIn(rel: string): Occurrence[] {
    const src = readFileSync(
      fileURLToPath(new URL(`../${rel}`, import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const out: Occurrence[] = [];
    const seen = new Set<string>();
    for (const m of src.matchAll(TEXT_CLASS)) {
      const chain = m[1];
      const name = m[2];
      if (NOT_A_COLOUR.test(name)) continue;
      if (name.startsWith('[') && !name.startsWith('[#')) continue;
      const [start, run] = runAround(src, m.index ?? 0);
      const cls = `${chain}text-${name}`;
      const key = `${start}|${cls}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rel, cls, chain, name: name.split('/')[0], run });
    }
    return out;
  }

  const OCCURRENCES = FILES.flatMap(occurrencesIn);

  it('finds the primitives at all, so an empty sweep cannot pass', () => {
    // Four components in ui.tsx and six in patterns.tsx, every one of
    // which paints text. If this drops the sweep has stopped matching.
    expect(OCCURRENCES.length).toBeGreaterThanOrEqual(14);
    expect(FILES.every((f) => OCCURRENCES.some((o) => o.rel === f))).toBe(true);
    expect(varValue('--muted', [':root'])?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(varValue('--muted', DARK_SCOPES)?.hex).toMatch(/^#[0-9a-f]{6}$/);
    // The light counsel repaint layer is reachable from here, which is
    // what the light half of every resolution depends on.
    expect(repaint(LIGHT_COUNSEL, 'text-forest-900')?.hex).toBe('#17171b');
    expect(repaint('.dark', 'text-ink-500')?.alpha).toBeCloseTo(0.55, 2);
    // The variant arm, which is escaped differently from the bare one and
    // was silently unreachable until a `hover:` call site reached it.
    expect(repaint(LIGHT_COUNSEL, 'hover:text-cream-100')?.hex).toBe('#17171b');
  });

  it('knows the paint behind every text colour it swept', () => {
    // The arm that keeps this from going quiet. A class the resolver
    // cannot place is a failure, not a skip, so a new palette family or
    // a new token in these files has to be registered before it ships.
    for (const o of OCCURRENCES) {
      if (NON_NEUTRAL[o.name]) continue;
      for (const theme of ['light', 'dark'] as const) {
        expect(
          resolve(o.cls, theme),
          `${o.rel} paints \`${o.cls}\`, which is neither a neutral this guard can resolve nor a registered non-neutral; add it to PALETTE, to TOKEN_VAR, or to NON_NEUTRAL with the guard that covers it`,
        ).not.toBeNull();
      }
    }
  });

  it(`holds every neutral to ${AA_SMALL_TEXT}:1 on every counsel ground, both themes`, () => {
    const GROUNDS = {
      light: LIGHT_SURFACE_GROUPS.counselLight.surfaces as Record<string, string>,
      dark: DARK_SURFACE_GROUPS.counsel.surfaces as Record<string, string>,
    };
    for (const o of OCCURRENCES) {
      if (NON_NEUTRAL[o.name]) continue;
      if (ALLOWED.has(`${o.rel}|${o.cls}`)) continue;
      const isDarkOnly = o.chain.split(':').includes('dark');
      // A bare class stops painting in dark when its run carries a
      // `dark:` twin under the same remaining variants, because the
      // variant utility lands later in the emitted stylesheet.
      const twin = `dark:${o.chain}text-`;
      const themes: ('light' | 'dark')[] = isDarkOnly
        ? ['dark']
        : o.run.includes(twin)
          ? ['light']
          : ['light', 'dark'];
      for (const theme of themes) {
        const paint = resolve(o.cls, theme);
        if (!paint) continue;
        for (const [surfaceName, surface] of Object.entries(GROUNDS[theme])) {
          const ratio = contrastRatio(composite(paint, surface), surface);
          expect(
            ratio,
            `${o.rel}: \`${o.cls}\` paints ${composite(paint, surface)} on the ${theme} ${surfaceName} (${surface}) and measures ${ratio.toFixed(3)}:1`,
          ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
        }
      }
    }
  });

  it('the exemption list stays honest', () => {
    for (const [key, why] of ALLOWED) {
      const [rel, cls] = key.split('|');
      expect(
        OCCURRENCES.some((o) => o.rel === rel && o.cls === cls),
        `${rel} no longer paints ${cls}, so its exemption is dead and would silently cover the next one: ${why}`,
      ).toBe(true);
    }
    for (const name of Object.keys(NON_NEUTRAL)) {
      expect(
        OCCURRENCES.some((o) => o.name === name),
        `no swept file paints text-${name} any more; drop it from NON_NEUTRAL rather than leaving a standing exemption`,
      ).toBe(true);
    }
  });

  it('states the regression this guard exists for, as arithmetic', () => {
    // SectionTitle's `label` variant as it shipped. The dark half was
    // fine, which is why it survived: whoever wrote it checked the
    // theme they were looking at.
    const lightGrounds = Object.values(
      LIGHT_SURFACE_GROUPS.counselLight.surfaces,
    );
    const shipped = '#71717a'; // text-ink-500, unrepainted on light counsel
    expect(contrastRatio(shipped, '#f6f6f7')).toBeLessThan(AA_SMALL_TEXT);
    expect(
      Math.min(...lightGrounds.map((s) => contrastRatio(shipped, s))),
    ).toBeLessThan(4.2);
    // And the value that replaced it clears the floor on all four.
    const fixed = varValue('--muted', [':root'])?.hex as string;
    for (const surface of lightGrounds) {
      expect(contrastRatio(fixed, surface)).toBeGreaterThanOrEqual(
        AA_SMALL_TEXT,
      );
    }
  });

  it('keeps the two section headings on one colour', () => {
    // The drift this started as. SectionTitle's `label` and
    // SectionLabel are the same heading at two sizes, and they got here
    // by each spelling their own colour. They may keep disagreeing
    // about size; disagreeing about colour again has to fail.
    const ui = readFileSync(
      fileURLToPath(new URL('../components/counsel/ui.tsx', import.meta.url)),
      'utf8',
    );
    const patterns = readFileSync(
      fileURLToPath(
        new URL('../components/counsel/patterns.tsx', import.meta.url),
      ),
      'utf8',
    );
    const labelVariant = /label:\s*\n?\s*'([^']*)'/.exec(ui)?.[1] ?? '';
    expect(labelVariant, 'SECTION_VARIANT.label was not found').toContain(
      'uppercase',
    );
    const sectionLabel =
      /export function SectionLabel[\s\S]*?className=\{`([^`]*)`/.exec(
        patterns,
      )?.[1] ?? '';
    expect(sectionLabel, 'SectionLabel was not found').toContain('uppercase');
    const colourOf = (s: string) =>
      s.split(/\s+/).filter((c) => /(?:^|:)text-(?:muted|foreground|ink-|cream-|forest-)/.test(c));
    expect(colourOf(labelVariant)).toEqual(colourOf(sectionLabel));
  });

  /* ------------- classes these files WEAR rather than spell ------------- */

  /**
   * The sweep above reads `text-*` tokens out of the tsx. A component
   * class does not put one there: `.eyebrow` carries its colour in
   * app/globals.css, so a file that wears it spells no colour at all and
   * the sweep saw nothing to measure.
   *
   * That blind spot is not theoretical. PageHeader's `plain` eyebrow was
   * a hand-rolled copy of `.eyebrow` painted `text-gold-300` (#e5ce93),
   * which the light counsel layer does not repaint: 1.34:1 on a light
   * counsel chip, invisible rather than merely low, on the two surfaces a
   * firm sends invited outside counsel to. It was visible to the sweep
   * only because it happened to be spelled as a utility. Folding it back
   * onto `.eyebrow` would have FIXED the colour and simultaneously made
   * it unmeasurable, so the guard has to be able to follow it there.
   */
  /**
   * A selector list split on its TOP-LEVEL commas.
   *
   * Not `String.split(',')`, and the difference is not cosmetic. The
   * invisible-text guard further up the stylesheet is one selector
   * reading `... :is(.bg-white, ..., .card, ...) > :is(.text-cream-50,
   * ...)`, which paints the CHILDREN of a card. Split naively it yields
   * a fragment that is exactly `.card`, so the card appears to be
   * painted cream on a white ground and the sweep reports 1.01:1 against
   * a rule that does no such thing.
   */
  function splitSelectorList(list: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of list) {
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      if (ch === ',' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current);
    return out.filter((s) => s.trim());
  }

  /** Selector text with the whitespace inside its parentheses removed. */
  function flattenSelector(sel: string): string {
    return sel.trim().replace(/\(([^()]*)\)/g, (m) => m.replace(/\s+/g, ''));
  }

  /** A selector split into its scope and the compound it finally targets. */
  function selectorParts(sel: string): { scope: string; tail: string } {
    const parts = flattenSelector(sel)
      .replace(/[>+~]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return {
      scope: parts.slice(0, -1).join(' '),
      tail: parts[parts.length - 1] ?? '',
    };
  }

  /**
   * Which themes a scope can paint in.
   *
   * `.dark` inside a `:not()` is the LIGHT counsel shell saying it is not
   * dark, so it is stripped before the dark markers are looked for. An
   * unscoped rule paints in both and is simply overridden in one.
   */
  function scopeThemes(scope: string): ('light' | 'dark')[] {
    const withoutNot = scope.replace(/:not\(\.dark\)/g, '');
    if (/\.dark\b|\.enterprise-shell\b|\.hq-shell\b/.test(withoutNot))
      return ['dark'];
    if (/:not\(\.dark\)/.test(scope)) return ['light'];
    return ['light', 'dark'];
  }

  /** Does this selector finally target exactly `.cls`, and not a pseudo? */
  function targetsClass(tail: string, cls: string): boolean {
    if (tail.includes('::')) return false;
    if (tail === `.${cls}`) return true;
    const group = /^:is\(([^)]*)\)$/.exec(tail);
    return group ? group[1].split(',').includes(`.${cls}`) : false;
  }

  /**
   * The colour an `@apply`-ed token puts on the class that applies it,
   * which is NOT the same as the colour that class name would have as a
   * utility, and the difference is the whole reason this exists.
   *
   * `@apply text-ink-500` inlines `color: #71717a` into `.tab`. The
   * repaint layers key off the UTILITY `.text-ink-500`, and `.tab` does
   * not carry it, so none of them reach it: a palette colour applied
   * this way is frozen at its raw value in both themes. A var-driven
   * family is the opposite - `text-forest-900` inlines
   * `rgb(var(--forest-900))` and every shell remaps the channels - so it
   * still follows the theme and is resolved the ordinary way.
   */
  function resolveApplied(token: string, theme: 'light' | 'dark'): Paint | null {
    const body = token.replace(/^(?:[a-z-]+:)*text-/, '');
    const [name, alphaPart] = body.split('/');
    if (PALETTE[name])
      return {
        hex: PALETTE[name],
        alpha: alphaPart ? Number(alphaPart) / 100 : 1,
      };
    return resolve(token, theme);
  }

  /**
   * What a component class paints in one theme: the last literal
   * `color:` any rule that reaches it declares, or, failing that, the
   * `text-*` token it hands to `@apply`.
   *
   * The `@apply` arm is what keeps `.card`'s `dark:text-cream-100` from
   * being read as "declares no colour", which would be the same silence
   * this block exists to remove.
   */
  function componentPaint(cls: string, theme: 'light' | 'dark'): Paint | null {
    let found: Paint | null = null;
    for (const [, selectors, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const reaches = splitSelectorList(selectors).some((sel) => {
        const { scope, tail } = selectorParts(sel);
        return targetsClass(tail, cls) && scopeThemes(scope).includes(theme);
      });
      if (!reaches) continue;
      const literal = /(?:^|[;\s])color:\s*([^;]+);/.exec(body);
      if (literal) {
        found = parseColour(literal[1]);
        continue;
      }
      const applied = /@apply\s+([^;]+);/.exec(body);
      if (!applied) continue;
      // A bare token is inlined unconditionally and so paints in both
      // themes; a `dark:` token compiles to `.dark .<class>` and
      // overrides it in dark only. Anything with another variant in
      // front (`hover:`) is a state, not the resting colour.
      let bare: string | null = null;
      let dark: string | null = null;
      for (const token of applied[1].split(/\s+/)) {
        const name = /^(dark:)?text-([a-z0-9-]+(?:\/\d+)?|\[#[0-9a-fA-F]{6}\])$/.exec(
          token,
        );
        if (!name || NOT_A_COLOUR.test(name[2])) continue;
        if (name[1]) dark = token;
        else bare = token;
      }
      const token = theme === 'dark' ? (dark ?? bare) : bare;
      if (token) found = resolveApplied(token, theme) ?? found;
    }
    return found;
  }

  /**
   * Every class token these files put in a quoted CLASS LIST.
   *
   * A class list is a run of two or more tokens, one of which is
   * hyphenated. That is a heuristic and it is drawn where it is because
   * the alternative was worse in a way that was measured rather than
   * guessed: reading every quoted lowercase word instead reported
   * `role="tab"` on a tablist as the `.tab` component class and failed
   * the sweep at 2.87:1 against a rule that file does not use. A guard
   * that cries wolf gets an exemption written for it, and an exemption
   * written for something imaginary is worse than no guard.
   *
   * A single-class `className="eyebrow"` is therefore not seen. That is
   * the cost, and it is bounded by the anchor below, which fails if the
   * one class this block exists for stops being visible.
   */
  function classTokensIn(rel: string): string[] {
    const src = readFileSync(
      fileURLToPath(new URL(`../${rel}`, import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const out = new Set<string>();
    for (const [, run] of src.matchAll(/['"`]([^'"`]*)['"`]/g)) {
      const tokens = run.split(/\s+/).filter(Boolean);
      if (tokens.length < 2 || !tokens.some((t) => /^[a-z].*-/.test(t))) continue;
      for (const token of tokens) {
        // `text-*` is a Tailwind utility and belongs to the sweep above,
        // which resolves it through the repaint layers AND honours the
        // exemptions keyed to it. Measuring it a second time here would
        // re-report the aria-hidden icon well as a failure, and worse,
        // it would do it from a resolver that has no exemption list.
        if (/^text-/.test(token)) continue;
        if (/^[a-z][a-z0-9-]*$/.test(token)) out.add(token);
      }
    }
    return [...out];
  }

  /** The ones globals.css actually paints text with. */
  const WORN = FILES.flatMap((rel) =>
    classTokensIn(rel)
      .filter(
        (cls) =>
          componentPaint(cls, 'light') !== null ||
          componentPaint(cls, 'dark') !== null,
      )
      .map((cls) => ({ rel, cls })),
  );

  it('sees the component classes these files wear, so the sweep cannot go quiet', () => {
    // The named one. If PageHeader stops wearing `.eyebrow`, or the
    // stylesheet stops painting it, this arm says so rather than
    // measuring nothing and passing.
    expect(WORN.some((w) => w.cls === 'eyebrow')).toBe(true);
    expect(componentPaint('eyebrow', 'light')?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(componentPaint('eyebrow', 'dark')?.hex).toMatch(/^#[0-9a-f]{6}$/);
    // And the resolver can tell the two themes apart, which is the whole
    // reason it reads the scope rather than the first rule it finds.
    expect(componentPaint('eyebrow', 'light')?.hex).not.toBe(
      componentPaint('eyebrow', 'dark')?.hex,
    );
  });

  it(`holds every worn class to ${AA_SMALL_TEXT}:1 on every counsel ground, both themes`, () => {
    const GROUNDS = {
      light: LIGHT_SURFACE_GROUPS.counselLight.surfaces as Record<string, string>,
      dark: DARK_SURFACE_GROUPS.counsel.surfaces as Record<string, string>,
    };
    for (const { rel, cls } of WORN) {
      for (const theme of ['light', 'dark'] as const) {
        const paint = componentPaint(cls, theme);
        if (!paint) continue;
        for (const [surfaceName, surface] of Object.entries(GROUNDS[theme])) {
          const ratio = contrastRatio(composite(paint, surface), surface);
          expect(
            ratio,
            `${rel} wears \`${cls}\`, which paints ${composite(paint, surface)} on the ${theme} ${surfaceName} (${surface}) and measures ${ratio.toFixed(3)}:1`,
          ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
        }
      }
    }
  });

  it('keeps both eyebrow variants on one colour source', () => {
    // The drift, stated as the thing that caused it. `rule` and `plain`
    // are the same micro-type and differ only in the leading rule, and
    // they got here by each spelling their own gold. `plain` may keep
    // dropping the rule; spelling a colour of its own again has to fail.
    const ui = readFileSync(
      fileURLToPath(new URL('../components/counsel/ui.tsx', import.meta.url)),
      'utf8',
    );
    const block = /const EYEBROW_VARIANT = \{([\s\S]*?)\} as const;/.exec(ui)?.[1];
    expect(block, 'EYEBROW_VARIANT was not found').toBeTruthy();
    const variants = [...(block as string).matchAll(/'([^']*)'/g)].map(
      (m) => m[1],
    );
    expect(variants.length).toBe(2);
    for (const v of variants) {
      expect(
        v.split(/\s+/).some((c) => c === 'eyebrow'),
        `\`${v}\` does not wear .eyebrow, so it carries a second spelling of the gold`,
      ).toBe(true);
      expect(
        v.split(/\s+/).filter((c) => /(?:^|:)text-/.test(c) && !/text-\[\d/.test(c)),
        `\`${v}\` paints its own text colour on top of .eyebrow`,
      ).toEqual([]);
    }
    // And exactly one of them drops the leading rule, which is the only
    // difference the prop is allowed to mean. Without this the two
    // variants could share a colour by both being `.eyebrow` and lose
    // the reason `plain` exists.
    const bare = variants.filter((v) => v.split(/\s+/).includes('eyebrow-bare'));
    expect(bare.length).toBe(1);
    expect(stripped).toMatch(/\.eyebrow-bare::before\s*\{\s*content:\s*none;?\s*\}/);
  });

  it('derives the eyebrow gold rather than picking it', () => {
    // The two literals in the stylesheet are this function's output on
    // Advottic's own gold, so the pair cannot drift from the arithmetic
    // that gives every other accent its floor.
    expect(componentPaint('eyebrow', 'light')?.hex).toBe(
      deriveAccentText(DEFAULT_ACCENT, 'light'),
    );
    expect(componentPaint('eyebrow', 'dark')?.hex).toBe(
      deriveAccentText(DEFAULT_ACCENT, 'dark'),
    );
  });

  it('states the eyebrow regression this guard exists for, as arithmetic', () => {
    const light = Object.values(LIGHT_SURFACE_GROUPS.counselLight.surfaces);
    const darkCounsel = Object.values(DARK_SURFACE_GROUPS.counsel.surfaces);
    const darkConsumer = Object.values(DARK_SURFACE_GROUPS.consumer.surfaces);

    // What `plain` shipped: gold-300, unrepainted by the light counsel
    // layer. Not low contrast - absent.
    const shipped = '#e5ce93';
    expect(
      Math.max(...light.map((s) => contrastRatio(shipped, s))),
    ).toBeLessThan(1.6);

    // And what `.eyebrow` itself shipped in dark, which is why copying
    // the sibling would have moved the bug rather than fixed it. Both
    // repaint families are reachable from `:where(.dark, ...)` and the
    // consumer one is green, so it failed there far harder.
    const oldDark = '#a38a55';
    expect(
      Math.min(...darkCounsel.map((s) => contrastRatio(oldDark, s))),
    ).toBeLessThan(AA_SMALL_TEXT);
    expect(
      Math.min(...darkConsumer.map((s) => contrastRatio(oldDark, s))),
    ).toBeLessThan(3);

    // The derived pair clears the floor on every ground either half can
    // land on, including the consumer greens the old dark gold failed.
    const fixedLight = deriveAccentText(DEFAULT_ACCENT, 'light');
    const fixedDark = deriveAccentText(DEFAULT_ACCENT, 'dark');
    for (const s of light)
      expect(contrastRatio(fixedLight, s)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    for (const s of [...darkCounsel, ...darkConsumer])
      expect(contrastRatio(fixedDark, s)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });
});
