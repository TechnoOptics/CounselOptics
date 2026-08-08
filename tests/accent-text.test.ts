import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  accentOn,
  contrastRatio,
  deriveAccentText,
  relativeLuminance,
  tightestInGroup,
  tightestSurface,
  toOklch,
} from '../lib/accent-text';
import type { DarkSurfaceGroup } from '../lib/accent-text';

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
describe('the proof set covers every surface each dark group can land on', () => {
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
      Object.values(DARK_SURFACE_GROUPS).flatMap(
        (g) => g.scopes as readonly string[],
      ),
    ),
  ];

  /**
   * Anything shaped like a dark shell scope, claimed or not. This is
   * what turns "a new shell was added" from a silent gap into a failure:
   * `.partner-shell .bg-cream-200` matches here, finds no group, and
   * fails the attribution test below.
   */
  const LOOKS_DARK_SCOPED = /^(?:html)?\.[\w-]*(?:dark|shell)\b/;

  function darkScopedBackgrounds(): BackgroundRule[] {
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
      if (!parts.every((s) => LOOKS_DARK_SCOPED.test(s))) continue;
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
  function paintedBy(group: DarkSurfaceGroup): Map<string, BackgroundRule> {
    const scopes = DARK_SURFACE_GROUPS[group].scopes as readonly string[];
    const winners = new Map<string, BackgroundRule>();
    for (const rule of darkScopedBackgrounds()) {
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
    const found = darkScopedBackgrounds();
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(new Set(found.map((r) => r.hex)).size).toBeGreaterThanOrEqual(8);
  });

  it('attributes every dark-scoped background to a group that claims it', () => {
    for (const rule of darkScopedBackgrounds()) {
      expect(
        rule.scope,
        `\`${rule.selector}\` paints ${rule.hex} from a selector no group claims; add it to the scopes of a group in DARK_SURFACE_GROUPS`,
      ).not.toBeNull();
    }
  });

  for (const group of Object.keys(DARK_SURFACE_GROUPS) as DarkSurfaceGroup[]) {
    it(`lists every solid background the ${group} group is painted on`, () => {
      const proven = new Set(
        Object.values(DARK_SURFACE_GROUPS[group].surfaces).map((s) =>
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
          `\`${rule.selector}\` paints ${rule.hex} inside the ${group} group, which is not in DARK_SURFACE_GROUPS.${group}.surfaces`,
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
      ...Object.values(DARK_SURFACE_GROUPS).flatMap(
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

  it('leaves no palette call site behind except the two documented ones', () => {
    const offenders: string[] = [];
    for (const rel of sweptFiles()) {
      const src = readFileSync(
        fileURLToPath(new URL(`../${rel}`, import.meta.url)),
        'utf8',
      );
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
      const src = readFileSync(
        fileURLToPath(new URL(`../${rel}`, import.meta.url)),
        'utf8',
      );
      const hits = [...src.matchAll(pattern)].filter(
        (m) => m[1] + m[2] === cls,
      );
      expect(hits.length, `${rel} no longer needs its ${cls} exemption: ${why}`)
        .toBeGreaterThan(0);
    }
  });
});
