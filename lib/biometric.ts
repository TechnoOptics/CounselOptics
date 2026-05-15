'use client';

/**
 * Biometric sign-in helper. All functions are no-ops on web/desktop.
 *
 * The plugin lifecycle is: after a successful magic-link or OAuth
 * sign-in on the native shell, we prompt the user "Use Face/Touch ID
 * for next sign-in?" If yes, we capture the live Supabase session's
 * refresh token, persist it via @capacitor/preferences (gated behind
 * the biometric prompt at read-time), and on next launch we prompt
 * for biometric -> read the token -> call setSession() to restore
 * the session without a fresh email round-trip.
 *
 * Security model: the refresh token itself is stored in plaintext in
 * Capacitor Preferences (Android SharedPreferences + iOS NSUserDefaults).
 * It is NOT encrypted at rest. The biometric prompt is the security
 * gate: token storage is only ever read after a successful biometric
 * authenticate() call. An attacker with full filesystem access could
 * bypass this, but at that point the refresh token is the least of
 * the user's problems. Refresh tokens are also revocable server-side
 * via the Supabase admin panel.
 *
 * Improvement track: swap @capacitor/preferences for @aparajita
 * /capacitor-secure-storage in a v1.x release. That moves the bytes
 * into iOS Keychain / Android Keystore (hardware-backed secure
 * enclave on supported devices). Wait until we're past internal
 * testing so we don't add native build complexity to v1.0.
 */

// Type-only imports keep the static dependency surface in the type
// system while the actual native modules are deferred to runtime via
// the lazy `nativeMods()` helper below. Without this, every page that
// transitively imports lib/biometric (e.g. BiometricSessionSync in
// the root layout) would load three Capacitor plugins at SSR module
// resolution time. Those plugins access globals like `window` and
// `Capacitor` on import, which throws inside the Node SSR worker and
// surfaces as React error #419 ("server could not finish this
// Suspense boundary"). The hands-on V3 audit traced 29 such crashes
// across /sign-in, /file-exhibits, /public-defender, and the OAuth
// callback - all roots of the auth and SEO funnels.
import type {
  BiometryError as BiometryErrorClass,
  BiometryErrorType as BiometryErrorTypeEnum,
  BiometryType,
} from '@aparajita/capacitor-biometric-auth';

/**
 * Dynamically load the three Capacitor plugins on first use. The
 * import() calls only execute in the browser (every call site below
 * is guarded by isNativeShell() which itself short-circuits when
 * window is undefined), so the SSR pass never touches them.
 *
 * Cached on the module after the first call so subsequent unlocks
 * skip the dynamic-import cost.
 */
let nativeModsCache: {
  BiometricAuth: typeof import('@aparajita/capacitor-biometric-auth').BiometricAuth;
  BiometryError: typeof import('@aparajita/capacitor-biometric-auth').BiometryError;
  BiometryErrorType: typeof import('@aparajita/capacitor-biometric-auth').BiometryErrorType;
  Preferences: typeof import('@capacitor/preferences').Preferences;
  Capacitor: typeof import('@capacitor/core').Capacitor;
} | null = null;
async function nativeMods() {
  if (nativeModsCache) return nativeModsCache;
  const [bio, prefs, core] = await Promise.all([
    import('@aparajita/capacitor-biometric-auth'),
    import('@capacitor/preferences'),
    import('@capacitor/core'),
  ]);
  nativeModsCache = {
    BiometricAuth: bio.BiometricAuth,
    BiometryError: bio.BiometryError,
    BiometryErrorType: bio.BiometryErrorType,
    Preferences: prefs.Preferences,
    Capacitor: core.Capacitor,
  };
  return nativeModsCache;
}

// Storage keys. Prefixed with `advottic-bio-` so we never collide with
// Supabase's own auth storage keys, and so a future "wipe biometric
// data" debug helper can pattern-match.
const PREFS_REFRESH_TOKEN = 'advottic-bio-refresh-token';
const PREFS_USER_EMAIL = 'advottic-bio-user-email';
const PREFS_ENROLLED_AT = 'advottic-bio-enrolled-at';

export type BiometricStatus =
  | { available: true; type: BiometryType; reason: null }
  | { available: false; type: null; reason: string };

/**
 * True only inside a Capacitor native shell (iOS / Android). Web
 * returns false. Used as a fast synchronous guard at the top of every
 * other function in this module so SSR never reaches the dynamic
 * Capacitor import. The probe reads `window.Capacitor` directly -
 * Capacitor sets that global on app boot in the native shell, so we
 * get the answer without awaiting the dynamic-import promise.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Probe whether the device can do biometric auth. Returns the
 * specific biometry type (FaceID / TouchID / fingerprint / face)
 * so the caller can render an accurate prompt label.
 */
export async function checkBiometricStatus(): Promise<BiometricStatus> {
  if (!isNativeShell()) {
    return { available: false, type: null, reason: 'Not on a native device.' };
  }
  try {
    const { BiometricAuth } = await nativeMods();
    const info = await BiometricAuth.checkBiometry();
    if (info.isAvailable) {
      return { available: true, type: info.biometryType, reason: null };
    }
    // info.reason is a human string from the plugin (e.g. "Biometry not enrolled").
    return {
      available: false,
      type: null,
      reason: info.reason || 'Biometric not available on this device.',
    };
  } catch (err) {
    return {
      available: false,
      type: null,
      reason: err instanceof Error ? err.message : 'Biometric check failed.',
    };
  }
}

