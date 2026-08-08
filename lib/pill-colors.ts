/**
 * The status palette, as plain data.
 *
 * These hexes used to live inside components/counsel/StatusPill.tsx, which
 * meant anything that only wanted a colour name had to import a React
 * component to get one. lib/portal-status.ts does exactly that, and the
 * moment a server-only module (the notification mailer) needed a status
 * label, it was dragging a .tsx file into the email path. The values are
 * data, so they live in a leaf module and StatusPill re-exports them for
 * every existing caller.
 */

/** Advottic gold. The default for any state with no colour of its own. */
export const PILL_DEFAULT = '#D5BB7E';

/**
 * Shared semantic hexes, so "waiting" is the same amber wherever it is
 * shown. These are status colours, not brand colours: gold stays the
 * accent and these never appear as chrome.
 */
/*
 * Every hex here is checked against the chip as StatusPill actually
 * renders it: the text is the hex, and the fill behind it is the same
 * hex at 10 percent over the surface. The surfaces are the two the
 * enterprise shells paint, measured in the browser rather than assumed:
 * a counsel card is rgb(21, 21, 25) and the page behind it is
 * rgb(10, 10, 11). A chip is 10 or 11px semibold, which is small text,
 * so the floor is WCAG AA 4.5:1 and not the 3:1 large-text allowance.
 *
 * `quiet` was #7C7C86 and measured 3.96:1 on a card, so it shipped
 * failing. It was not a counsel-only problem: lib/portal-status.ts
 * paints the employee-facing "Closed" state with it, so the Hub carried
 * the same failure. #8A8A94 is the same grey lifted to 4.71:1 on a card
 * and 5.25:1 on the page.
 *
 * That lift narrows the step down from `neutral` (5.79:1) from 1.52:1
 * to 1.26:1, because the AA floor sits inside the gap the two greys
 * used to have. They stay two visibly different greys, and the cheaper
 * fix - lifting `neutral` as well to reopen the gap - was not taken:
 * `neutral` already passes, it is the far more used of the two, and
 * making ordinary "draft" and "received" chips brighter would be a
 * louder product for no accessibility gain.
 */
export const PILL_COLORS = {
  neutral: '#9C9CA6',
  quiet: '#8A8A94',
  gold: PILL_DEFAULT,
  waiting: '#FBBF24',
  good: '#34D399',
  flagged: '#F87171',
  info: '#38BDF8',
} as const;

export type PillTone = keyof typeof PILL_COLORS;

/*
 * The same seven states on a LIGHT ground.
 *
 * The block above measured two grounds, both near-black, because in
 * early 2026 those were the only grounds a chip could land on. Light
 * counsel shipped afterwards and nothing re-measured this file. On
 * `.counsel-shell:not(.dark)` the tightest surface is #eeeef1 and the
 * whole palette collapses there: the worst of the seven is `waiting`
 * at 1.38:1 and the best is `quiet` at 2.70:1, so every chip in the
 * light workspace was under the floor, not just the red one.
 *
 * ONE HEX CANNOT SERVE BOTH GROUNDS, and that is arithmetic rather
 * than taste. Write Yt for the label's luminance and Yf for the fill's.
 * Clearing 4.5:1 on the near-black page needs Yf <= (Yt + 0.05) / 4.5
 * minus 0.05, and clearing it on the near-white chip needs
 * Yf >= 4.5 * (Yt + 0.05) minus 0.05. Both at once would need
 * 4.5 * (Yt + 0.05) <= (Yt + 0.05) / 4.5, which is 20.25 <= 1. No
 * colour of any hue satisfies that, so a second set of values is the
 * only option and the choice is only how it gets selected.
 *
 * HOW THESE WERE DERIVED. Same shape as lib/accent-text.ts: keep the
 * OKLCH hue, keep the colour's own chroma clamped into sRGB, and pin
 * the lightness. Pinning lightness is what buys the floor for every
 * hue at once, and keeping each colour's own chroma is what stops the
 * palette flattening into seven versions of the same muddy mid-tone.
 *
 * Two departures from a single pinned lightness, both for separation
 * rather than for contrast:
 *
 *   `neutral` sits at L 0.44 and `quiet` at L 0.49. On the dark ground
 *   `neutral` is the brighter grey and `quiet` the dimmer one; on a
 *   light ground "more prominent" means darker, so the pair inverts.
 *   The step between them is 1.24:1 here against 1.26:1 on dark, so
 *   they stay as distinguishable as they already were.
 *
 *   `gold` is held to chroma 0.050 rather than its own 0.084. Gold and
 *   `waiting` are the SAME hue (87 and 84 degrees) and are told apart
 *   only by saturation: gold is the muted one, amber the vivid one.
 *   At L 0.48 sRGB caps yellow at about 0.098 chroma, which drags
 *   amber down to within a whisker of gold and makes the portal's
 *   "awaiting you" and "due soon" chips, which sit side by side in
 *   app/portal/page.tsx, read as one colour. Halving gold's chroma
 *   restores roughly the dark ratio between them.
 *
 * The weakest value here is `good` at 4.65:1 on the tightest light
 * counsel surface, which is in keeping with the light counsel ink
 * ramp's own weakest at 4.63:1. tests/accent-text.test.ts measures
 * every one of them on every surface that shell paints.
 */
