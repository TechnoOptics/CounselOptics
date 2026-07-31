/**
 * Bella token packages + tier grant table.
 *
 * Strategy: docs/TOKEN_ECONOMY.md
 *
 * Margins are baked into the tokens-per-dollar ratio. The smallest
 * pack (Boost) is the highest-margin one because heavy users will
 * graduate to bigger packs that we discount on a sliding scale.
 *
 * Stripe Price IDs ship as env vars so we can swap the products
 * without a code change. When the env var is missing the pack is
 * still listed in the UI but its CTA disables - we don't want to
 * accidentally charge against the wrong product.
 */

export type TierSlug =
  | 'free'
  // Consumer ("personal") paid ladder. See lib/personal-tiers.ts for the
  // canonical prices / case caps / feature unlocks keyed off these slugs.
  | 'starter'
  | 'plus'
  | 'premium'
  | 'ultra'
  | 'pro'
  | 'pro_plus'
  | 'solo'
  | 'small_firm'
  | 'growing_firm'
  | 'enterprise'
  // Legacy tiers from the previous billing model. Kept so existing
  // subscriptions keep granting; new sales should land on one of
  // the slugs above.
  | 'basic'
  | 'standard';

export type TokenPackage = {
  id: 'boost' | 'boost_plus' | 'power' | 'mega';
  label: string;
  /** USD price in cents (Stripe billable). */
  priceCents: number;
  /** Tokens credited on success. */
  tokens: number;
  /** Stripe Price ID env var name. */
  stripePriceEnv: string;
  /** Marketing blurb on the billing UI. */
  blurb: string;
  /** True for the highlighted recommended package. */
  recommended?: boolean;
};

export const TOKEN_PACKAGES: TokenPackage[] = [
  {
    id: 'boost',
    label: 'Boost',
    priceCents: 499,
    tokens: 200_000,
    stripePriceEnv: 'STRIPE_PRICE_TOKEN_BOOST',
    blurb: '~5 quick Bella tasks. Perfect when you bump up to the cap mid-task.',
  },
  {
    id: 'boost_plus',
    label: 'Boost+',
    priceCents: 1999,
    tokens: 1_000_000,
    stripePriceEnv: 'STRIPE_PRICE_TOKEN_BOOST_PLUS',
    blurb: '~25 normal Bella sessions. The sweet spot for active months.',
    recommended: true,
  },
  {
    id: 'power',
    label: 'Power',
    priceCents: 4999,
    tokens: 3_000_000,
    stripePriceEnv: 'STRIPE_PRICE_TOKEN_POWER',
    blurb: '~75 Bella sessions or one heavy drafting / review push.',
  },
  {
    id: 'mega',
    label: 'Mega',
    priceCents: 9999,
    tokens: 7_000_000,
    stripePriceEnv: 'STRIPE_PRICE_TOKEN_MEGA',
    blurb: 'Best per-token rate. ~175 sessions, or one big litigation week.',
  },
];

export function getTokenPackage(id: string): TokenPackage | null {
  return TOKEN_PACKAGES.find((p) => p.id === id) ?? null;
}

/**
 * Tokens credited on each subscription period start, by tier. The
 * Stripe webhook on `customer.subscription.created` /
 * `invoice.payment_succeeded` calls grantMonthlyTokens(tier) with
 * the user's current tier; the function reads this map.
 *
 * Numbers come from docs/TOKEN_ECONOMY.md - sized to cover normal
 * usage with ~20% headroom. Heavy users who exceed buy top-ups,
 * which is where the margin growth lives.
 */
export const MONTHLY_TOKEN_GRANT: Record<TierSlug, number> = {
  free: 25_000,
  // Personal ladder (mirrors lib/personal-tiers.ts monthlyTokens).
  starter: 150_000,
  plus: 500_000,
  premium: 1_500_000,
  ultra: 3_000_000,
  pro: 500_000,
  pro_plus: 1_500_000,
  solo: 2_500_000,
  small_firm: 4_000_000,
  // Growing trimmed from 8M to 6M (2026-05-12). At 8M the per-seat
  // token cost was $76 against a $149 price, leaving only ~45% margin.
  // 6M brings the cost to $57, lifting margin to ~55% in line with
  // the rest of the firm ladder. Heavy users buy Boost packs (which
  // are high-margin) for the marginal demand.
  growing_firm: 6_000_000,
  enterprise: 15_000_000,
  // Legacy tiers - keep their old grants until migrated.
  basic: 100_000,
  standard: 500_000,
};

/**
 * Cap for roll-over of unused tokens. Multi-seat tiers pool to the
 * firm balance instead, so this only applies to user-balance tiers.
 *
 * Set at 2x the monthly grant: a user who tops up beyond this
 * sees the excess credited but the FREE-with-subscription portion
 * caps to keep us from accidentally giving away a year of grants
 * to a dormant subscription.
 */
