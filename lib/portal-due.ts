/**
 * Shared due-date logic for the employee Hub. The dashboard, the
 * calendar, and the requests list all key off an intake's free-text
 * `due_by` answer; before this the parse + 24h grace-window check was
 * copy-pasted in each, with the grace constant hardcoded in two places
 * where it could silently drift. One source of truth now.
 */

/** An item stays "current" for 24h after its due time before it drops off. */
export const DUE_GRACE_MS = 86_400_000;

/**
 * Parse a portal intake's free-text `due_by` answer into a timestamp,
 * or null when it's absent or unparseable.
 */
export function parseDueBy(
  intakeAnswers: Record<string, unknown> | null | undefined,
): number | null {
  const v = String((intakeAnswers ?? {}).due_by ?? '').trim();
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when a due timestamp should still surface in the Hub - i.e. it's
 * in the future or within the trailing grace window.
 */
export function isDueCurrent(dueMs: number, now: number): boolean {
  return dueMs >= now - DUE_GRACE_MS;
}
