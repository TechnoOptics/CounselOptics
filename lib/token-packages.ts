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
  pro: 500_000,
  pro_plus: 1_500_000,
  solo: 2_500_000,
  small_firm: 4_000_000,
  growing_firm: 8_000_000,
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
  pro: 0,
  pro_plus: 0,
  solo: 0, // single seat - personal balance is enough
  small_firm: 4_000_000,
  growing_firm: 8_000_000,
  enterprise: 15_000_000,
  basic: 0,
  standard: 0,
};

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