export const ROLLOVER_MULTIPLIER = 2;

/**
 * Per-seat firm-pool grant. The firm gets pool = seat_count *
 * FIRM_POOL_GRANT[tier]. Pool is consumed first on any debit
 * triggered while the user is in firm context.
 */
export const FIRM_POOL_GRANT: Record<TierSlug, number> = {
  free: 0,
  starter: 0,
  plus: 0,
  premium: 0,
  ultra: 0,
  pro: 0,
  pro_plus: 0,
  solo: 0, // single seat - personal balance is enough
  small_firm: 4_000_000,
  // Trimmed alongside MONTHLY_TOKEN_GRANT for margin parity.
  growing_firm: 6_000_000,
  enterprise: 15_000_000,
  basic: 0,
  standard: 0,
};

/**
 * Items included per tier without an overage charge. An "item" is a
 * case, a contract, OR a vault folder - one shared budget per user
 * (or per attorney on firm tiers). When the count exceeds the limit,
 * every extra item silently consumes ITEM_OVERAGE_TOKENS_PER_MONTH
 * tokens from the user's monthly grant on the next billing cycle.
 *
 * A value of `null` means uncapped (Enterprise only, negotiated).
 *
 * Rationale: 'Unlimited' is a pricing-churn risk - one heavy user
 * subsidizes the rest of the tier and we can't model unit economics.
 * Cap + token overage keeps the price ladder honest and lets heavy
 * users pay the marginal cost of their usage without surprise bills.
 */
export const TIER_ITEM_LIMITS: Record<TierSlug, number | null> = {
  free: 1,
  // Personal ladder case/item caps (mirrors lib/personal-tiers.ts caseLimit).
  starter: 3,
  plus: 8,
  premium: 15,
  ultra: 40,
  pro: 20,
  pro_plus: 50,
  // Solo bumped from 20 to 30 (2026-05-12) to match the typical
  // working-solo-attorney's caseload (20-40 active matters). 20 was
  // tight enough that 'Clio offers unlimited' would have been a real
  // sticker-shock objection on the pricing page. Cost to us: zero -
  // a stale matter is essentially free. Heavy Bella use on those
  // matters is what we actually meter via tokens.
  solo: 30,
  small_firm: 50,
  growing_firm: 100,
  enterprise: null, // negotiated, typically uncapped
  // Legacy tiers - generous caps so existing customers don't get a
  // surprise on the new billing surface. Migrate at renewal.
  basic: 20,
  standard: 50,
};

/**
 * Token cost per overage item per month. Debited from the user's
 * token balance on the billing cycle. Consumer/Solo tiers pay 25K;
 * larger firm tiers get a per-item discount because their token
 * grants are bigger and the per-matter overhead is amortized across
 * more seats.
 *
 * At our blended ~$0.0000095/token cost basis: 25K tokens ≈ $0.24
 * platform cost, ~$0.62 retail-equivalent via the Boost pack. That's
 * a slim per-item charge that scales gracefully into the next tier.
 */
export const ITEM_OVERAGE_TOKENS_PER_MONTH: Record<TierSlug, number> = {
  free: 0, // no overage allowed - Free is a single-case ceiling
  starter: 25_000,
  plus: 25_000,
  premium: 25_000,
  ultra: 25_000,
  pro: 25_000,
  pro_plus: 25_000,
  solo: 50_000,
  small_firm: 50_000,
  growing_firm: 30_000, // larger pool, smaller per-item charge
  enterprise: 0, // uncapped, no overage charge
  basic: 25_000,
  standard: 25_000,
};

/**
 * Human-readable item-limit label for the UI. Returns 'Uncapped' for
 * Enterprise / null limits and 'N items' otherwise.
 */
export function itemLimitLabel(tier: TierSlug): string {
  const limit = TIER_ITEM_LIMITS[tier];
  if (limit === null) return 'Uncapped';
  return `${limit} items`;
}

/**
 * Turn the Anthropic usage record into the user-facing token cost.
 * Cached input is half-priced (covers our overhead); output is 5x
 * fresh input (matches Anthropic's pricing ratio). Round up so we
 * never under-bill.
 */
export function billableTokensFromUsage(usage: {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number {
  const fresh = Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0));
  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  const out = Math.max(0, usage.outputTokens);
  return Math.ceil(cached * 0.5 + fresh * 1.0 + out * 5.0);
}

/**
 * Return the effective margin on a top-up package, given our blended
 * cost-per-token ($0.0000095 average across input + output mixes).
 * Used in the docs + admin diagnostics; not exposed to end users.
 */
export function packageMargin(pack: TokenPackage): { cost: number; profit: number; pct: number } {
  const cost = pack.tokens * 0.0000095;
  const profit = pack.priceCents / 100 - cost;
  const pct = profit / (pack.priceCents / 100);
  return { cost, profit, pct };
}
