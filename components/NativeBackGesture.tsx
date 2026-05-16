'use client';

/**
 * Android back-gesture -> web history.
 *
 * iOS gets a true native edge swipe-back from the WKWebView
 * (allowsBackForwardNavigationGestures, set in AppDelegate via
 * ios-release.yml) - nothing to do here for iOS.
 *
 * Android is different: Capacitor's default handling of the system
 * back gesture/button is to exit the app, which feels broken in a
 * multi-page web app. This island listens for @capacitor/app's
 * backButton event and navigates web history instead - going back a
 * page like a native pop, and only exiting when there's genuinely
 * nowhere left to go.
 *
 * No-op on web and iOS. Mounted once in the root layout.
 */

import { useEffect } from 'react';

export function NativeBackGesture() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let active = true;

    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        // iOS uses the native WKWebView swipe-back gesture; only
        // Android needs the JS bridge to remap the system back.
        if (Capacitor.getPlatform() !== 'android') return;

        const { App } = await import('@capacitor/app');
        const sub = await App.addListener(
          'backButton',
          ({ canGoBack }) => {
            // canGoBack reflects the WebView history; also guard on
            // window.history so a deep-linked first page can still
            // pop if it has SPA history.
            if (canGoBack || window.history.length > 1) {
              window.history.back();
            } else {
              void App.exitApp();
            }
          },
        );
        if (!active) {
          void sub.remove();
          return;
        }
        cleanup = () => {
          void sub.remove();
        };
      } catch {
        // Plugin unavailable (old shell / web) - nothing to wire.
      }
    })();

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return null;
}
