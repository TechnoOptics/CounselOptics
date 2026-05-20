'use client';

import { useEffect } from 'react';

/**
 * Global Capacitor deep-link router. Watches for any
 * appUrlOpen event the system fires when the user follows
 * an https://advottic.com/... link into the native phone app
 * (most often: the paired Wear OS watch's "Open on phone"
 * chip via RemoteActivityHelper, but also share-sheet links
 * from email / chat). Extracts the path + querystring and
 * navigates the WebView there.
 *
 * Without this router, the OS routes the URL to the app (because
 * AndroidManifest now has the broad App Links filter on
 * advottic.com), but Capacitor doesn't auto-navigate the
 * WebView - so the user lands on whatever URL was previously
 * loaded, which feels broken.
 *
 * /auth/callback URLs are deliberately ignored - the sign-in
 * flow has its own short-lived listener that handles the PKCE
 * exchange in-place and we don't want to compete with it.
 *
 * Web fallthrough: no-ops when not running inside a native
 * Capacitor shell.
 */
export function NativeDeepLinkRouter() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const sub = await App.addListener('appUrlOpen', ({ url }) => {
          if (!url) return;
          // OAuth callback runs its own scoped exchange in the
          // sign-in component - never route those.
          if (url.includes('/auth/callback')) return;
          try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            // Only handle advottic.com URLs - any other host (a
            // foreign deep link, a malformed scheme) is ignored.
            if (host !== 'advottic.com' && host !== 'www.advottic.com') {
              return;
            }
            const target = u.pathname + u.search + u.hash;
            if (!target.startsWith('/')) return;
            // Same-page no-op: navigating to the URL we're already
            // on would scroll-jump the WebView. Compare path +
            // search; ignore hash (anchor jumps are cheap).
            const current = window.location.pathname + window.location.search;
            if (current === u.pathname + u.search) return;
            window.location.assign(target);
          } catch {
            /* invalid URL - ignore */
          }
        });
        cleanup = () => {
          try {
            sub.remove();
          } catch {
            /* listener already detached - fine */
          }
        };
      } catch {
        /* not in Capacitor, or @capacitor/app not bundled - no-op */
      }
    })();
    return () => cleanup?.();
  }, []);
  return null;
}
