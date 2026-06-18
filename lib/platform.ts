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

export function isIOSApp(): boolean {
  return getNativePlatform() === 'ios';
}

export function isAndroidApp(): boolean {
  return getNativePlatform() === 'android';
}
