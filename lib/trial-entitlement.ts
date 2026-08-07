import type { Tier, SubscriptionStatus } from './types';
import type { TierSlug } from './token-packages';
import { entitlementForTierSlug, isEntitlementTierSlug, resolvePriceEntitlement } from './entitlements';

/**
 * What an account is entitled to once an HQ-granted trial is taken into
 * account. Pure: no I/O, no clock of its own, so every rule below is unit
 * tested. lib/user-trials.ts and lib/firm-trials.ts own the database.
 *
 * THE ONE RULE THIS MODULE EXISTS TO HOLD: a paid subscription always beats a
 * trial. A trial may lift an account that has no active paid entitlement, and
 * it may never downgrade a payer and never extend one. A trial that could
 * alter a paying customer's entitlement is a billing incident, so the rule is
 * built into the SHAPES rather than into the order of two lines:
 *
 *   applyTrialToUnpaid accepts the `unpaid` member of PaidEntitlement and
 *   nothing else. `{ kind: 'paid', ... }` is not assignable to it, so
 *   "apply the trial to a payer" does not compile. Under a cast it still
 *   throws, because the function re-asserts the discriminant at runtime.
 *
 * Reordering the branches of resolveAccountEntitlement therefore cannot make
 * a trial win. Someone would have to change a signature, add a cast, and
 * delete a throw, and tests/trial-entitlement.test.ts kills each of those.
 *
 * THE SECOND RULE: the trial's plan level is a level this product SELLS.
 * lib/entitlements.ts owns that vocabulary and derives it from the price
 * table, so a trial cannot name a tier that no price grants and cannot reach
 * the legacy grandfathered grant. Anything outside it resolves to no trial,
 * which is the fail-closed direction.
 *
 * THE THIRD RULE: expiry is validated, not coerced. The end date arrives from
 * PostgREST as an ISO STRING even where a field is typed Date, and
 * `new Date('garbage')` is an Invalid Date whose comparisons are ALL false,
 * so a bare coercion reads as "not yet expired" forever. `new Date(null)` is
 * worse: the epoch, a valid Date that no NaN check can see, sitting before
 * every trial end. Both are rejected below, and rejection means no uplift.
 */

/** Mirrors lib/firm-access.ts: the same value can arrive either way. */
export type TrialTimestamp = Date | string;

/**
 * The paid half of the answer, as a discriminated union rather than a
 * nullable entitlement.
 *
 * `{ kind: 'paid', tier: null, tierSlug: null }` is a real and important
 * state: somebody with a live subscription on a price this build does not
 * recognise. They are still a payer, and a trial must not touch them. A
 * nullable entitlement could not tell that apart from having no subscription
 * at all, which is exactly the pair that must not be collapsed.
 */
export type PaidEntitlement =
  | { kind: 'paid'; tier: Tier | null; tierSlug: TierSlug | null }
  | { kind: 'unpaid' };

/** The only value applyTrialToUnpaid accepts. See the note at the top. */
export const UNPAID: Extract<PaidEntitlement, { kind: 'unpaid' }> = Object.freeze({
  kind: 'unpaid',
});

/** What HQ stored on the account. Both halves come out of a database row. */
export type TrialGrant = {
  /** A text column, so it is a string at best and anything at worst. */
  trialTierSlug: string | null;
  trialEndsAt: TrialTimestamp | null;
};

export type EntitlementSource = 'paid' | 'trial' | 'none';

export type ResolvedEntitlement = {
  source: EntitlementSource;
  tier: Tier | null;
  tierSlug: TierSlug | null;
};

const NO_ENTITLEMENT: ResolvedEntitlement = Object.freeze({
  source: 'none',
  tier: null,
  tierSlug: null,
});

/**
 * The subscription statuses the rest of this codebase already treats as live:
 * lib/tier.ts, lib/firm-storage.ts and lib/community-actions.ts all test for
 * exactly these two. Naming a third set here would be a third answer to "is
 * this person a customer", so this is that same pair and no other.
 *
 * A subscription outside this pair is NOT paid for the purposes of a trial,
 * which is what lets HQ put a lapsed account on a trial at all.
 */
const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing'];

/**
 * Reads a subscription row into the paid half of the answer.
 *
 * The price is resolved through the SAME table every other entitlement
 * decision uses. Nothing here invents a tier.
 */
