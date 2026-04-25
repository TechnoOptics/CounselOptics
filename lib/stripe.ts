import Stripe from 'stripe';
import type { Tier } from './types';

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
  return null;
}

export function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}