export const PILL_COLORS_LIGHT: Record<PillTone, string> = {
  neutral: '#52515A',
  quiet: '#5F5F69',
  gold: '#6A5C3C',
  waiting: '#775800',
  good: '#006F4D',
  flagged: '#A7242F',
  info: '#00668C',
};

/**
 * Every light twin, keyed by the dark hex it replaces.
 *
 * Callers hand the chip a COLOUR, not a state name: lib/firm-types.ts,
 * lib/portal-status.ts and twenty page-local maps all resolve their own
 * vocabulary down to one of the hexes above before StatusPill ever sees
 * it. Keying the twin off the value rather than off the name is what
 * lets the light ground arrive without touching any of them.
 */
const LIGHT_TWIN: Record<string, string> = Object.fromEntries(
  (Object.keys(PILL_COLORS) as PillTone[]).map((tone) => [
    PILL_COLORS[tone].toUpperCase(),
    PILL_COLORS_LIGHT[tone],
  ]),
);

/**
 * One status colour, as a CSS value that follows the shell it is
 * painted in. `alpha` is appended to both halves, so pass the two hex
 * digits the chip already uses ('1a' for the fill, '40' for the edge)
 * and nothing else changes about how those layers are built.
 *
 * WHY `light-dark()` AND NOT A CSS VARIABLE. The variable would have to
 * be declared in app/globals.css, and the whole point of this palette
 * living in a leaf module is that a server-only caller can read it
 * without loading the stylesheet or a React component. `light-dark()`
 * resolves against `color-scheme`, which app/globals.css already
 * declares on exactly the elements that carry the theme: `light` on
 * `:root` and on `.counsel-shell:not(.dark)`, `dark` on `.dark`, the
 * enterprise shell and the HQ shell. That is the same signal the native
 * form controls follow, so a chip and a date picker cannot disagree
 * about which theme they are in. Every StatusPill call site is under
 * `/counsel` or `/portal` and therefore inside one of those shells; no
 * chip is rendered through a portal to document.body.
 *
 * If a browser does not support `light-dark()` the declaration is
 * dropped rather than mis-resolved: the label falls back to inherited
 * body text, which the shell has already proved legible on its own
 * ground, and the chip loses its tint and edge. That is a plain chip
 * rather than an unreadable one.
 */
export function pillInk(color: string, alpha = ''): string {
  const light = LIGHT_TWIN[color.toUpperCase()];
  return light
    ? `light-dark(${light}${alpha}, ${color}${alpha})`
    : `${color}${alpha}`;
}
