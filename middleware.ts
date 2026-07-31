import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { nativePlatformFromUserAgent } from '@/lib/platform';

/**
 * Routes that exist only to sell. App Store Guideline 3.1.1 / 3.1.3(c)
 * Enterprise Services: the app contains no purchasing and no call to action
 * to purchase outside it. These pages are wall to
 * wall prices, plan ladders, trial offers and checkout entry points, so there
 * is nothing left of them once the purchase content is removed. Inside the
 * iOS app they redirect to the home screen instead.
 *
 * Doing it here rather than in each page keeps the pages statically rendered
 * for the web (they are high-intent SEO surfaces) and makes the redirect
 * race-free: it is decided before any HTML is produced.
 *
 * `/gift/claim/...` is deliberately NOT included. Redeeming a gift someone
 * else already paid for is not a purchase, and an iOS recipient must still be
 * able to claim. Its two outbound links to /pricing and /billing are gated in
 * the page itself.
 */
const IOS_BLOCKED_PREFIXES = ['/pricing', '/compare', '/affiliate'];

function isIosSellRoute(pathname: string): boolean {
  if (pathname === '/gift' || pathname.startsWith('/gift/')) {
    return !pathname.startsWith('/gift/claim');
  }
  return IOS_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  // iOS app only. A browser (including Safari on iOS, which carries no
  // AdvotticApp/ios token) is never touched by this and keeps the full
  // pricing site. Android is not gated either.
  if (
    nativePlatformFromUserAgent(request.headers.get('user-agent')) === 'ios' &&
    isIosSellRoute(request.nextUrl.pathname)
  ) {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Match everything except static assets and the Next internals.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)',
  ],
};
