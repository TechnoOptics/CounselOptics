import Stripe from 'stripe';
import type { Tier } from './types';
import type { TierSlug } from './token-packages';

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

export function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_BASIC?.trim()) return 'basic';
  if (priceId === process.env.STRIPE_PRICE_STANDARD?.trim()) return 'standard';
  if (priceId === process.env.STRIPE_PRICE_PRO?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID?.trim()) return 'standard';
  // New-tier price IDs map to legacy Tier values for backward compat
  // with anything that still types against Tier (basic | standard | pro).
  // The richer TierSlug mapping lives in tierSlugFromPriceId below.
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PRO?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PLUS?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SOLO?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SMALL_FIRM?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_GROWING?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_ENTERPRISE?.trim()) return 'pro';
  return null;
}

/**
 * Resolve a Stripe Price ID to the full TierSlug used by the token
 * economy. Unlike tierFromPriceId (which collapses everything to
 * basic|standard|pro for legacy callers), this returns the exact
 * tier slug: free | pro | pro_plus | solo | small_firm | growing_firm
 * | enterprise.
 *
 * Set the matching STRIPE_PRICE_* env var in Vercel once you have
 * created the corresponding Stripe Price in the Stripe dashboard.
 * Until set, the function returns null for that tier and the webhook
 * skips the grant (no crash).
 *
 * Annual versions: add `_ANNUAL` suffix to each env var name if you
 * wire annual prepay (the 20% prepay discount mentioned on /pricing).
 */
export function tierSlugFromPriceId(
  priceId: string | null | undefined,
): TierSlug | null {
  if (!priceId) return null;
  // Legacy 'basic' / 'standard' map cleanly to their TierSlug names
  // and share the same MONTHLY_TOKEN_GRANT entries. The legacy
  // STRIPE_PRICE_PRO does NOT map here on purpose: its existing
  // subscriber(s) get 1.5M tokens via the grantProMonthlyTokens
  // fallback in the webhook (PRO_MONTHLY_TOKEN_GRANT). If we mapped
  // STRIPE_PRICE_PRO -> 'pro' TierSlug, the new tier-aware path
  // would only grant 500K tokens (MONTHLY_TOKEN_GRANT['pro']) and
  // silently downgrade them at renewal. New Personal Pro customers
  // sit on STRIPE_PRICE_PERSONAL_PRO below and correctly receive
  // 500K via the new path.
  if (priceId === process.env.STRIPE_PRICE_BASIC?.trim()) return 'basic';
  if (priceId === process.env.STRIPE_PRICE_STANDARD?.trim()) return 'standard';
  if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID?.trim()) return 'standard';
  // Consumer ladder.
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PRO?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PRO_ANNUAL?.trim()) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PLUS?.trim()) return 'pro_plus';
  if (priceId === process.env.STRIPE_PRICE_PERSONAL_PLUS_ANNUAL?.trim()) return 'pro_plus';
  // Firm ladder.
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SOLO?.trim()) return 'solo';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SOLO_ANNUAL?.trim()) return 'solo';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SMALL_FIRM?.trim()) return 'small_firm';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_SMALL_FIRM_ANNUAL?.trim()) return 'small_firm';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_GROWING?.trim()) return 'growing_firm';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_GROWING_ANNUAL?.trim()) return 'growing_firm';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_ENTERPRISE?.trim()) return 'enterprise';
  if (priceId === process.env.STRIPE_PRICE_COUNSEL_ENTERPRISE_ANNUAL?.trim()) return 'enterprise';
  return null;
}

export function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}
