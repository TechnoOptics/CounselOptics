import { NextResponse, type NextRequest } from 'next/server';
import { nativePlatformFromUserAgent } from '@/lib/platform';

/**
 * Server-authoritative App Store 3.1.1 guard for web (non-IAP) purchase
 * routes: consumable/one-time digital content and subscriptions used in
 * the app must be bought through Apple IAP, not a Stripe web checkout,
 * when the buyer is inside the iOS app.
 *
 * The purchase buttons are already hidden in-app via CSS
 * (data-hide-on-ios / data-hide-in-app), but CSS alone is defeatable and
 * is the pattern behind prior Apple rejections. This is the fail-closed
 * backstop: it refuses the checkout server-side, keyed on the same native
 * UA token (AdvotticApp/ios) the store-badge gate uses, so the session
 * can't be created from inside the iOS app even if the button is reached.
 *
 * iOS Safari on the OPEN web is NOT the app (no token) and is allowed
 * through - web purchases there are legitimate. Android is intentionally
 * not blocked here (its buttons use data-hide-on-ios, matching this).
 *
 * Usage: `const blocked = blockedIosAppPurchase(req); if (blocked) return blocked;`
 */
export function blockedIosAppPurchase(req: NextRequest): NextResponse | null {
  if (nativePlatformFromUserAgent(req.headers.get('user-agent')) === 'ios') {
    return NextResponse.json(
      {
        error:
          'Purchases in the iOS app are handled through the App Store. Open advottic.com in a browser to buy here.',
      },
      { status: 403 },
    );
  }
  return null;
}
