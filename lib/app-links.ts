/**
 * Canonical app-store links for the Advottic mobile apps. Used by the
 * download badges (components/GetTheApp), the Organization +
 * SoftwareApplication JSON-LD (so a brand search surfaces the install
 * options), and the iOS smart-app-banner meta.
 *
 * Google Play is live, so its URL is hard-wired.
 *
 * The Apple App Store id is reserved (6769638076), but the store page
 * only resolves once a version is APPROVED and live - before that it
 * shows "app not available". The whole iOS surface (badge, sameAs,
 * downloadUrl, smart banner) is therefore gated behind a single env
 * flag so we never publish a dead link. Flip it the moment Apple
 * approves and redeploy; everything iOS appears with no code change:
 *
 *   NEXT_PUBLIC_IOS_APP_LIVE=true
 */

// Google Play - live since 1.0.15 (build 18), 100% rollout.
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.advottic.app';

// Apple App Store id (reserved in App Store Connect).
export const APP_STORE_ID = '6769638076';

// True once the App Store version is live. Drives every iOS surface.
export const IOS_APP_LIVE =
  process.env.NEXT_PUBLIC_IOS_APP_LIVE === 'true';

// Null until live, so callers can simply skip the iOS link/badge.
export const APP_STORE_URL: string | null = IOS_APP_LIVE
  ? `https://apps.apple.com/us/app/advottic/id${APP_STORE_ID}`
  : null;

/** All live store URLs, for JSON-LD downloadUrl / sameAs arrays. */
export const STORE_URLS: string[] = [
  PLAY_STORE_URL,
  ...(APP_STORE_URL ? [APP_STORE_URL] : []),
];
