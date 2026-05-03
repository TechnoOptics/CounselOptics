'use client';

/**
 * Wraps the sign-in surface on native shells. If a biometric token
 * is enrolled on this device, render a "Welcome back" card with a
 * single Face/Touch ID button instead of dropping straight into the
 * email + OAuth list. The full sign-in form remains one tap away
 * via "Use a different account."
 *
 * On web, on devices without biometry, or when the user is not yet
 * enrolled, this component renders nothing - the wrapped children
 * (the regular sign-in form) take over.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  biometryLabel,
  checkBiometricStatus,
  clearBiometric,
  getEnrolledEmail,
  isBiometricEnrolled,
  isNativeShell,
  restoreSessionWithBiometric,
} from '@/lib/biometric';
import { BiometryType } from '@aparajita/capacitor-biometric-auth';

type Phase = 'checking' | 'ready' | 'unlocking' | 'error' | 'fallback';

export function BiometricUnlockGate({
  next,
  children,
}: {
  next: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('checking');
  const [label, setLabel] = useState('biometric');
  const [biometryType, setBiometryType] = useState<BiometryType | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!isNativeShell()) {
        if (!cancelled) setPhase('fallback');
        return;
      }
      const status = await checkBiometricStatus();
      if (cancelled) return;
      if (!status.available) {
        setPhase('fallback');
        return;
      }
      const enrolled = await isBiometricEnrolled();
      if (cancelled) return;
      if (!enrolled) {
        setPhase('fallback');
        return;
      }
      const storedEmail = await getEnrolledEmail();
      if (cancelled) return;
      setLabel(biometryLabel(status.type));
      setBiometryType(status.type);
      setEmail(storedEmail);
      setPhase('ready');
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnlock() {
    setPhase('unlocking');
    setErrorMsg(null);
    const result = await restoreSessionWithBiometric(`Sign in to Advottic`);
    if (!result.ok) {
      if (result.reason === 'cancelled') {
        setPhase('ready');
        return;
      }
      if (result.reason === 'no-enrollment') {
        // Enrollment was cleared mid-flight - fall back to the normal
        // sign-in form.
        setPhase('fallback');
        return;
      }
      setErrorMsg(result.message);
      setPhase('error');
      return;
    }
    try {
      const supabase = createBrowserSupabase();
      // Supabase setSession requires both tokens. We seed access_token
      // with empty string; the SDK detects the access token is invalid
      // /missing and immediately calls refreshSession() under the hood
      // using the refresh_token, which is the path we actually want.
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: result.refreshToken,
      });
      if (error || !data.session) {
        throw new Error(error?.message ?? 'Could not restore session.');
      }
      router.replace(next);
    } catch (err) {
      // The stored refresh token is dead (revoked / aged out). Wipe it
      // and surface the regular form so the user can sign in fresh.
      await clearBiometric();
      setErrorMsg(
        err instanceof Error
          ? `${err.message} Please sign in again to refresh your secure key.`
          : 'Your stored sign-in expired. Please sign in again.',
      );
      setPhase('fallback');
    }
  }

  async function handleUseDifferentAccount() {
    // User wants to sign in as someone else. Drop the stored token
    // so the next sign-in starts from a clean slate, then surface
    // the regular form.
    await clearBiometric();
    setPhase('fallback');
  }

  if (phase === 'checking') {
    // Render nothing while we probe so the page doesn't briefly flash
    // the sign-in form before we know we have a biometric path.
    return null;
  }

  if (phase === 'fallback') {
    return <>{children}</>;
  }

  return (
    <div className="card p-6 sm:p-8 space-y-6 max-w-md mx-auto">
      <div>
        <p className="eyebrow mb-1">Welcome back</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Use {label} to continue
        </h1>
        {email && (
          <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-1 truncate">
            {email}
          </p>
        )}
      </div>

      {errorMsg && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {errorMsg}
        </p>
      )}

      <button
        type="button"
        onClick={handleUnlock}
        disabled={phase === 'unlocking'}
        className="btn bg-forest-900 hover:bg-forest-800 text-cream-50 w-full font-semibold"
        style={{ color: 'var(--btn-primary-fg, #fbf7e9)' }}
      >
        {phase === 'unlocking' ? 'Authenticating...' : `Unlock with ${label}`}
      </button>

      <button
        type="button"
        onClick={handleUseDifferentAccount}
        className="btn-secondary w-full"
      >
        Use a different account
      </button>

      <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        Your sign-in is gated by {biometryType === BiometryType.faceId ? 'Face ID' : label} on this
        device. We never see your fingerprint or face data - only the result of the prompt.
      </p>
    </div>
  );
}
