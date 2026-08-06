/**
 * Semantic text colours derived from a firm's own accent.
 *
 * THE RULE
 * --------
 * A brand colour that works as a button FILL is usually unreadable as
 * TEXT. Advottic's default gold (#d5bb7e) measures 1.87:1 on white and
 * 9.75:1 on a counsel card: the same hex is either invisible or fine
 * depending only on what is behind it. So a fill token and a text token
 * are two different things and must not share a value.
 *
 * Techottic (docs/DESIGN-LAYOUT.md section 1) can hardcode the readable
 * variants because it has exactly one brand green. Advottic cannot:
 * `firms.accent_color` is whatever the customer typed, so the readable
 * variant has to be COMPUTED from it.
 *
 * THE DERIVATION
 * --------------
 * Keep the customer's hue, cap the chroma, and pin the OKLCH lightness.
 * Lightness is what buys the contrast floor: on a known background a
 * fixed lightness bounds the relative luminance regardless of hue, so
 * one pinned number holds for every colour a customer can pick rather
 * than for the handful anyone thought to test.
 *
 *   accent text (dark shells)  oklch(L 0.84, C min(c, 0.078), H unchanged)
 *   accent text (light)        oklch(L 0.46, C min(c, 0.075), H unchanged)
 *
 * WHICH SURFACES THE FLOOR COVERS
 * -------------------------------
 * The dark tone is declared on `html.dark, .dark, .counsel-shell,
 * .enterprise-shell, .hq-shell`, and those selectors do NOT all paint
 * the same neutrals. The counsel and enterprise shells repaint the light
 * Tailwind utilities to near-black, but the consumer dark theme repaints
 * the same utilities GREEN: `.dark .bg-cream-200` is #2a5a47, which is
 * three times the luminance of the counsel #2c2c31 and is the lightest
 * substrate the dark tone can land on anywhere. A dark pin proved only
 * against the counsel neutrals fails there. ACCENT_TEXT_SURFACES below
 * carries both families and a test asserts it stays complete by reading
 * the repaint rules back out of app/globals.css.
 *
 * The claim is bounded, deliberately: it covers every SOLID surface the
 * selector list repaints. Gradient stops (`from-cream-50`, `via-cream-50`)
 * compile to different CSS selectors and are NOT repainted in dark mode,
 * so a pale gradient band inside a dark document keeps its light stops.
 * Text there needs an explicit `dark:` variant, exactly as app/globals.css
 * already says for every other dark override. Nothing here changes that.
 *
 * WHY THE CHROMA CAP IS LOAD-BEARING
 * ----------------------------------
 * Pinning lightness alone is NOT enough. A pinned lightness carrying the
 * customer's full chroma is frequently outside sRGB, and a browser that
 * resolves that by clipping each channel drags the luminance back down.
 * Measured: pure red pinned to L 0.72 at its own chroma (0.258) clips to
 * 4.04:1 on `.counsel-shell .bg-cream-200`, under the floor. Pure blue
 * pinned to L 0.66 at its own chroma (0.313) clips to 4.31:1 on a
 * counsel card and 3.29:1 on `.counsel-shell .bg-cream-200`. So a
 * lightness pin on its own does not give the guarantee it looks like it
 * gives.
 *
 * The caps are set to the SMALLEST maximum chroma over all hues at each
 * pinned lightness (0.0788 at L 0.84, 0.0782 at L 0.46), rounded down.
 * Every derived colour is therefore inside sRGB for every hue, which
 * means no gamut mapping ever runs: no clipping, no chroma reduction,
 * no dependence on which of the two a browser implements, and no hue
 * drift. The floor stops being an argument about browser behaviour and
 * becomes plain arithmetic.
 *
 * The cost is saturation. A vivid accent comes back muted as text. That
 * is the correct trade for text and only for text; the fill token keeps
 * the customer's hex exactly.
 *
 * WHAT THIS COSTS
 * ---------------
 * Hue survives; brand IDENTITY does not always. A navy #1F3A93 reads as
 * periwinkle at L 0.84 and a deep forest #0F2D24 reads as sage. That is
 * accepted deliberately and only for TEXT: navy on a near-black counsel
 * card is 1.81:1 and simply cannot be read, so there is no version of
 * this that both keeps the exact navy and is legible. The firm's real
 * colour is still exact everywhere it is a FILL, which is where a brand
 * colour is actually recognised.
 *
 * ACHROMATIC ACCENTS
 * ------------------
 * A grey, black or white accent has no meaningful hue, and floating
 * point noise in the conversion would otherwise give it an arbitrary
 * one. Below ACHROMATIC_CHROMA the chroma is forced to exactly zero so
 * the token is a deterministic neutral rather than a faintly tinted
 * grey that differs per firm for no reason.
 *
 * A KNOWN ASYMMETRY, RECORDED RATHER THAN FIXED
 * ---------------------------------------------
 * The helpers here fall back to DEFAULT_ACCENT on anything they cannot
 * parse. The CSS path does not: `oklch(from <garbage> ...)` computes to
 * the guaranteed-invalid value, which for `color` means inherit, so
 * accent text would silently become body text. Readable, but with no
 * signal that a firm's accent is broken. The three server actions that
 * write firms.accent_color each test `/^#[0-9a-fA-F]{6}$/` first
 * (lib/firm-actions.ts and lib/actions.ts), so the reachable paths are
 * covered; the column itself carries no CHECK constraint, so a row
 * written straight to the database is not.
 *
 * No dependencies, no DOM, no `server-only`: this is imported by client
 * components and by the Node-environment test suite alike.
 */

