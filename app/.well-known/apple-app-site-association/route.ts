import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-static';

/**
 * Apple App Site Association (AASA).
 *
 * This is the iOS counterpart of public/.well-known/assetlinks.json
 * (Android App Links). It is what makes "Continue with Google /
 * Microsoft / Apple" actually return to the native app instead of
 * stranding the user signed-in inside the SFSafariViewController.
 *
 * Why a route handler instead of a static public/ file:
 *   - Apple fetches https://advottic.com/.well-known/apple-app-site-association
 *     (no extension) and is historically picky about the response:
 *     it must be Content-Type: application/json and must NOT be a
 *     redirect. A no-extension file in public/ is served as
 *     application/octet-stream by the static handler, which older
 *     iOS rejects. Serving it here lets us pin the content type and
 *     guarantees the apex (not a www -> apex 301) answers it.
 *   - Matches the existing app/.well-known/security.txt/route.ts
 *     precedent in this codebase.
 *
 * appID / appIDs is <TeamID>.<bundleID>:
 *   Team ID  FNU92FR9C9   (Apple Developer -> Membership details;
 *                          same value as the APPLE_TEAM_ID CI secret)
 *   Bundle   com.advottic.app  (capacitor.config.ts appId)
 *
 * Only /auth/callback is associated - NOT the whole site. The app is
 * a remote-URL Capacitor wrapper whose WebView already lives on
 * advottic.com; associating every path would make iOS try to hand
 * ordinary in-app navigation off to the app and break the WebView.
 * Restricting the Universal Link to the Supabase OAuth + magic-link
 * callback path is exactly what the appUrlOpen listener in
 * app/sign-in/sign-in-buttons.tsx waits for.
 *
 * Both the legacy (appID + paths) and modern (appIDs + components)
 * shapes are included so the file verifies on every iOS version the
 * app supports (deployment target 14.0).
 */
export function GET() {
  const APP_ID = 'FNU92FR9C9.com.advottic.app';

  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: APP_ID,
          appIDs: [APP_ID],
          paths: ['/auth/callback', '/auth/callback/*'],
          components: [
            {
              '/': '/auth/callback',
              comment: 'Supabase OAuth + magic-link callback',
            },
            {
              '/': '/auth/callback/*',
              comment: 'OAuth + magic-link callback subpaths',
            },
          ],
        },
      ],
    },
    // webcredentials lets iOS offer the saved-password / passkey
    // autofill for advottic.com inside the app WebView. Harmless to
    // include now and saves a second AASA edit if we add passkeys.
    webcredentials: {
      apps: [APP_ID],
    },
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Apple's CDN caches this; a day is the conventional TTL and
      // matches the security.txt route.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
