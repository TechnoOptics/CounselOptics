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

/**
 * Reject if a native StoreKit/RevenueCat call doesn't settle in time.
 *
 * App Review rejected build 19 under Guideline 2.1(b) because tapping
 * Subscribe "loaded indefinitely": the StoreKit product request never
 * returned (this happens when the Paid Apps Agreement isn't active or
 * the products aren't fetchable), so the button sat on "Opening App
 * Store..." forever. Wrapping the pre-purchase native calls in a
 * timeout guarantees the UI always resolves to a clear error instead of
 * spinning. The purchase sheet itself is NOT wrapped - once Apple's
 * sheet is up the user may legitimately take minutes.
 */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const STOREKIT_TIMEOUT_MS = 15000;

// The purchase sheet is user-paced (Face ID, a sandbox sign-in, reading the
// terms), so it gets a much longer ceiling than the pre-purchase calls - but it
// is NOT unbounded. Build 19/20 were rejected under 2.1(b) because tapping
// Subscribe "loaded indefinitely"; if StoreKit never presents the sheet, the
// purchase promise never settles. Capping it guarantees the UI resolves to a
// retryable message instead of an infinite spinner, which is the exact symptom
// App Review cited.
const PURCHASE_TIMEOUT_MS = 180000; // 3 min

/**
 * Re-throw with a `[step]` prefix so a caught error's displayed message
 * pinpoints which native call failed - "The string did not match the
 * expected pattern" on its own could come from configure(), getProducts(),
 * or purchaseStoreProduct(), and each has a different likely cause
 * (bad API key format, bad product id, bad receipt/StoreKit response).
 *
 * Takes a THUNK, not a pre-built promise: `Purchases.configure(...)` is a
 * Capacitor bridge call that can throw SYNCHRONOUSLY (argument validation
 * before it ever returns a promise). `tagStep('x', somePromise)` would
 * evaluate `somePromise` eagerly, before this function's body - and
 * therefore before any `.catch()` exists to catch it - so a synchronous
 * throw would bypass the tag entirely (this is exactly what happened on
 * the first attempt: the untagged message came through unchanged).
 * Wrapping the call inside `Promise.resolve().then(fn)` forces even a
 * synchronous throw through the promise machinery, where `.catch()` can
 * actually see it.
 */
function tagStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const tagged = new Error(`[${step}] ${message}`);
      if (err instanceof Error) tagged.stack = err.stack;
      throw tagged;
    });
}

async function loadPurchasesModule() {
  // The dynamic import fetches a JS chunk from advottic.com (remote-URL
  // WebView). Guard it so a stalled chunk request can't hang the purchase
  // before any native call is even attempted.
  return tagStep('loadPlugin', () =>
    withTimeout(
      import('@revenuecat/purchases-capacitor'),
      STOREKIT_TIMEOUT_MS,
      "The purchase module didn't load. Please check your connection and try again.",
    ),
  );
}

async function loadPurchases() {
  const mod = await loadPurchasesModule();
  return mod.Purchases;
}

/**
 * Configure (once) with the public SDK key + identify the user. Calling
 * with a new user id re-identifies via logIn so the receipt is attached
 * to the right account.
 */
