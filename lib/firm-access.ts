/**
 * Pure rules for whether an organization may use the product.
 *
 * No I/O, so every rule below is unit tested. lib/firm-trials.ts owns the
 * database.
 *
 * Expiry is a COMPARISON, not a flag. There is no scheduled job anywhere in
 * this feature: nothing can fail silently overnight, there is no window in
 * which a trial has lapsed but a job has not noticed, and an extension takes
 * effect on the next page load rather than the next tick.
 *
 * The clock is injected as the `now` parameter rather than read here. A module
 * that reads its own clock cannot be tested for expiry at all.
 */

/**
 * This repo's Supabase client returns timestamptz as ISO STRINGS, so a field
 * typed Date can hold a string at runtime. Declaring the union and normalising
 * on entry is what stops that becoming a fail-open.
 */
export type FirmTimestamp = Date | string;

export type FirmAccessInput = {
  trialEndsAt: FirmTimestamp | null;
  suspendedAt: FirmTimestamp | null;
};

export type FirmAccessState = 'active' | 'export_only';

export type SeatCheckInput = {
  seatLimit: number | null;
  currentMembers: number;
};

export type SeatCheckResult =
  | { ok: true }
  | { ok: false; reason: 'seat_limit_reached' };

/**
 * Normalise AND validate. Coercion alone is not enough, in two separate ways.
 *
 * `new Date('garbage')` is an Invalid Date whose comparisons are all false, so
 * a bad value would read as "not yet expired" forever.
 *
 * `new Date(null)` is worse, because it is the epoch and therefore a perfectly
 * VALID Date that the NaN check cannot see. An epoch clock sits before every
 * trial end, so a null arriving from untyped code would report every expired
 * organization as active. Rejecting anything that is not a Date or a string is
 * what closes that one.
 *
 * Throwing is the fail-closed choice: a request that cannot establish the time
 * must not be granted access on the strength of a comparison against nonsense.
 */
export function toInstant(value: FirmTimestamp): Date {
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new Error('firm-access received a timestamp that is neither a Date nor a string.');
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('firm-access received an unparseable timestamp.');
  }
  return instant;
}

export function firmAccessState(
  firm: FirmAccessInput,
  now: FirmTimestamp,
): FirmAccessState {
  const at = toInstant(now);

  // Suspension is the manual override and outranks the dates, so a date
  // change cannot accidentally reopen an organization that was closed
  // deliberately. It is checked before the trial-end null check because a
  // suspended organization that never had a trial must still be closed, and
  // the null check would otherwise return active before we ever look.
  if (firm.suspendedAt != null) return 'export_only';

  // No trial means nothing to expire. A paying organization has no
  // trial_ends_at.
  if (firm.trialEndsAt == null) return 'active';

  return at >= toInstant(firm.trialEndsAt) ? 'export_only' : 'active';
}

/**
 * Checked when an organization ADDS a member. Never used to remove one:
 * lowering a limit does not eject anyone already in place, because ejecting
 * people from a running organization to enforce a number that was just
 * changed strands work in progress. An organization over its limit simply
 * cannot add the next person.
 *
 * The limit is compared against null, not tested for truthiness, so that a
 * limit of zero stays a real limit instead of reading as unlimited.
 */
export function seatCheck(input: SeatCheckInput): SeatCheckResult {
  if (input.seatLimit == null) return { ok: true };
  if (input.currentMembers < input.seatLimit) return { ok: true };
  return { ok: false, reason: 'seat_limit_reached' };
}
