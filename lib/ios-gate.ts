import 'server-only';
import { headers } from 'next/headers';
import { nativePlatformFromUserAgent } from '@/lib/platform';

/**
 * Server-side "is this request coming from the iOS app?" for React Server
 * Components.
 *
 * App Store Guideline 3.1.1 / 3.1.3(c) Enterprise Services. Advottic on iOS
 * is a free client for a service the customer buys and administers outside
 * the app. The rule that follows from that is simple and is what this gate
 * enforces: the app contains no purchasing, and no call to action to
 * purchase outside it. Naming where to buy is itself a call to action, so on
 * iOS we render the user's CURRENT entitlement as a statement of fact and
 * nothing else. No prices, no plan choices, no plan comparison, no
 * "upgrade" / "subscribe" / "manage billing", no advottic.com pointer.
 *
 * Note on the clauses we do NOT rely on, so nobody re-derives them later:
 * 3.1.3(a) Reader is a closed list (magazines, newspapers, books, audio,
 * music, video) and 3.1.3(f) Free Stand-alone Apps was narrowed in June 2025
 * from "e.g." to "i.e. (VoIP, Cloud Storage, Email Services, Web Hosting)".
 * Legal case management is on neither list. Do not cite either one.
 *
 * Detection is deliberately layered, because the failure mode of the UA
 * check is "fails open" (missing token -> 'web' -> full purchase UI):
 *
 *   1. This helper - server-side UA token (AdvotticApp/ios). Race-free, it
 *      is decided before the first byte of HTML.
 *   2. `data-hide-on-ios` on the same element. globals.css hides it under
 *      `.is-ios-app`, which is set BOTH from this same server signal
 *      (app/layout.tsx) and, independently, by NativePlatformBoot reading
 *      the client-side `window.Capacitor` bridge. So an older binary that
 *      never sends the UA token is still covered.
 *   3. middleware.ts redirects the sell-only routes outright.
 *   4. lib/iap-guard.ts refuses the money APIs server-side, fail-closed.
 *
 * Every purchase surface must carry at least (1) AND (2), so no single
 * missed signal can put a price or a purchase CTA in front of a reviewer.
 *
 * IMPORTANT: this must never widen. The default for a request with no token
 * is 'web' - a real browser gets the complete, unchanged pricing experience.
 * Android is unaffected too; only iOS is gated.
 */
export function isIosAppRequest(): boolean {
  return nativePlatformFromUserAgent(headers().get('user-agent')) === 'ios';
}