/** Advottic gold. Used when a firm has no accent, or an unparseable one. */
export const DEFAULT_ACCENT = '#d5bb7e';

/**
 * The pinned OKLCH lightness and the chroma cap for each tone.
 *
 * These four numbers are the whole contract, and they are duplicated as
 * literals in `app/globals.css`. tests/accent-text.test.ts reads that
 * file and fails if the two ever disagree, so the CSS cannot drift away
 * from the arithmetic that proves it.
 */
export const ACCENT_TEXT_TONES = {
  /**
   * Counsel, enterprise, HQ and any `.dark` surface. The pin is set by
   * the consumer dark theme's `.bg-cream-200` (#2a5a47), not by the
   * counsel neutrals: those two families share one selector list and
   * the green one is far lighter.
   */
  dark: { lightness: 0.84, maxChroma: 0.078 },
  /** Light theme. Reachable today only through the signer page. */
  light: { lightness: 0.46, maxChroma: 0.075 },
} as const;

export type AccentTone = keyof typeof ACCENT_TEXT_TONES;

/** Below this OKLCH chroma an accent is treated as a pure neutral. */
export const ACHROMATIC_CHROMA = 0.02;

/*
 * Foreground for text sitting ON the accent fill.
 *
 * This one cannot be a lightness pin, because the background is the
 * accent itself and so moves across the entire range. It is a binary
 * choice, and the pair has to cover every possible fill luminance:
 *
 *   pure black passes AA when the fill luminance is >= 0.175
 *   pure white passes AA when the fill luminance is <= 0.18333
 *
 * The two intervals OVERLAP, so every accent is covered and 0.179 sits
 * inside the overlap. No softer pair works: the brand's own cream-100
 * (#fbf7e9) tops out at 0.16759 and forest-950 (#0a1f19) starts at
 * 0.22516, which leaves accents between those two luminances with no
 * legible foreground at all. Hence literal black and white here, and
 * only here.
 */
export const ACCENT_ON_SPLIT = 0.179;
export const ACCENT_ON_LIGHT = '#ffffff';
export const ACCENT_ON_DARK = '#000000';

/* ------------------------------------------------------------------ */
/* Colour conversion. sRGB <-> linear sRGB <-> OKLab <-> OKLCH.        */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** sRGB transfer function, IEC 61966-2-1. */
const decodeChannel = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

