'use client';

/**
 * Banner that shows on the sign-in screen on native shells when:
 *   - Device supports biometric auth (face / fingerprint)
 *   - User has NOT yet enrolled (no stored refresh token)
 *
 * The fully-enrolled path is owned by BiometricUnlockGate, which
 * replaces the entire sign-in form with an unlock card. This hint
 * is the in-between state so the user knows the option exists
 * before they ever sign in.
 *
 * On web (and on native shells without biometric hardware) this
 * component renders nothing.
 */

import { useEffect, useState } from 'react';
import {
  biometryLabel,
  checkBiometricStatus,
  isBiometricEnrolled,
  isNativeShell,
} from '@/lib/biometric';
import { BiometryType } from '@aparajita/capacitor-biometric-auth';

export function BiometricSignInHint() {
  const [show, setShow] = useState(false);
  const [label, setLabel] = useState('biometric');
  const [type, setType] = useState<BiometryType | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!isNativeShell()) return;
      const status = await checkBiometricStatus();
      if (cancelled || !status.available) return;
      const enrolled = await isBiometricEnrolled();
      if (cancelled || enrolled) return; // gate handles enrolled
      setLabel(biometryLabel(status.type));
      setType(status.type);
      setShow(true);
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="rounded-lg border border-gold-300/40 bg-gradient-to-br from-cream-50 via-cream-50/80 to-cream-100/60 dark:from-forest-900/40 dark:via-forest-900/30 dark:to-forest-900/40 px-4 py-3 mb-3 flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold-100 text-gold-800 dark:bg-gold-400/15 dark:text-gold-300"
      >
        {type === BiometryType.faceId ? <FaceIcon /> : <FingerprintIcon />}
      </span>
      <div className="flex-1">
        <p className="text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-700 dark:text-gold-300">
          {label === 'Face ID' ? 'Face ID ready' : `${label.charAt(0).toUpperCase() + label.slice(1)} ready`}
        </p>
        <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-0.5 leading-relaxed">
          Sign in once below and {label} unlocks the app from then on.
        </p>
      </div>
    </div>
  );
}

function FaceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6V4a1 1 0 0 1 1-1h2M4 18v2a1 1 0 0 0 1 1h2M20 6V4a1 1 0 0 0-1-1h-2M20 18v2a1 1 0 0 1-1 1h-2M9 9v.5M15 9v.5M9 15s1 1.5 3 1.5 3-1.5 3-1.5M12 9.5v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 11v3a2 2 0 1 0 4 0M8 14a4 4 0 0 1 8 0M6 11a6 6 0 0 1 12 0v1M9 5.5a6 6 0 0 1 7 .5M5 9a8 8 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
