import Stripe from 'stripe';
import type { Tier } from './types';
import type { TierSlug } from './token-packages';
import { resolvePriceEntitlement } from './entitlements';

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  cached = new Stripe(key);
  return cached;
}

export function getPriceForTier(tier: Tier): string | undefined {
  switch (tier) {
    case 'basic':
      return (
        process.env.STRIPE_PRICE_BASIC?.trim() ||
        process.env.STRIPE_MONTHLY_PRICE_ID?.trim() ||
        undefined
      );
    case 'standard':
      return (
        process.env.STRIPE_PRICE_STANDARD?.trim() ||
        process.env.STRIPE_MONTHLY_PRICE_ID?.trim() ||
        undefined
      );
    case 'pro':
      return process.env.STRIPE_PRICE_PRO?.trim() || undefined;
  }
}

export function isStripeConfigured(): boolean {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return false;
  // Need at least one price configured.
  return Boolean(
    process.env.STRIPE_PRICE_BASIC?.trim() ||
      process.env.STRIPE_PRICE_STANDARD?.trim() ||
      process.env.STRIPE_PRICE_PRO?.trim() ||
      process.env.STRIPE_MONTHLY_PRICE_ID?.trim(),
  );
}

// Price -> tier resolution now lives in lib/entitlements.ts as a single
// table so the coarse Tier and the fine TierSlug can't drift. These two
// exports are kept as thin, signature-preserving delegators so every
// existing importer (webhook, checkout, billing UI) keeps working.

export function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  return resolvePriceEntitlement(priceId).tier;
}

/**
 * Resolve a Stripe Price ID to the full TierSlug used by the token economy
 * (free | pro | pro_plus | solo | small_firm | growing_firm | enterprise).
 * Delegates to the shared table in lib/entitlements.ts, where the deliberate
 * legacy-Pro divergence (STRIPE_PRICE_PRO -> null slug, so the 1.5M
 * grantProMonthlyTokens fallback fires) is documented and tested.
 */
export function tierSlugFromPriceId(
  priceId: string | null | undefined,
): TierSlug | null {
  return resolvePriceEntitlement(priceId).tierSlug;
}

export function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}