const encodeChannel = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/** Parse #rgb / #rrggbb (with or without the hash) to 0-1 sRGB. */
function parseHex(input: string): [number, number, number] | null {
  const raw = input.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const part = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function linearToOklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH of a hex colour: lightness 0-1, chroma, hue in degrees. */
export function toOklch(hex: string): { l: number; c: number; h: number } {
  const rgb = parseHex(hex) ?? (parseHex(DEFAULT_ACCENT) as [number, number, number]);
  const [r, g, b] = rgb.map(decodeChannel) as [number, number, number];
  const [L, a, bb] = linearToOklab(r, g, b);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}

/**
 * WCAG 2.1 relative luminance of a hex colour.
 * Deliberately the WCAG coefficients, not OKLab lightness: the success
 * criterion is defined on this quantity and nothing else.
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? (parseHex(DEFAULT_ACCENT) as [number, number, number]);
  const [r, g, b] = rgb.map(decodeChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two hex colours. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const ya = relativeLuminance(a);
  const yb = relativeLuminance(b);
  const hi = Math.max(ya, yb);
  const lo = Math.min(ya, yb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The readable text form of a firm accent on the given tone of surface.
 *
 * Keeps hue, caps chroma, pins lightness. The clamp on the way out is
 * belt and braces only: the caps in ACCENT_TEXT_TONES sit inside the
 * sRGB boundary at their pinned lightness for every hue, so nothing
 * reaches it, and the test suite asserts that.
 */
export function deriveAccentText(accent: string, tone: AccentTone): string {
  const { lightness, maxChroma } = ACCENT_TEXT_TONES[tone];
  const { c, h } = toOklch(accent);
  const chroma = c < ACHROMATIC_CHROMA ? 0 : Math.min(c, maxChroma);
  const rad = (h * Math.PI) / 180;
  const linear = oklabToLinear(
    lightness,
    chroma * Math.cos(rad),
    chroma * Math.sin(rad),
  );
  return toHex(linear.map((v) => encodeChannel(clamp01(v))) as [number, number, number]);
}

/**
 * The readable foreground for text placed ON an accent fill.
 *
 * Returns literal white or black. See ACCENT_ON_SPLIT above for why the
 * brand's softer cream and forest cannot be used here.
 */
export function accentOn(accent: string | null | undefined): string {
  const y = relativeLuminance(accent || DEFAULT_ACCENT);
  return y > ACCENT_ON_SPLIT ? ACCENT_ON_DARK : ACCENT_ON_LIGHT;
}

/**
 * Surfaces the accent-text token can actually land on, measured rather
 * than assumed.
 *
 * The dark tone is declared on one selector list that reaches TWO
 * different repaint families, and they do not agree:
 *
 *   .counsel-shell / .enterprise-shell  light utilities -> near-black
 *   html.dark / .dark (consumer, HQ)    light utilities -> deep green
 *
 * The green family is much lighter. `.dark .bg-cream-200` is #2a5a47 at
 * luminance 0.0826 against the counsel `.bg-cream-200` #2c2c31 at
 * 0.0256, so it, not the counsel card and not the counsel cream, is what
 * sets the dark pin. Tuning against either family alone passes at a
 * lightness that then fails on the other.
 *
 * Every hex below is a solid `background-color` declared in
 * app/globals.css, and tests/accent-text.test.ts reads those rules back
 * out and fails if a dark-scoped surface exists there that is missing
 * here. Translucent overlays (`bg-cream-50/40` and friends) are excluded
 * on purpose: they composite onto whichever of these is behind them, so
 * they are never lighter than the surface they sit on.
 */
export const ACCENT_TEXT_SURFACES = {
  dark: {
    'counsel page': '#0a0a0b',
    'counsel .bg-ink-50': '#141417',
    'counsel card': '#151519',
    'counsel .bg-cream-50': '#1a1a1e',
    'counsel .bg-white': '#1e1e22',
    'counsel .bg-cream-100': '#242428',
    'counsel .bg-cream-200': '#2c2c31',
    'consumer dark page': '#0a1f19',
    'consumer dark .bg-ink-50': '#102a23',
    'consumer dark .bg-cream-50': '#173b30',
    'consumer dark .bg-white': '#1a3d31',
    'consumer dark .bg-cream-100': '#1f4839',
    'consumer dark .bg-cream-200': '#2a5a47',
  },
  light: {
    white: '#ffffff',
    'cream-50': '#fefcf3',
    'cream-100': '#fbf7e9',
    'cream-200': '#f5edd6',
  },
} as const;

/**
 * The surface of a tone that the floor actually rests on: the lightest
 * one for the dark tone, the darkest one for the light tone. Derived
 * rather than named, so adding a surface above cannot leave a
 * hand-picked "worst case" quietly out of date.
 */
export function tightestSurface(tone: AccentTone): string {
  const surfaces = Object.values(ACCENT_TEXT_SURFACES[tone]) as string[];
  return surfaces.reduce((worst, candidate) =>
    tone === 'dark'
      ? relativeLuminance(candidate) > relativeLuminance(worst)
        ? candidate
        : worst
      : relativeLuminance(candidate) < relativeLuminance(worst)
        ? candidate
        : worst,
  );
}

/** The AA floor for small text. Chips in this product are 10-11px. */
export const AA_SMALL_TEXT = 4.5;
