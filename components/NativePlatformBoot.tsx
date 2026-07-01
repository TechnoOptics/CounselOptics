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
// Resilient detection. The Capacitor bridge (`window.Capacitor`) is
// usually present at head-parse, but on some Android WebViews it (or
// getPlatform()) isn't ready the instant this runs. The original
// one-shot version then never tagged <html>, so a store badge could
// show permanently inside the ALREADY-INSTALLED Android app (whose
// older build predates the `AdvotticApp/android` UA token, so the
// server-side path in layout.tsx can't help it either). We now retry
// until the bridge answers. We gate strictly on getPlatform()/platform
// being 'ios' or 'android' - never 'web' - so this can't misfire on the
// open web. Worst case inside the app is a sub-second badge flash
// before the class lands; fresh builds with the UA token still hide it
// server-side with no flash.
const BOOT = `(function(){function a(){try{var c=window.Capacitor;var p=c&&((typeof c.getPlatform==='function'&&c.getPlatform())||c.platform);if(p==='ios'||p==='android'){var d=document.documentElement;d.classList.add('is-native-app');d.classList.add(p==='ios'?'is-ios-app':'is-android-app');return true;}}catch(e){}return false;}if(a())return;var n=0,id=setInterval(function(){if(a()||++n>60)clearInterval(id);},50);try{document.addEventListener('deviceready',a,{once:true});}catch(e){}})();`;

export function NativePlatformBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT }} />;
}
