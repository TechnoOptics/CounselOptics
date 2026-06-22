'use client';

/**
 * In-App Purchase (Apple StoreKit via RevenueCat) - client wrapper.
 *
 * The iOS app is a remote-URL Capacitor WebView, so subscriptions sold
 * inside it MUST use Apple In-App Purchase (App Store Guideline 3.1.1).
 * This module is the bridge: on iOS it drives the native RevenueCat
 * plugin (which shows the Apple purchase sheet); everywhere else it
 * throws, because web + Android keep using Stripe.
 *
 * Flow:
 *   1. purchaseTier(tier, userId) - configure RevenueCat with the
 *      signed-in Supabase user id as the RevenueCat appUserID (so the
 *      webhook can map the purchase back to the account), then show the
 *      Apple sheet for that tier's product.
 *   2. On success the caller POSTs /api/iap/sync so the server reads the
 *      authoritative entitlement from RevenueCat and flips the
 *      subscriptions row to active. The RevenueCat webhook
 *      (/api/iap/revenuecat) is the durable backstop.
 *
 * The @revenuecat/purchases-capacitor plugin is loaded lazily so its
 * native bridge never pulls into the SSR bundle.
 */
import { isIOSApp } from '@/lib/platform';
import type { Tier } from '@/lib/types';

/**
 * Apple product id per PAID consumer tier. `basic` is free, so it has
 * no product. These must match the auto-renewable subscription product
 * ids created in App Store Connect (group "Advottic Personal").
 */
export const IOS_PRODUCT_BY_TIER: Partial<Record<Tier, string>> = {
  standard: 'com.advottic.app.standard.monthly',
  // The Pro product reuses the App Store Connect id `personal_pro.monthly`
  // (the original draft, repurposed) - it maps to the "Personal Pro" tier
  // shown on the pricing page, so the id is on-brand. Product ids are
  // immutable in ASC, so the code matches the store rather than the reverse.
  pro: 'com.advottic.app.personal_pro.monthly',
};

export function tierHasIosProduct(tier: Tier): boolean {
  return Boolean(IOS_PRODUCT_BY_TIER[tier]);
}

let configuredFor: string | null = null;

async function loadPurchases() {
  const mod = await import('@revenuecat/purchases-capacitor');
  return mod.Purchases;
}

/**
 * Configure (once) with the public SDK key + identify the user. Calling
 * with a new user id re-identifies via logIn so the receipt is attached
 * to the right account.
 */
async function ensureConfigured(userId: string) {
  const Purchases = await loadPurchases();
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY?.trim();
  if (!apiKey) {
    throw new Error('In-app purchase is not configured yet.');
  }
  if (configuredFor === null) {
    await Purchases.configure({ apiKey, appUserID: userId });
    configuredFor = userId;
  } else if (configuredFor !== userId) {
    await Purchases.logIn({ appUserID: userId });
    configuredFor = userId;
  }
  return Purchases;
}

/** True if RevenueCat reports any active entitlement for this user. */
function hasActiveEntitlement(customerInfo: unknown): boolean {
  const active = (
    customerInfo as { entitlements?: { active?: Record<string, unknown> } }
  )?.entitlements?.active;
  return Boolean(active && Object.keys(active).length > 0);
}

/** Whether IAP can run in the current runtime (the iOS app). */
export function iapAvailable(): boolean {
  return isIOSApp();
}

/**
 * Show the Apple purchase sheet for the given tier. Resolves with
 * `{ active }` after the user completes or cancels. Throws on a real
 * error (cancel resolves to active=false rather than throwing).
 */
export async function purchaseTier(
  tier: Tier,
  userId: string,
): Promise<{ active: boolean; cancelled: boolean }> {
  if (!isIOSApp()) {
    throw new Error('In-app purchase is only available in the Advottic iOS app.');
  }
  const productId = IOS_PRODUCT_BY_TIER[tier];
  if (!productId) {
    throw new Error('This plan is not available as an in-app purchase.');
  }
  const Purchases = await ensureConfigured(userId);
  const { products } = await Purchases.getProducts({
    productIdentifiers: [productId],
  });
  const product = products?.[0];
  if (!product) {
    throw new Error('This plan is not available in the App Store right now.');
  }
  try {
    const res = await Purchases.purchaseStoreProduct({ product });
    return { active: hasActiveEntitlement(res.customerInfo), cancelled: false };
  } catch (err) {
    // RevenueCat sets userCancelled on a deliberate cancel - not an error.
    if ((err as { userCancelled?: boolean })?.userCancelled) {
      return { active: false, cancelled: true };
    }
    throw err;
  }
}

/** Apple-required "Restore Purchases" - re-grants an existing subscription. */
export async function restorePurchases(
  userId: string,
): Promise<{ active: boolean }> {
  if (!isIOSApp()) {
    throw new Error('Restore is only available in the Advottic iOS app.');
  }
  const Purchases = await ensureConfigured(userId);
  const info = await Purchases.restorePurchases();
  return { active: hasActiveEntitlement(info.customerInfo) };
}
