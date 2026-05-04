'use client';

import { useEffect } from 'react';
import { recordDeviceFingerprintAction } from '@/lib/actions';
import { getDeviceId } from '@/lib/device-fingerprint';

const SESSION_KEY = 'advottic-device-recorded';

/**
 * Mounts once in the authenticated app shell. Reads the current
 * device fingerprint and forwards it to a server action that
 * upserts the device_trial_history row. Once-per-session via
 * sessionStorage so we don't hammer the action on every navigation.
 *
 * Renders nothing. Failure is silent - trial enforcement is a
 * friction layer, not a security boundary.
 */
export function DeviceFingerprintRecorder() {
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY)) {
          return;
        }
        const id = await getDeviceId();
        if (cancelled || !id) return;
        await recordDeviceFingerprintAction(id);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(SESSION_KEY, '1');
        }
      } catch {
        // best-effort
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
