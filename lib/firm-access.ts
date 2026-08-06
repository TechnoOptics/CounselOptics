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
  // The clock is validated unconditionally, before any branch that could
  // return early. A request that cannot establish the time gets no answer at
  // all rather than an answer resting on a comparison against nonsense. Do not
  // "optimise" this below the suspension check: the cost is one parse and the
  // property being bought is that no path through this function can ever reach
  // a date comparison with an unvalidated clock.
  const at = toInstant(now);

  // A MISSING field is as dangerous as a bad value, and fails in the same
  // direction: without this check, a firm object that simply lacks suspendedAt
  // reads as fully ACTIVE, which is the permissive failure. PostgREST returns
  // null for a selected null column and never undefined, so this rejects no
  // legitimate row. It does catch a .select() that forgot the column, a row
  // round-tripped through JSON, and an optimistic in-memory firm object, all
  // of which are boundaries the type system does not police.
  //
  // The test is on the VALUE, not on key presence. A key-presence test would
  // miss `{ suspendedAt: undefined }`, which a row mapper produces easily and
  // which is just as absent in every way that matters here. Reading a missing
  // key also yields undefined, so this one condition covers both.
  //
  // Because undefined cannot get past this line, the null comparisons below
  // are reached only with a Date, a string, or null.
  if (firm.trialEndsAt === undefined || firm.suspendedAt === undefined) {
    throw new Error('firm-access received a firm without its access fields.');
  }

  // Suspension is PRESENCE, not a date: any suspendedAt at all closes the
  // organization, and the value is never compared against the clock. A
  // suspension dated in the future therefore takes effect immediately. That is
  // deliberate. If a later admin surface ever wants to schedule a suspension,
  // it needs a new field rather than a future date in this one, because
  // treating this date as an effective-from would silently leave every
  // scheduled organization open until that date arrived.
  //
  // It is also the manual override and outranks the dates, so a date change
  // cannot accidentally reopen an organization that was closed deliberately.
  // It is checked before the trial-end null check because a suspended
  // organization that never had a trial must still be closed, and the null
  // check would otherwise return active before we ever look.
  if (firm.suspendedAt != null) return 'export_only';

  // No trial means nothing to expire. A paying organization has no
  // trial_ends_at.
  if (firm.trialEndsAt == null) return 'active';

  return at >= toInstant(firm.trialEndsAt) ? 'export_only' : 'active';
}

/** Where an organization whose access has ended is sent, and can always land. */
export const ACCESS_ENDED_PATH = '/counsel/access-ended';

/**
 * The paths that are NEVER redirected, whatever the access state.
 *
 * This list is load-bearing, and getting it wrong is worse than a lockout. If
 * the access-ended page redirected to itself the browser would loop forever,
 * and an organization that can never land is an organization that can never
 * reach the data this whole design exists to preserve.
 *
 * The export endpoint and sign-out are here for the same reason even though
 * neither is routed through the counsel layout today. This list is the single
 * statement of the rule, and a future caller reaching for it from middleware
 * should not have to rediscover which paths must stay open.
 */
const ALWAYS_ALLOWED: readonly string[] = [
  ACCESS_ENDED_PATH,
  '/api/firm/export',
  '/auth/sign-out',
];

/** Static assets, which are served before any of this and never gated. */
const ALWAYS_ALLOWED_PREFIXES: readonly string[] = ['/_next/'];

/**
 * Where a request must be sent given the organization's access state, or null
 * to let it through.
 *
 * Pure, so the allowlist is unit tested rather than reasoned about. The layout
 * that calls this holds the I/O; this holds the rule.
 *
 * The switch is deliberate and must not be reduced to an equality test. A
 * third access state added later has to be a compile error here rather than a
 * silent default-allow, which is what `if (state === 'export_only')` would
 * quietly become.
 */
export function counselAccessRedirect(
  pathname: string,
  state: FirmAccessState,
): string | null {
  switch (state) {
    case 'active':
      return null;
    case 'export_only': {
      if (ALWAYS_ALLOWED.includes(pathname)) return null;
      if (ALWAYS_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))) return null;
      return ACCESS_ENDED_PATH;
    }
    default: {
      // Unreachable while FirmAccessState has two members, and a compile error
      // the moment it gains a third. Throwing rather than falling through
      // keeps the runtime behaviour fail-closed too.
      const unhandled: never = state;
      throw new Error(
        `firm-access has no redirect rule for the access state ${String(unhandled)}.`,
      );
    }
  }
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
