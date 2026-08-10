/**
 * The theme's vocabulary, in a plain module so both the server action in
 * lib/counsel-theme.ts and the client toggle can import it. A 'use
 * server' file may only export async functions, so the type and the
 * class helper cannot live there.
 */
export type CounselTheme = 'dark' | 'light';

export const COUNSEL_THEME_COOKIE = 'adv_counsel_theme';

/**
 * The class list for a counsel shell root.
 *
 * One helper rather than five copies of the same ternary, because "dark
 * unless the reader asked for light" is the single rule the whole theme
 * rests on and it should be stated once. `.dark` is what every rule in
 * the counsel half of app/globals.css keys off; `.counsel-shell` on its
 * own means light. Anything that renders a counsel shell without going
 * through here is dark, which is the safe default rather than an
 * oversight - the public and pre-auth shells do exactly that on purpose.
 */
export function counselShellClass(theme: CounselTheme, rest: string): string {
  return `${theme === 'dark' ? 'dark counsel-shell' : 'counsel-shell'} ${rest}`;
}

/**
 * The paths whose shell decides what `<html>` means by "dark".
 *
 * WHY `<html>` HAS TO FOLLOW THE SHELL, which is the bug this exists for.
 * `.dark` on `<html>` was set from the reader's CONSUMER theme and from
 * nothing else, while the counsel and portal shells were painted from
 * this separate cookie. The two disagree for anyone whose OS or profile
 * is dark and who then picks Light here, and that combination paints a
 * near-white workspace under a stylesheet that has been told the page is
 * dark. Everything keyed off `<html>` follows the wrong one:
 *
 *   - every `--surface` / `--foreground` / `--muted` token, which the
 *     light shell inherits rather than falling through to `:root`;
 *   - every `.dark .text-ink-*` rule in the per-class override block;
 *   - all 1152 `dark:` utilities written at counsel and portal call
 *     sites, which no stylesheet rule can reach.
 *
 * Measured on the rendered page: the section subtitle at 1.05:1, the
 * panel body at 1.07:1 and the secondary button's label at 1.03:1. Not
 * "low contrast" - the same colour as what is behind it.
 *
 * So the class that says "paint dark" is set from the surface actually
 * being painted. `.dark` then means one thing again, and the reader's
 * consumer preference is untouched and still governs every other route.
 *
 * `/join` and `/guest-login` are here too even though they never read
 * the cookie: they hard-code a dark shell, so shellForcesDark below
 * answers for them and `<html>` matches what they paint.
 */
export function shellOwnsHtmlTheme(pathname: string): boolean {
  return (
    pathname === '/counsel' ||
    pathname.startsWith('/counsel/') ||
    pathname === '/portal' ||
    pathname.startsWith('/portal/') ||
    pathname === '/join' ||
    pathname.startsWith('/join/') ||
    pathname === '/guest-login'
  );
}

/**
 * The counsel-family paths that paint dark whatever the cookie says.
 *
 * These are the public and pre-auth shells. Each renders its own
 * `dark counsel-shell` in the page rather than going through
 * counselShellClass, so the cookie is not what decides their theme and
 * asking it would put `<html>` a shade away from the page on the two
 * screens an outside firm sees first.
 */
export function shellForcesDark(pathname: string): boolean {
  return (
    pathname === '/counsel/request' ||
    pathname === '/counsel/welcome' ||
    pathname === '/counsel/access-ended' ||
    pathname === '/counsel/guest/access-ended' ||
    pathname === '/join' ||
    pathname.startsWith('/join/') ||
    pathname === '/guest-login'
  );
}

/**
 * The class that tells `<html>` which surface's CANVAS to paint.
 *
 * WHAT THE CANVAS IS, and why a `min-h-screen` shell is not enough. A
 * browser propagates the ROOT element's background to the canvas: the
 * area it paints outside the document, which is what shows when a page
 * is dragged past its end or when the document is shorter than the
 * viewport. Every dark surface here paints its colour on a `div`, so
 * the canvas kept coming from `html`, which is #ffffff in light and the
 * CONSUMER forest #0a1f19 in dark. Captured past the end of the
 * document: /join ends in near-black and the strip below it is pure
 * white; a dark counsel page under a dark consumer theme gets forest
 * green against a #0a0a0b workspace.
 *
 * So the shell's own colour is named on `html` as well, per family, and
 * app/globals.css keys off this class. Theme still comes from `.dark`,
 * which is what stops a value hardcoded for one theme flashing in the
 * other.
 *
 * `/enterprise` is deliberately absent. Its dark band is a section
 * INSIDE a consumer marketing page with the ordinary header and footer
 * above and below it, so the white canvas there is the right answer.
 */
export function htmlSurfaceClass(pathname: string): string | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return 'surface-hq';
  }
  return shellOwnsHtmlTheme(pathname) ? 'surface-counsel' : null;
}
