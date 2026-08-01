/**
 * Routes where the cookie dialog must not open itself over the page.
 *
 * Live audit 2026-08-01 (BR-L12): on a first visit the cookie-preferences
 * dialog opens centred with a blurred backdrop and stays there until the
 * visitor deals with it. On the domestic-violence guide that puts 911, the
 * National Domestic Violence Hotline, 988 and Crisis Text Line behind a blur
 * for someone who may be in danger and looking for a phone number.
 *
 * We do NOT drop the consent obligation on these routes. The banner still
 * mounts, still records nothing until the visitor chooses, and still shows
 * itself - it just starts as the bottom-corner pill instead of the blocking
 * modal, so the numbers stay readable and reachable while the choice is
 * still offered. The pill expands into the full dialog on tap, and moving on
 * to a non-crisis page opens the dialog normally.
 *
 * The list is written out literally rather than derived from `GUIDES` /
 * `ES_GUIDES`: `CookieBanner` is a client component mounted in the root
 * layout, so importing the guide modules here would ship the entire English
 * and Spanish guide corpus (~52 KB of prose) to every visitor on every page.
 * `tests/consumer-live-defects.test.ts` reads the content flag server-side
 * and fails if a guide marked `crisis: true` is missing from this list, so
 * the two cannot drift.
 */
export const CONSENT_DEFERRED_PATHS: readonly string[] = [
  '/guides/i-need-help-domestic-violence',
  '/es/guias/ayuda-violencia-domestica',
  // The Safe Witness alert screen: someone opening it is trying to tell
  // people where they are, not read about cookies.
  '/safe',
];

export function isConsentDeferredPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return CONSENT_DEFERRED_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}