async function ensureConfigured(userId: string) {
  const mod = await loadPurchasesModule();
  const Purchases = mod.Purchases;
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY?.trim();
  if (!apiKey) {
    throw new Error('In-app purchase is not configured yet.');
  }
  // A RevenueCat *public Apple* SDK key starts with "appl_". Shipping the wrong
  // key type (a secret sk_ key, an Android goog_ key, or a stale key from a
  // different RevenueCat project) is the classic cause of the SDK never
  // completing its handshake - configure() returns fine, but every subsequent
  // StoreKit-via-RevenueCat call stalls, so tapping Subscribe "loads
  // indefinitely" and RevenueCat shows zero SDK connections. Fail loud here
  // rather than let the purchase hang.
  if (!apiKey.startsWith('appl_')) {
    throw new Error(
      'In-app purchase is misconfigured: NEXT_PUBLIC_REVENUECAT_IOS_KEY must be the RevenueCat public Apple key (starts with "appl_").',
    );
  }
  // Surface the native RevenueCat handshake in device / App Review logs so a
  // future failure is diagnosable instead of silent. Best-effort — and it must
  // NOT be able to hang the purchase. This is the FIRST native bridge call, and
  // a bare `await` here caused the 2.1(b) "loads indefinitely" symptom: on the
  // remote-URL WebView, if the native RevenueCat plugin binary compiled into
  // the installed build is older than the v13 JS wrapper served from
  // advottic.com, a call to a skewed method never calls back, so `await` hangs
  // forever and the plain try/catch (which only catches a *rejection*) can't
  // rescue it. Bounding it with withTimeout guarantees we fall through to
  // configure() (which is itself bounded and surfaces a real error) instead of
  // spinning. 5s is generous for a fire-and-forget log-level setter.
  // NOTE: we deliberately do NOT call Purchases.setLogLevel() here.
  // Firing it (even fire-and-forget) concurrently with configure() deadlocked
  // the native RevenueCat plugin on this remote-URL WebView build: the JS
  // thread froze inside configure() and never returned, so even the withTimeout
  // guard below couldn't fire (a blocked JS thread can't run its own timer).
  // configure() must be the first and only bridge call in flight. Debug log
  // level isn't worth that risk (its output doesn't reach idevicesyslog anyway).
  if (configuredFor === null) {
    await tagStep('configure', () =>
      withTimeout(
        Purchases.configure({ apiKey, appUserID: userId }),
        STOREKIT_TIMEOUT_MS,
        "Couldn't reach the App Store. Please check your connection and try again.",
      ),
    );
    configuredFor = userId;
  } else if (configuredFor !== userId) {
    await tagStep('logIn', () =>
      withTimeout(
        Purchases.logIn({ appUserID: userId }),
        STOREKIT_TIMEOUT_MS,
        "Couldn't reach the App Store. Please check your connection and try again.",
      ),
    );
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
  log: (m: string) => void = () => {},
): Promise<{ active: boolean; cancelled: boolean }> {
  if (!isIOSApp()) {
    throw new Error('In-app purchase is only available in the Advottic iOS app.');
  }
  const productId = IOS_PRODUCT_BY_TIER[tier];
  if (!productId) {
    throw new Error('This plan is not available as an in-app purchase.');
  }
  log(`product=${productId}`);
  log('configuring…');
  const Purchases = await ensureConfigured(userId);
  log('configured ✓');

  // Prefer RevenueCat's supported Offering/Package flow (the "default" offering
  // has both products as packages). This is the path RevenueCat tests and is
  // more reliable at presenting the StoreKit sheet than a raw StoreProduct.
  // Fall back to the raw product if offerings aren't reachable, so a
  // dashboard-side offering hiccup can never block a purchase outright.
  let purchase: (() => Promise<{ customerInfo: unknown }>) | null = null;
  try {
    log('getOfferings…');
    const offerings = await tagStep('getOfferings', () =>
      withTimeout(
        Purchases.getOfferings(),
        STOREKIT_TIMEOUT_MS,
        "The App Store isn't responding right now. Please try again in a moment.",
      ),
    );
    const o = offerings as {
      current?: { identifier?: string; availablePackages?: Array<{ product?: { identifier?: string } }> };
      all?: Record<string, unknown>;
    };
    const pkgs = o?.current?.availablePackages ?? [];
    log(
      `offerings ✓ current=${o?.current?.identifier ?? 'NONE'} all=${
        o?.all ? Object.keys(o.all).length : 0
      } pkgs=${pkgs.length}[${pkgs.map((p) => p?.product?.identifier ?? '?').join(',')}]`,
    );
    const pkg = pkgs.find((p) => p?.product?.identifier === productId);
    if (pkg) {
      log('matched package ✓');
      purchase = () =>
        (Purchases as unknown as {
          purchasePackage: (o: { aPackage: unknown }) => Promise<{ customerInfo: unknown }>;
        }).purchasePackage({ aPackage: pkg });
    } else {
      log('no matching package → getProducts fallback');
    }
  } catch (e) {
    log(`getOfferings FAILED: ${e instanceof Error ? e.message : String(e)}`);
    /* fall through to the raw StoreProduct path */
  }

  if (!purchase) {
    log('getProducts…');
    const { products } = await tagStep('getProducts', () =>
      withTimeout(
        Purchases.getProducts({ productIdentifiers: [productId] }),
        STOREKIT_TIMEOUT_MS,
        "The App Store isn't responding right now. Please try again in a moment.",
      ),
    );
    log(`getProducts ✓ count=${products?.length ?? 0}`);
    const product = products?.[0];
    if (!product) {
      throw new Error(
        `App Store returned NO product for "${productId}". This means the product isn't fetchable — usually the Paid Apps agreement isn't fully active, the product isn't "Ready to Submit"/Approved, or the bundle id / RevenueCat offering is mismatched.`,
      );
    }
    log('got product ✓');
    purchase = () => Purchases.purchaseStoreProduct({ product });
  }
  log('presenting Apple sheet…');

  try {
    // Diagnostic build: keep the present-sheet step SHORT so we see a verdict
    // fast instead of a 3-min wait. A real sheet presents in <1s; if it hasn't
    // presented in 20s the purchase call is stuck, and that IS the finding.
    const res = await withTimeout(
      purchase(),
      20000,
      "sheet never presented (purchasePackage/purchaseStoreProduct did not resolve in 20s)",
    );
    log('purchase resolved ✓');
    return { active: hasActiveEntitlement(res.customerInfo), cancelled: false };
  } catch (err) {
    // RevenueCat sets userCancelled on a deliberate cancel - not an error.
    if ((err as { userCancelled?: boolean })?.userCancelled) {
      log('user cancelled');
      return { active: false, cancelled: true };
    }
    // Surface RevenueCat's structured error fields — code + underlying StoreKit
    // message are what actually pinpoint the cause.
    const e = err as {
      message?: string;
      code?: unknown;
      readableErrorCode?: string;
      underlyingErrorMessage?: string;
      userInfo?: unknown;
    };
    log(
      `purchase ERROR code=${String(e?.readableErrorCode ?? e?.code ?? '?')} msg=${
        e?.message ?? String(err)
      }${e?.underlyingErrorMessage ? ` underlying=${e.underlyingErrorMessage}` : ''}`,
    );
    throw err instanceof Error
      ? Object.assign(new Error(`[purchase] ${err.message}`), { stack: err.stack })
      : err;
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
