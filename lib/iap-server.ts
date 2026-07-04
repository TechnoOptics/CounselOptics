import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { grantTierMonthlyTokens } from '@/lib/token-economy';
import type { Tier } from '@/lib/types';

/**
 * Server-side helpers for Apple In-App Purchase via RevenueCat.
 *
 * RevenueCat is the source of truth for whether an iOS subscription is
 * active. Two callers use this module:
 *   - /api/iap/revenuecat  (webhook)  - durable, fired by RevenueCat on
 *     every purchase/renewal/expiry.
 *   - /api/iap/sync        (client)   - called right after a purchase so
 *     the user's Pro unlocks immediately instead of waiting for the
 *     webhook; it re-reads the authoritative entitlement from RevenueCat
 *     REST so we never trust the client.
 *
 * Both converge on recordIapEntitlement(), which writes the
 * `subscriptions` row the rest of the app already reads.
 */

/** Apple product id -> our consumer tier. Mirror of IOS_PRODUCT_BY_TIER. */
const TIER_BY_IOS_PRODUCT: Record<string, Tier> = {
  'com.advottic.app.standard.monthly': 'standard',
  // Pro reuses the repurposed ASC draft id (see IOS_PRODUCT_BY_TIER in lib/iap.ts).
  'com.advottic.app.personal_pro.monthly': 'pro',
};

export function tierFromIosProduct(productId: string | null | undefined): Tier | null {
  if (!productId) return null;
  return TIER_BY_IOS_PRODUCT[productId] ?? null;
}

/**
 * Upsert the subscriptions row from an IAP entitlement. `active` true =>
 * status 'active'; false => 'canceled' (access ends at currentPeriodEnd
 * if still in the future, matching how the Stripe path behaves).
 */
export async function recordIapEntitlement(input: {
  userId: string;
  tier: Tier | null;
  active: boolean;
  productId?: string | null;
  expiresAt?: string | null;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to record IAP state.');
  }
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: input.userId,
      status: input.active ? 'active' : 'canceled',
      tier: input.tier,
      // Reuse the Stripe columns to tag the source as Apple IAP so the
      // billing UI can tell the user where to manage it (Settings ->
      // Apple ID -> Subscriptions) instead of the Stripe portal.
      stripe_subscription_id: input.productId ? `iap:${input.productId}` : null,
      stripe_customer_id: 'apple_iap',
      current_period_end: input.expiresAt ?? null,
      cancel_at_period_end: !input.active,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;

  // Grant the metered tier's monthly tokens. Without this an iOS Pro
  // buyer got a subscriptions row but token_balance stayed 0, so Bella
  // (which meters Pro) refused every turn with "You've used up your Pro
  // tokens" - i.e. they paid for the flagship feature and were locked
  // out of it. Mirror the Stripe path: grantTierMonthlyTokens dedups on
  // token_quota_period_end, so keying the period on RevenueCat's
  // expiresAt grants exactly once per billing period and again on
  // renewal (when expiresAt advances). Only 'pro' is metered; 'standard'
  // is flat-rate and unaffected by balance. Best-effort: a transient
  // grant failure is retried by the next webhook/sync (idempotent), so
  // it must not roll back the recorded entitlement.
  if (input.active && input.tier === 'pro' && input.expiresAt) {
    try {
      await grantTierMonthlyTokens({
        userId: input.userId,
        tier: 'pro',
        periodEnd: input.expiresAt,
      });
    } catch (err) {
      console.error('[recordIapEntitlement] token grant failed', err);
    }
  }
}

type RcEntitlement = {
  expires_date: string | null;
  product_identifier: string;
};

type RcSubscriber = {
  subscriber?: {
    entitlements?: Record<string, RcEntitlement>;
    subscriptions?: Record<string, { expires_date: string | null }>;
  };
};

/**
 * Authoritative read of a user's RevenueCat entitlements via the REST
 * API (v1 GET /subscribers/{app_user_id}) using the SECRET key. Returns
 * the highest active tier (pro > standard) or null if none active.
 */
export async function fetchActiveIapTier(
  appUserId: string,
): Promise<{ tier: Tier | null; active: boolean; productId: string | null; expiresAt: string | null }> {
  const secret = process.env.REVENUECAT_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error('REVENUECAT_SECRET_KEY is not configured.');
  }
  const res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    throw new Error(`RevenueCat lookup failed (${res.status}).`);
  }
  const data = (await res.json()) as RcSubscriber;
  const ents = data.subscriber?.entitlements ?? {};
  const now = Date.now();
  let best: { tier: Tier; productId: string; expiresAt: string | null } | null = null;
  const rank: Record<Tier, number> = { basic: 0, standard: 1, pro: 2 };
  for (const ent of Object.values(ents)) {
    const expMs = ent.expires_date ? Date.parse(ent.expires_date) : Infinity;
    if (expMs <= now) continue; // expired
    const tier = tierFromIosProduct(ent.product_identifier);
    if (!tier) continue;
    if (!best || rank[tier] > rank[best.tier]) {
      best = { tier, productId: ent.product_identifier, expiresAt: ent.expires_date };
    }
  }
  if (best) {
    return { tier: best.tier, active: true, productId: best.productId, expiresAt: best.expiresAt };
  }
  return { tier: null, active: false, productId: null, expiresAt: null };
}
