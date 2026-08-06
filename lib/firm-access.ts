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
  // Joining a DIFFERENT organization is not using the one whose access
  // ended. This gate runs on the user's ACTIVE firm, so without this line an
  // attorney whose current organization has lapsed can never open an
  // invitation from an organization that pays: every click lands them back on
  // the access-ended page with no way through. The write side is already
  // right, because acceptFirmInvitationAction gates on the INVITING firm, so
  // only the shell needed fixing. Nothing here grants access to the lapsed
  // organization's data; the page behind this path is an invitation.
  '/counsel/accept-invite',
];

/** Static assets, which are served before any of this and never gated. */
const ALWAYS_ALLOWED_PREFIXES: readonly string[] = ['/_next/'];

/**
 * Retrieval routes, which are exempt for the same reason the export is.
 *
 * The organization-wide export names evidence files it cannot carry: the
 * bytes behind `case_timeline_events.media` stay in the `exhibits` bucket,
 * because base64 inflates an archive by about a third, evidence is where the
 * volume lives, and embedding it properly means a container format hand-rolled
 * under the no-new-dependencies rule. An export that lists files nobody can
 * open hands back an index, not the data.
 *
 * So `app/counsel/cases/[id]/evidence/download/route.ts` stays reachable. Its
 * own authorization is untouched and is what actually protects it: signed in,
 * a member of the matter's firm or a case-scoped co-counsel guest, and the
 * matter has to belong to that firm. This exemption only says the ACCESS
 * STATE does not close it, exactly as `/api/firm/export` above.
 *
 * WHAT THAT ROUTE DOES NOT COVER, because this list used to claim it did:
 * `public.exhibits` is a different table with a `storage_path` of its own,
 * written by lib/migration-actions.ts and served by `/api/files/<id>`. The
 * download route reads `case_timeline_events.media` and nothing else, so
 * naming exhibits.storage_path here was an over-claim.
 *
 * `/api/files/<id>` is deliberately NOT added, and the reason is NOT that the
 * route is unprotected. It is protected. The handler carries no authorization
 * statement of its own, which is what makes it read as open, but it resolves
 * the exhibit through `getExhibitById` in lib/storage.ts: in Supabase mode
 * that returns null when there is no signed-in user, and otherwise reads
 * through the CALLER'S OWN RLS-scoped client. `public.exhibits` has RLS
 * enabled with `exhibits_select_own_or_collaborator using
 * (public.is_case_member(case_id))`, so an anonymous caller and a signed-in
 * non-member both get a 404 and the row is filtered out before any signed URL
 * is minted.
 *
 * It is left off this list for two other reasons. The path is not under
 * `/counsel/`, so counselAccessRedirect would never see it under any future
 * middleware reusing this list, and a path this rule cannot reach does not
 * belong in a list of this rule's decisions. And whether a lapsed
 * organization should still reach CONSUMER-side exhibits is genuinely
 * undecided; this list records decisions rather than defers them.
 *
 * What is worth naming, because it is easy to miss: that route's
 * authorization is IMPLICIT and REMOTE. It lives in a storage helper rather
 * than in the route, no test pins it, and refactoring `getExhibitById` onto
 * the admin client would open the route silently with nothing failing.
 * Several firm paths already use the admin client precisely because
 * `is_case_member` is not firm-aware, so that refactor is plausible rather
 * than hypothetical. That is a latent fragility worth a test, not a live hole.
 *
 * The three sibling read-only routes below received the same guest-suspension
 * treatment as the download route and belong here for the same reason: this
 * list is the single statement of the rule, and a future middleware or layout
 * reaching for it must find every deliberate exemption written down rather
 * than rediscover them one lockout at a time. Listing them changes nothing
 * today, because a route handler renders no layout.
 *
 * Patterns rather than literals because the ids are in the path. Each is
 * anchored at both ends and no id segment can contain a slash, so nothing
 * nested underneath is opened by them.
 */
const RETRIEVAL_PATTERNS: readonly RegExp[] = [
  /^\/counsel\/cases\/[^/]+\/evidence\/download\/?$/,
  /^\/counsel\/cases\/[^/]+\/export\/?$/,
  /^\/counsel\/cases\/[^/]+\/approach\/[^/]+\/export\/?$/,
  /^\/counsel\/cases\/[^/]+\/search-index\/?$/,
];

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
      if (RETRIEVAL_PATTERNS.some((p) => p.test(pathname))) return null;
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
 * The stable, machine-readable IDENTITY of an access-ended refusal.
 *
 * The user-facing message is copy, and copy gets edited. A catch that matches
 * on the message is not identity: one word change, or one straight apostrophe
 * where a curly one used to be, silently converts a targeted catch into a
 * catch-nothing, and nothing fails when it does. This constant is deliberately
 * not a sentence so that nobody is ever tempted to reword it.
 *
 * It lives in this pure module rather than next to the class in
 * lib/firm-authz.ts because the code that has to RECOGNISE the refusal is
 * app/counsel/error.tsx, a client component, and firm-authz is `server-only`.
 */
export const ACCESS_ENDED_CODE = 'FIRM_ACCESS_ENDED';

/** The `name` the thrown Error subclass carries, matched below. */
export const ACCESS_ENDED_ERROR_NAME = 'FirmAccessEndedError';

/**
 * Whether a caught value is the access-ended refusal.
 *
 * Three properties are checked because the error crosses a boundary that
 * keeps different ones. In process, the class instance keeps `name` and
 * `code`. Across the server-to-client boundary of a Next error boundary the
 * value arrives as a plain object, and in production the message is redacted
 * before it gets there; `digest` is the field Next carries through, which is
 * why FirmAccessEndedError sets it to this same code.
 *
 * The message is never consulted, on purpose. See ACCESS_ENDED_CODE.
 */
export function isAccessEndedError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { name?: unknown; code?: unknown; digest?: unknown };
  if (e.code === ACCESS_ENDED_CODE) return true;
  if (e.name === ACCESS_ENDED_ERROR_NAME) return true;
  return typeof e.digest === 'string' && e.digest.includes(ACCESS_ENDED_CODE);
}

/**
 * The digest an error boundary may SHOW a person, or null.
 *
 * A digest is normally an opaque hash Next generates so a user can quote a
 * support reference without the server's message being leaked to the browser.
 * `FirmAccessEndedError` sets its own digest to ACCESS_ENDED_CODE, because
 * that is the only field Next carries across the boundary and identity has to
 * survive the crossing. That made the digest READABLE, and a boundary that
 * prints it raw shows a locked-out user the literal string
 * `Reference: FIRM_ACCESS_ENDED`.
 *
 * The rule is general rather than a check for this one code, because the next
 * named digest anyone adds would leak the same way: Next's generated digest is
 * a decimal hash, so anything else on the error was put there by this codebase
 * and is an internal identifier meant to be RECOGNISED, not displayed.
 */
export function displayableDigest(digest: unknown): string | null {
  if (typeof digest !== 'string') return null;
  return /^[0-9]+$/.test(digest) ? digest : null;
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
