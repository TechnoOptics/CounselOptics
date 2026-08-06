/**
 * Central native-platform detection for the Capacitor shells.
 *
 * The iOS/Android apps are remote-URL WebViews of advottic.com, so
 * the SAME React code renders in the browser and in the app. These
 * helpers answer "am I running inside the native app, and which one"
 * so features that depend on device hardware (Face ID, push, camera,
 * background GPS, a paired watch) can gate themselves to the app and
 * fall back to a "get the app" prompt on the open web.
 *
 * Detection reads the `window.Capacitor` bridge that the native
 * runtime injects, rather than importing `@capacitor/core` - this
 * keeps the module SSR-safe and out of the server bundle (mirrors
 * the lazy-import convention used elsewhere in the app). With no
 * `window` (server render) it reports 'web', so server output and
 * the first client paint agree; resolve app-ness on the client (see
 * useIsNativeApp) to stay hydration-clean.
 */
export type NativePlatform = 'ios' | 'android' | 'web';

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

export function getNativePlatform(): NativePlatform {
  if (typeof window === 'undefined') return 'web';
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  try {
    if (!cap?.isNativePlatform?.()) return 'web';
    const p = cap.getPlatform?.();
    return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'web';
  } catch {
    return 'web';
  }
}

/** Running inside either native shell (not the open web). */
export function isNativeApp(): boolean {
  return getNativePlatform() !== 'web';
}

/**
 * The URL to hand @capacitor/browser for a link on this page.
 *
 * `Browser.open` needs an absolute URL. A relative href - which is
 * what any link to our own API or another page of the app is - makes
 * it reject, and the caller's fallback then assigns
 * window.location.href instead, which navigates the WebView away from
 * the page the link was on. On most pages that is an annoyance. On
 * /sign/[token] it discards a signing ceremony in progress: the
 * consents, the review affirmation and the drawn mark all live in
 * component state, and the signer comes back to an empty pad.
 *
 * So relative hrefs are resolved against the current document before
 * they are handed over. Anything already absolute, and anything with a
 * scheme of its own (mailto:, tel:), is passed through untouched.
 */
export function resolveNativeBrowserUrl(
  href: string,
  base: string | null | undefined,
): string {
  if (!href) return href;
  try {
    return new URL(href, base ?? undefined).toString();
  } catch {
    return href;
  }
}

export function isIOSApp(): boolean {
  return getNativePlatform() === 'ios';
}

export function isAndroidApp(): boolean {
  return getNativePlatform() === 'android';
}

/**
 * Server-safe native detection from a User-Agent string.
 *
 * The native shells append a token to the WebView User-Agent via
 * capacitor.config.ts (`ios.appendUserAgent` / `android.appendUserAgent`),
 * so the server can gate cross-platform references (the Google Play
 * badge) and non-IAP purchase paths DETERMINISTICALLY on the first byte
 * of HTML - without depending on the client `window.Capacitor` bridge
 * being present at head-parse time, which raced on the remote-URL
 * WebView and let the Google Play badge slip through App Review
 * (Guideline 2.3.10 reject, submission 2026-06-29).
 *
 * Keep these tokens in exact sync with capacitor.config.ts.
 */
export const NATIVE_UA_TOKEN = {
  ios: 'AdvotticApp/ios',
  android: 'AdvotticApp/android',
} as const;

export function nativePlatformFromUserAgent(
  ua: string | null | undefined,
): NativePlatform {
  if (!ua) return 'web';
  if (ua.includes(NATIVE_UA_TOKEN.ios)) return 'ios';
  if (ua.includes(NATIVE_UA_TOKEN.android)) return 'android';
  return 'web';
}

/**
 * `<html>` class string for server-rendered native gating. Mirrors the
 * classes the client NativePlatformBoot script adds, so the CSS rules in
 * globals.css (`.is-native-app [data-hide-in-app]`, `.is-ios-app
 * [data-hide-on-ios]`) apply from the very first render inside the apps.
 * Empty string on the open web.
 */
export function nativeHtmlClass(platform: NativePlatform): string {
  if (platform === 'ios') return 'is-native-app is-ios-app';
  if (platform === 'android') return 'is-native-app is-android-app';
  return '';
}