export function paidFromSubscription(
  sub: { status: SubscriptionStatus | string | null; priceId?: string | null } | null | undefined,
): PaidEntitlement {
  if (!sub) return UNPAID;
  if (!LIVE_SUBSCRIPTION_STATUSES.includes(sub.status as SubscriptionStatus)) {
    return UNPAID;
  }
  const { tier, tierSlug } = resolvePriceEntitlement(sub.priceId ?? null);
  return { kind: 'paid', tier, tierSlug };
}

/**
 * Validate, do not merely coerce. Returns null for anything that is not a
 * real instant, and null here means NO TRIAL rather than an unbounded one.
 *
 * This returns null where lib/firm-access.ts toInstant throws, and the
 * difference is deliberate. There, a bad timestamp would decide whether an
 * organization may use the product at all, so refusing to answer is right.
 * Here the worst case is an uplift, and declining the uplift is already the
 * closed direction; throwing would additionally take down every page that
 * renders a plan badge because one row holds a bad string.
 */
function instantOrNull(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The clock, which is validated by THROWING rather than by returning null.
 *
 * A missing or unreadable trial end is a fact about one account. A clock this
 * process cannot read is a fault in the caller, and every account resolved
 * under it would silently get the wrong answer, so it must not resolve at
 * all.
 */
function requireInstant(value: TrialTimestamp): Date {
  const at = instantOrNull(value);
  if (!at) {
    throw new Error('trial-entitlement was given a clock it could not read.');
  }
  return at;
}

/**
 * The trial's own answer, for an account that has no paid entitlement.
 *
 * The parameter type is the half of the union that is not paid. That is the
 * structural half of the rule at the top of this file; the throw is the
 * runtime half, and it exists because a `as never` cast at the call site
 * would otherwise slip past the compiler.
 */
export function applyTrialToUnpaid(
  base: Extract<PaidEntitlement, { kind: 'unpaid' }>,
  trial: TrialGrant,
  now: TrialTimestamp,
): ResolvedEntitlement {
  if ((base as { kind?: unknown })?.kind !== 'unpaid') {
    throw new Error(
      'trial-entitlement was asked to apply a trial to a paid account. A paid subscription always beats a trial.',
    );
  }

  const at = requireInstant(now);

  // A level that names no plan this product sells grants nothing. Checked
  // before the date so a stored typo can never depend on the calendar.
  if (!isEntitlementTierSlug(trial.trialTierSlug)) return NO_ENTITLEMENT;

  // A level with no end date has no window, so it never starts rather than
  // never ending. The permissive reading of that pair is the expensive one.
  const endsAt = instantOrNull(trial.trialEndsAt);
  if (!endsAt) return NO_ENTITLEMENT;

  // Same comparison firmAccessState makes: at the end instant it is over.
  if (at.getTime() >= endsAt.getTime()) return NO_ENTITLEMENT;

  const { tier, tierSlug } = entitlementForTierSlug(trial.trialTierSlug);
  return { source: 'trial', tier, tierSlug };
}

/**
 * The whole answer for one account at one instant.
 *
 * The switch is exhaustive on purpose. A third member of PaidEntitlement
 * added later has to be a compile error here rather than a silent fall
 * through to the trial branch, which is what an `if` would quietly become.
 */
export function resolveAccountEntitlement(
  paid: PaidEntitlement,
  trial: TrialGrant,
  now: TrialTimestamp,
): ResolvedEntitlement {
  switch (paid.kind) {
    case 'paid':
      // The trial is not even in scope for this branch. It is not consulted,
      // not compared, and not allowed to extend anything.
      return { source: 'paid', tier: paid.tier, tierSlug: paid.tierSlug };
    case 'unpaid':
      return applyTrialToUnpaid(paid, trial, now);
    default: {
      const unhandled: never = paid;
      throw new Error(
        `trial-entitlement has no rule for the paid state ${JSON.stringify(unhandled)}.`,
      );
    }
  }
}

/**
 * Whole days from `now` until the trial ends, negative once it has passed,
 * and null when there is no readable end date.
 *
 * Lives here rather than in a page so the HQ firm view and the HQ user view
 * count the same way, and so both renders of either read one server-computed
 * number instead of disagreeing about what day it is.
 */
export function trialDaysRemaining(
  trialEndsAt: TrialTimestamp | null,
  now: TrialTimestamp,
): number | null {
  const endsAt = instantOrNull(trialEndsAt);
  if (!endsAt) return null;
  const at = instantOrNull(now);
  if (!at) return null;
  return Math.ceil((endsAt.getTime() - at.getTime()) / 86_400_000);
}
