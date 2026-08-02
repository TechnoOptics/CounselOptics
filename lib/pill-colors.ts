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
