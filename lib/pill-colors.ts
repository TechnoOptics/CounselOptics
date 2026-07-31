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
export const PILL_COLORS = {
  neutral: '#9C9CA6',
  quiet: '#7C7C86',
  gold: PILL_DEFAULT,
  waiting: '#FBBF24',
  good: '#34D399',
  flagged: '#F87171',
  info: '#38BDF8',
} as const;
