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
