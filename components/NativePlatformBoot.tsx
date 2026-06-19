/**
 * Inline head script that tags <html> with the native platform BEFORE
 * first paint, so platform-gated content can be hidden by CSS with no
 * flash-of-wrong-content. The Capacitor native runtime injects
 * `window.Capacitor` before the remote URL loads, so this runs
 * synchronously in <head> and the class is present on the very first
 * render.
 *
 * Classes added on <html>:
 *   - is-native-app   (inside iOS or Android shell)
 *   - is-ios-app      (iOS only)
 *   - is-android-app  (Android only)
 *
 * Paired with globals.css rules:
 *   .is-native-app  [data-hide-in-app]    { display:none }
 *   .is-ios-app     [data-hide-on-ios]    { display:none }
 *   .is-android-app [data-hide-on-android]{ display:none }
 *
 * Used to keep App Store Guideline 2.3.10 (no other-platform refs,
 * e.g. a "Get it on Google Play" badge) and 3.1.1 (no non-IAP
 * purchase paths) out of the iOS app, without a new binary - the
 * gating lives in the remote web app the WebView loads.
 */
const BOOT = `(function(){try{var c=window.Capacitor;if(c&&typeof c.isNativePlatform==='function'&&c.isNativePlatform()){var p=(typeof c.getPlatform==='function'&&c.getPlatform())||'';var d=document.documentElement;d.classList.add('is-native-app');if(p==='ios')d.classList.add('is-ios-app');if(p==='android')d.classList.add('is-android-app');}}catch(e){}})();`;

export function NativePlatformBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT }} />;
}
