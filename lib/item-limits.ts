/**
 * Per-user item-budget tracking.
 *
 * An "item" is a top-level billable container: one CASE or one
 * CONTRACT. The vault is sized separately in GB on the tier
 * description (5 GB / 25 GB / 250 GB / etc.) and individual receipts
 * inside a case do NOT count toward the item budget - otherwise a
 * heavy-evidence case (100 receipts on one matter) would unfairly
 * consume the whole tier.
 *
 * Every paid tier ships with a hard item floor (TIER_ITEM_LIMITS);
 * items past the floor silently consume tokens at
 * ITEM_OVERAGE_TOKENS_PER_MONTH on the next billing cycle.
 *
 * This module is the single source of truth for:
 *   - countItemsForUser(): how many items a user owns right now
 *   - calculateOverage(): how many items past the cap, and the token
 *     cost that the next billing cycle will assess
 *   - softCheckCanCreate(): used by the create flows to decide
 *     whether to silently allow, surface a "you'll start paying" hint,
 *     or hard-block (only when the user has zero tokens AND is over)
 *
 * The Stripe webhook on `invoice.payment_succeeded` should call
 * applyMonthlyOverageDebit() before grantTierMonthlyTokens() so the
 * grant reflects the net of (grant - overage). See docs/TOKEN_ECONOMY.md
 * for the full lifecycle.
 *
 * Phase 1 (launch): callers can read counts + render the gauge. No
 * hard enforcement yet; the cap is communicated everywhere but not
 * actively debited. Phase 2 wires the Stripe webhook.
 */

import { createAdminSupabase } from './supabase/admin';
import {
  TIER_ITEM_LIMITS,
  ITEM_OVERAGE_TOKENS_PER_MONTH,
  type TierSlug,
} from './token-packages';

export type ItemCount = {
  cases: number;
  contracts: number;
  total: number;
};

/**
 * Count the user's owned items. An item is a top-level container
 * (case or contract). Sandbox cases are excluded so test data doesn't
 * trigger overage warnings. Archived cases are excluded so closed
 * matters don't haunt the user's budget forever.
 *
 * Defensive: if a table doesn't exist (older deploy, fresh tenant),
 * we silently treat its count as zero rather than throwing - the
 * gauge degrades gracefully to whatever data is available.
 */
export async function countItemsForUser(userId: string): Promise<ItemCount> {
  const admin = createAdminSupabase();
  if (!admin) {
    return { cases: 0, contracts: 0, total: 0 };
  }

  // Each query runs independently; one missing table doesn't crash
  // the whole count. settle, not all, so partial counts survive.
  const [casesResp, contractsResp] = await Promise.allSettled([
    admin
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sandbox', false)
      .neq('status', 'archived'),
    admin
      .from('user_contracts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  const cases =
    casesResp.status === 'fulfilled' ? casesResp.value.count ?? 0 : 0;
  const contracts =
    contractsResp.status === 'fulfilled'
      ? contractsResp.value.count ?? 0
      : 0;
  return { cases, contracts, total: cases + contracts };
}

export type OverageState = {
  /** Total items owned right now. */
  itemsUsed: number;
  /** Tier cap. `null` means uncapped (Enterprise). */
  itemLimit: number | null;
  /** Items past the cap (0 when at or under). */
  overage: number;
  /** Token debit the next monthly cycle will apply. */
  monthlyOverageTokens: number;
  /** True when itemsUsed exceeds itemLimit. */
  isOver: boolean;
  /** Approaching cap warning (>= 80% of cap, but not yet over). */
  isApproaching: boolean;
};

/**
 * Compute the user's overage state. Pure function over the count +
 * the tier slug; the caller is responsible for resolving the tier.
 */
export function calculateOverage(
  itemsUsed: number,
  tier: TierSlug,
): OverageState {
  const itemLimit = TIER_ITEM_LIMITS[tier] ?? null;
  if (itemLimit === null) {
    return {
      itemsUsed,
      itemLimit: null,
      overage: 0,
      monthlyOverageTokens: 0,
      isOver: false,
      isApproaching: false,
    };
  }
  const overage = Math.max(0, itemsUsed - itemLimit);
  const perItemTokens = ITEM_OVERAGE_TOKENS_PER_MONTH[tier] ?? 0;
  return {
    itemsUsed,
    itemLimit,
    overage,
    monthlyOverageTokens: overage * perItemTokens,
    isOver: overage > 0,
    isApproaching: !overage && itemsUsed >= Math.floor(itemLimit * 0.8),
  };
}

/**
 * Soft-check on item creation. Returns whether to allow the create,
 * plus an optional UI hint to surface.
 *
 * Phase 1 always allows (we're not enforcing yet). Phase 2 should
 * gate on tier-and-token-balance and return `allow: false` when both
 * the user is over AND has insufficient tokens to cover the next
 * monthly debit.
 */
export type CanCreateResult =
  | { allow: true; warn?: string }
  | { allow: false; reason: string };

export async function softCheckCanCreate(input: {
  userId: string;
  tier: TierSlug;
}): Promise<CanCreateResult> {
  const count = await countItemsForUser(input.userId);
  const state = calculateOverage(count.total, input.tier);

  // Free tier hard cap (no overage path; must upgrade).
  if (input.tier === 'free' && state.isOver) {
    return {
      allow: false,
      reason:
        'Free includes 1 item. Upgrade to Personal Pro for 20 items, or delete an existing item to make room.',
    };
  }

  // Approaching - allow with a warn so the create flow can surface it.
  if (state.isApproaching) {
    return {
      allow: true,
      warn: `${state.itemsUsed} of ${state.itemLimit} items used. Heads up - items past your tier cap will start charging from your Bella token balance at month-end.`,
    };
  }

  // Over the cap on a paid tier - allowed (token debit) with hint.
  if (state.isOver) {
    return {
      allow: true,
      warn: `You're ${state.overage} item${state.overage === 1 ? '' : 's'} over your ${state.itemLimit}-item plan. This adds about ${state.monthlyOverageTokens.toLocaleString()} tokens to your monthly debit. Consider upgrading or buying a Boost pack.`,
    };
  }

  return { allow: true };
}