/**
 * Human-friendly label for the local biometric, matched to the device.
 *
 * Capacitor's BiometryType is a TypeScript enum. The string values are
 * stable across plugin versions, so we compare against literals here
 * instead of importing the enum - that keeps this function callable
 * synchronously from any UI without awaiting the dynamic plugin
 * import. If the plugin ever renames its enum members we'd need to
 * update the literals here; that's a one-line maintenance cost
 * traded for SSR safety on every page.
 */
export function biometryLabel(type: BiometryType | null): string {
  // Coerce to string so the comparison is robust to numeric-vs-string
  // enum representations.
  switch (String(type)) {
    case 'faceId':
      return 'Face ID';
    case 'touchId':
      return 'Touch ID';
    case 'fingerprintAuthentication':
      return 'fingerprint';
    case 'faceAuthentication':
      return 'face unlock';
    case 'irisAuthentication':
      return 'iris scan';
    default:
      return 'biometric';
  }
}

/**
 * True if a refresh token has been stored on this device. Cheap;
 * just reads a preference key. Used by the sign-in page to decide
 * whether to render the biometric-first banner.
 */
export async function isBiometricEnrolled(): Promise<boolean> {
  if (!isNativeShell()) return false;
  const { Preferences } = await nativeMods();
  const { value } = await Preferences.get({ key: PREFS_REFRESH_TOKEN });
  return Boolean(value);
}

/**
 * Returns the email associated with the enrolled biometric, or null.
 * Used by the sign-in surface to show "Welcome back, name@example.com"
 * instead of a generic "use Face ID" prompt - small UX touch that
 * also helps a multi-user device prompt for the right account.
 */
export async function getEnrolledEmail(): Promise<string | null> {
  if (!isNativeShell()) return null;
  const { Preferences } = await nativeMods();
  const { value } = await Preferences.get({ key: PREFS_USER_EMAIL });
  return value;
}

/**
 * Persist the user's refresh token + email behind the biometric gate.
 * Does NOT itself prompt for biometric - the caller is expected to
 * call this AFTER a successful sign-in, where we already trust the
 * person at the device. Future calls to restoreSessionWithBiometric()
 * will require the biometric prompt to read the token back.
 */
export async function enrollBiometric(input: {
  refreshToken: string;
  email: string;
}): Promise<void> {
  if (!isNativeShell()) return;
  const { Preferences } = await nativeMods();
  const now = new Date().toISOString();
  await Promise.all([
    Preferences.set({ key: PREFS_REFRESH_TOKEN, value: input.refreshToken }),
    Preferences.set({ key: PREFS_USER_EMAIL, value: input.email }),
    Preferences.set({ key: PREFS_ENROLLED_AT, value: now }),
  ]);
}

/**
 * Wipe everything biometric-related on this device. Called from the
 * profile "Disable biometric sign-in" toggle, and also on sign-out
 * so the next user of the same device starts fresh.
 */
export async function clearBiometric(): Promise<void> {
  if (!isNativeShell()) return;
  const { Preferences } = await nativeMods();
  await Promise.all([
    Preferences.remove({ key: PREFS_REFRESH_TOKEN }),
    Preferences.remove({ key: PREFS_USER_EMAIL }),
    Preferences.remove({ key: PREFS_ENROLLED_AT }),
  ]);
}

export type RestoreResult =
  | { ok: true; refreshToken: string; email: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'no-enrollment' | 'error'; message: string };

/**
 * Prompt the user for biometric authentication. On success, reads
 * the stored refresh token and returns it. The caller is expected
 * to feed it into supabase.auth.setSession() - we deliberately stop
 * short of touching Supabase here so this helper stays pure and
 * testable (future jest mock just stubs the plugin layer).
 */
export async function restoreSessionWithBiometric(
  reason = 'Sign in to Advottic',
): Promise<RestoreResult> {
  if (!isNativeShell()) {
    return { ok: false, reason: 'unavailable', message: 'Not on a native device.' };
  }
  const enrolled = await isBiometricEnrolled();
  if (!enrolled) {
    return { ok: false, reason: 'no-enrollment', message: 'No biometric enrolled.' };
  }
  const { BiometricAuth, BiometryError, BiometryErrorType, Preferences } =
    await nativeMods();
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      iosFallbackTitle: 'Use passcode',
      androidTitle: 'Sign in to Advottic',
      androidSubtitle: 'Use your face or fingerprint',
      androidConfirmationRequired: false,
    });
  } catch (err) {
    if (err instanceof BiometryError) {
      const cancelled =
        err.code === BiometryErrorType.userCancel ||
        err.code === BiometryErrorType.appCancel ||
        err.code === BiometryErrorType.systemCancel;
      return {
        ok: false,
        reason: cancelled ? 'cancelled' : 'error',
        message: err.message,
      };
    }
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Biometric authentication failed.',
    };
  }
  // Biometric succeeded - now read the stored token. We DO NOT use
  // the plugin's own credential storage because it varies platform
  // -to-platform and we want a single, predictable read path.
  const [{ value: refreshToken }, { value: email }] = await Promise.all([
    Preferences.get({ key: PREFS_REFRESH_TOKEN }),
    Preferences.get({ key: PREFS_USER_EMAIL }),
  ]);
  if (!refreshToken || !email) {
    // Storage was wiped between isBiometricEnrolled() and now - rare
    // but possible (e.g. user cleared app data in another window).
    return {
      ok: false,
      reason: 'no-enrollment',
      message: 'Biometric data was cleared. Please sign in again.',
    };
  }
  return { ok: true, refreshToken, email };
}
