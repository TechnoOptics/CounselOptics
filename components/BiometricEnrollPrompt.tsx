'use client';

/**
 * Biometric enrollment prompt. Mounts inside the app shell post-sign
 * -in. On the very first launch on a native device, asks the user
 * "Use Face ID / Touch ID to sign in next time?" and on yes captures
 * the live Supabase refresh token + email, persists them via the
 * biometric helper, and gets out of the way.
 *
 * Will not show:
 *   - on web / desktop
 *   - if biometric is unavailable on the device
 *   - if the user is already enrolled
 *   - if the user has dismissed the prompt for this email before
 *
 * Re-enabling after a dismissal happens from /profile.
 */

import { useEffect, useState } from 'react';
import { useModalLifecycle } from '@/lib/use-modal-lifecycle';
// Lazy-load @capacitor/preferences at runtime — see lib/biometric.ts
// for the canonical rationale (audit V3 CR-22 / V5 CR-22). Importing
// it statically here pulls native code into the SSR module graph for
// every page that mounts the consumer shell (the enroll prompt lives
// in the cases-list tree).
import type { Preferences as PreferencesType } from '@capacitor/preferences';
import { createBrowserSupabase } from '@/lib/supabase/client';

// Resolve to a PLAIN wrapper, never the Capacitor plugin proxy
// itself. An async fn that returns the proxy makes the Promise
// resolution procedure probe `.then` on it; Capacitor's Android
// proxy rejects that with `"Preferences.then()" is not implemented
// on android`, throwing on every authenticated page load. Wrapping
// it in an object keeps the resolved value non-thenable.
async function loadPreferences(): Promise<{ Preferences: typeof PreferencesType }> {
  const mod = await import('@capacitor/preferences');
  return { Preferences: mod.Preferences };
}
import {
  biometryLabel,
  checkBiometricStatus,
  enrollBiometric,
  isBiometricEnrolled,
  isNativeShell,
} from '@/lib/biometric';

const DISMISSED_PREFIX = 'advottic-bio-dismissed-';

export function BiometricEnrollPrompt() {
  const [phase, setPhase] = useState<'hidden' | 'asking' | 'enrolling' | 'enrolled' | 'error'>(
    'hidden',
  );
  // Body-scroll-lock when the prompt is on screen.
  useModalLifecycle({ enabled: phase !== 'hidden' });
  const [label, setLabel] = useState('biometric');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!isNativeShell()) return;
      const status = await checkBiometricStatus();
      if (cancelled || !status.available) return;
      const already = await isBiometricEnrolled();
      if (cancelled || already) return;
      const supabase = createBrowserSupabase();
      const { data } = await supabase.auth.getUser();
      const userEmail = data.user?.email ?? null;
      if (cancelled || !userEmail) return;
      const { Preferences } = await loadPreferences();
      const { value: dismissed } = await Preferences.get({
        key: DISMISSED_PREFIX + userEmail,
      });
      if (cancelled || dismissed) return;
      setLabel(biometryLabel(status.type));
      setEmail(userEmail);
      setPhase('asking');
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setPhase('enrolling');
    setErrorMsg(null);
    try {
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        throw new Error(error?.message ?? 'No active session to remember.');
      }
      const refreshToken = data.session.refresh_token;
      const userEmail = data.session.user.email;
      if (!refreshToken || !userEmail) {
        throw new Error('Session is missing the data needed for biometric sign-in.');
      }
      await enrollBiometric({ refreshToken, email: userEmail });
      setPhase('enrolled');
      // Dismiss in 1.5s to let the success banner breathe.
      setTimeout(() => setPhase('hidden'), 1500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not enable biometric sign-in.');
      setPhase('error');
    }
  }

  async function handleDismiss() {
    if (email) {
      const { Preferences } = await loadPreferences();
      await Preferences.set({ key: DISMISSED_PREFIX + email, value: '1' });
    }
    setPhase('hidden');
  }

  if (phase === 'hidden') return null;

  return (
    <div
      role="dialog"
      aria-labelledby="bio-enroll-title"
      aria-describedby="bio-enroll-desc"
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-4"
    >
      <div className="card w-full sm:max-w-md p-6 space-y-4 animate-fade-up">
        <div>
          <p className="eyebrow mb-1">Quick sign-in</p>
          <h2
            id="bio-enroll-title"
            className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100"
          >
            Use {label} next time?
          </h2>
          <p
            id="bio-enroll-desc"
            className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed"
          >
            Skip the email magic-link round-trip on this device. Your account stays signed in
            behind {label}, and you can turn it off any time from Profile.
          </p>
        </div>

        {phase === 'enrolling' && (
          <p className="text-sm text-ink-500">Saving secure key...</p>
        )}
        {phase === 'enrolled' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Done. Next time you open Advottic, just use {label}.
          </p>
        )}
        {phase === 'error' && errorMsg && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {errorMsg}
          </p>
        )}

        {(phase === 'asking' || phase === 'error') && (
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={handleDismiss}
              className="btn-secondary"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={handleEnable}
              className="btn bg-forest-900 hover:bg-forest-800 text-cream-50"
              style={{ color: 'var(--btn-primary-fg, #fbf7e9)' }}
            >
              {phase === 'error' ? 'Try again' : `Enable ${label}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
