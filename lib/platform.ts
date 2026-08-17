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
 * Tokens that mean a phone on their own.
 *
 * An ALLOWLIST, and not the usual "does it say Mobile" test, which is the thing
 * most likely to be substituted for this later. iPadOS Safari carries the token
 * "Mobile", as do several tablet browsers and Googlebot-Mobile, so a generic
 * mobile test calls all of them phones. Naming the devices instead means the
 * unrecognised case lands on "not a phone", which is the answer that changes
 * nothing (see the function below).
 *
 * These two rules cover the browsers that exist on real phones. Every iOS
 * browser is WebKit underneath and carries "iPhone"; Chrome, Firefox, Samsung
 * Internet, Edge and Opera on Android all carry "Mobile", which Android tablets
 * omit. Nothing matches a tablet, which is the decision the function documents.
 */
const PHONE_UA_TOKENS = ['iphone', 'ipod'] as const;

/**
 * Is the person making this request holding a phone?
 *
 * Server-safe and derived from the request, for the same reason
 * nativePlatformFromUserAgent above is: a header is available before the first
 * byte of HTML, so a boolean built from it is correct on the first paint and
 * cannot lose a race. app/billing/tier-card.tsx decided the device in a client
 * effect that runs once with no retry, the first paint beat it, and the wrong
 * control shipped and was rejected by App Review (2.1(b), 2026-07-02).
 *
 * NO VIEWPORT, DELIBERATELY. A width cannot tell a phone from a desktop window
 * dragged narrow, and mistaking the second for the first withdraws the phone
 * handoff from somebody who has a phone in their pocket and a mouse in their
 * hand.
 *
 * A TABLET IS NOT A PHONE. Three reasons, and the third settles it. A tablet is
 * routinely docked in a keyboard case on a desk, where the phone in somebody's
 * pocket genuinely is a second device and the handoff is not the loop it is on a
 * phone. A firm that restricted a template to the phone named a phone, and a
 * tablet loses nothing by that: it keeps the drawn pad wherever drawing is
 * allowed, and keeps the handoff on a phone-only template, which is the truthful
 * route for it. And iPadOS Safari reports a Macintosh user agent by default, so
 * no string test can identify an iPad reliably in the first place; ruling
 * tablets out keeps the unidentifiable half on the side that changes nothing.
 *
 * There is no tablet check here, and its absence is the point rather than an
 * omission. Tablets are excluded because the allowlist above does not name them,
 * not by a second rule subtracting them afterwards. An earlier draft had that
 * second rule and mutation testing showed it was unreachable: nothing the
 * allowlist admits is a tablet, so the subtraction never fired and the test
 * covering it passed no matter what the subtraction said. It was deleted rather
 * than kept for reassurance.
 *
 * WHICH WAY IT FAILS. Anything unrecognised, including an absent header, reads
 * as not a phone. Callers use this only to withdraw the QR handoff and to widen
 * the pad, never to refuse a signature, so a false negative leaves today's
 * behaviour standing while a false positive would cost somebody a route. See
 * signatureMethodsOnDevice in lib/signature-methods.ts, and the header of
 * guardSignatureMethod in lib/template-submissions.ts, which records why a user
 * agent must never be read as grounds for a refusal here.
 *
 * The native shells need no case of their own: their WebView user agent still
 * carries the underlying device token, so an iPhone running the app matches
 * "iphone" like any other iPhone.
 */
export function isPhoneUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  if (PHONE_UA_TOKENS.some((token) => s.includes(token))) return true;
  // Android phones carry "Mobile" and Android tablets omit it. The "android"
  // half is what keeps this from becoming the generic mobile test the allowlist
  // comment above rules out: an iPad says "Mobile" too, and is not an Android.
  return s.includes('android') && s.includes('mobile');
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
