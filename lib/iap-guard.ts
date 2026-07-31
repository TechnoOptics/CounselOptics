import { NextResponse, type NextRequest } from 'next/server';
import { nativePlatformFromUserAgent } from '@/lib/platform';

/**
 * Server-authoritative App Store 3.1.1 guard for every route that can
 * create a Stripe Checkout or Billing Portal session.
 *
 * Advottic on iOS is a free client for a service the customer buys and
 * administers outside the app. Under Guideline 3.1.1 / 3.1.3(c) Enterprise
 * Services the app sells nothing, and it carries no call to action to
 * purchase outside it either. Every purchase control is
 * removed from the iOS render, but markup gating alone is defeatable and
 * is the pattern behind prior Apple rejections. This is the fail-closed
 * backstop: it refuses server-side, keyed on the same native UA token
 * (AdvotticApp/ios) the store-badge gate uses, so no session can be
 * created from inside the iOS app even by a hand-crafted request.
 *
 * iOS Safari on the OPEN web is NOT the app (no token) and is allowed
 * through - web purchases there are legitimate. Android is intentionally
 * not blocked; only iOS is gated.
 *
 * The refusal message must itself contain no purchase CTA. The previous
 * wording ("Open advottic.com in a browser to buy here") was a steering
 * message inside the app, and it also claimed purchases go "through the
 * App Store", which is false - there is no In-App Purchase in this app.
 *
 * Usage: `const blocked = blockedIosAppPurchase(req); if (blocked) return blocked;`
 */
export function blockedIosAppPurchase(req: NextRequest): NextResponse | null {
  if (nativePlatformFromUserAgent(req.headers.get('user-agent')) === 'ios') {
    return NextResponse.json(
      { error: 'This is not available in the app.' },
      { status: 403 },
    );
  }
  return null;
}
