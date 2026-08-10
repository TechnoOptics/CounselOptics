import type Stripe from 'stripe';
import { createAdminSupabase } from './supabase/admin';
import { grantFirmPoolTokens } from './token-economy';
import { FIRM_POOL_GRANT, type TierSlug } from './token-packages';

/**
 * Bridge between a Stripe subscription and the firm pool it funds.
 *
 * The firm pool is a recurring entitlement: every multi-seat tier is
 * supposed to receive seats * FIRM_POOL_GRANT[tier] tokens each period
 * (lib/token-packages.ts), and /counsel/billing/tokens tells firm owners
 * their pool "Renews <date>" off firms.token_pool_period_end. Nothing
 * issued it - grantFirmPoolTokens had no caller at all, so the column was
 * only ever written by top-ups, and the renewal the UI promised silently
 * never happened. This module is the missing call path; the Stripe webhook
 * calls grantFirmPoolForSubscriber() next to grantTierMonthlyTokens().
 *
 * NOT a server-action module on purpose: lib/token-economy.ts carries
 * 'use server', so anything exported from there is a callable endpoint.
 * These helpers take a raw user id and credit a shared balance, so they
 * stay in a plain module that only server code can reach.
 */

/**
 * Which firm does this subscriber's plan pay for?
 *
 * A firm has no billing entity of its own - "the firm's plan" is its
 * creator's personal subscription. That is not a convention invented here:
 * isFirmSubscriptionActive() in lib/firm-storage.ts already decides whether
 * a firm's plan is live by reading firms.created_by's subscription, so the
 * pool has to be credited against exactly the same link or a firm could be
 * treated as paid-up while its pool went to some other row.
 *
 * Returns null when the subscriber created no firm - the common case, since
 * most subscriptions are personal-ladder consumers.
 */
export async function firmFundedBySubscriber(
  userId: string,
): Promise<string | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data, error } = await admin
    .from('firms')
    .select('id, created_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: true });
  if (error) {
    // postgrest resolves with { error } rather than throwing, so an
    // unchecked read here would look like "this user owns no firm" and
    // silently skip a grant the firm paid for.
    console.error(
      `[firm-billing] firm lookup for subscriber failed: ${error.message ?? 'unknown'}`,
    );
    return null;
  }

  const firms = (data ?? []) as Array<{ id: string; created_at: string }>;
  if (firms.length === 0) return null;
  if (firms.length === 1) return firms[0].id;

  // One user, several firms, one subscription: genuinely ambiguous, and
  // skipping the grant entirely would reintroduce the bug this fixes. Prefer
  // the firm they actually work in, and otherwise take the oldest so the
  // choice is at least stable across deliveries - an idempotency claim keyed
  // on a firm that changed between renewals would double-grant.
  const { data: profile } = await admin
    .from('profiles')
    .select('active_firm_id')
    .eq('id', userId)
    .maybeSingle();
  const activeFirmId = (profile as { active_firm_id?: string | null } | null)
    ?.active_firm_id;
  if (activeFirmId && firms.some((f) => f.id === activeFirmId)) {
    return activeFirmId;
  }
  return firms[0].id;
}

/**
 * Seats billed on a subscription. Firm tiers price per seat ($99/user/month
 * on Small Firm, see lib/firm-pricing.ts), so the line item's quantity is
 * what the firm actually bought and therefore what the pool is sized from.
 *
 * Falls back to 1 rather than 0 for a flat-rate item (negotiated Enterprise
 * contracts are not sold per seat): the tier still owes its base grant, and
 * grantFirmPoolTokens treats seats <= 0 as "no grant".
 */
export function seatsFromSubscription(sub: Stripe.Subscription): number {
  const quantity = sub.items?.data?.[0]?.quantity;
  return typeof quantity === 'number' && quantity > 0 ? quantity : 1;
}

/**
 * Credit the firm pool for a subscription period, if this subscription is
 * on a tier that has one. Safe to call for every subscriber: personal and
 * Solo tiers have a zero per-seat grant and return without touching
 * anything, and the grant itself is idempotent per (firm, periodEnd), so a
 * redelivered Stripe event is a no-op.
 */
export async function grantFirmPoolForSubscriber(input: {
  userId: string;
  tier: TierSlug | null;
  seats: number;
  periodEnd: string;
}): Promise<{ granted: boolean; firmId: string | null }> {
  const { tier } = input;
  if (!tier || (FIRM_POOL_GRANT[tier] ?? 0) <= 0) {
    return { granted: false, firmId: null };
  }
  const firmId = await firmFundedBySubscriber(input.userId);
  if (!firmId) return { granted: false, firmId: null };

  const result = await grantFirmPoolTokens({
    firmId,
    tier,
    seats: input.seats,
    periodEnd: input.periodEnd,
  });
  return { granted: result.granted, firmId };
}
