'use client';

/**
 * Device fingerprint helper. Prevents the "make a new email, get a
 * fresh 7-day trial on the same phone" abuse pattern.
 *
 * Two paths:
 *
 *   - Native shells (Capacitor): @capacitor/device's getId() returns
 *     a hardware-backed identifier per app install. Stable across
 *     re-installs on Android (via ANDROID_ID), stable per-vendor on
 *     iOS (identifierForVendor). NOT shared with other apps.
 *
 *   - Web: a UUID stored in localStorage on first visit. Not
 *     hardware-backed (the user can clear storage to reset it), but
 *     it's a meaningful deterrent for the casual abuse case. The
 *     server still rate-limits by IP + email-domain as a second
 *     belt.
 *
 * Returns a single opaque string suitable for storing alongside the
 * user's signup_history row. Never expose this to clients other
 * than the device that produced it.
 */

import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

const STORAGE_KEY = 'advottic-device-id';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  if (Capacitor.isNativePlatform()) {
    try {
      const info = await Device.getId();
      // Plugin returns { identifier } on Capacitor 6+; older
      // versions used { uuid }. Accept either.
      const native = (info as unknown as { identifier?: string; uuid?: string }).identifier ||
        (info as unknown as { identifier?: string; uuid?: string }).uuid ||
        '';
      if (native) {
        cached = `native:${native}`;
        return cached;
      }
    } catch {
      // Fall through to localStorage path.
    }
  }

  if (typeof window === 'undefined') return 'server';

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
    // Generate a fresh UUID. crypto.randomUUID is widely supported
    // since 2022; fall back to a manual generator on the rare older
    // browser.
    const fresh =
      'web:' +
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
    window.localStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Private mode + storage blocked. Fall back to a session-only
    // value so the UI still has something to send. This will not
    // prevent trial reset (the abuse case), but the server-side
    // rate-limit by IP catches the egregious cases.
    cached = 'web-fallback:' + Math.random().toString(36).slice(2);
    return cached;
  }
}
