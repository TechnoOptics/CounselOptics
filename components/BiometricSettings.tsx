'use client';

/**
 * Profile-page card for managing biometric sign-in. Shows on native
 * shells only. Three states:
 *   1. Device doesn't support biometric -> render an explainer.
 *   2. Supported but not enrolled -> "Enable Face/Touch ID" button.
 *   3. Enrolled -> "Disable" button + the email it remembers.
 *
 * Renders nothing on web so the profile page doesn't show a feature
 * the user can't use. The card includes a small "since YYYY-MM-DD"
 * tag on enrolled state so the user can tell at a glance whether
 * the key on this device is fresh or stale.
 */

import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  biometryLabel,
  checkBiometricStatus,
  clearBiometric,
  enrollBiometric,
  isBiometricEnrolled,
  isNativeShell,
} from '@/lib/biometric';
import { BiometryType } from '@aparajita/capacitor-biometric-auth';

type State =
  | { kind: 'loading' }
  | { kind: 'web' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'available'; type: BiometryType | null; enrolled: false; email: null }
  | { kind: 'available'; type: BiometryType | null; enrolled: true; email: string | null; enrolledAt: string | null };

export function BiometricSettings() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    if (!isNativeShell()) {
      setState({ kind: 'web' });
      return;
    }
    const status = await checkBiometricStatus();
    if (!status.available) {
      setState({ kind: 'unsupported', reason: status.reason });
      return;
    }
    const enrolled = await isBiometricEnrolled();
    if (!enrolled) {
      setState({ kind: 'available', type: status.type, enrolled: false, email: null });
      return;
    }
    const [{ value: email }, { value: enrolledAt }] = await Promise.all([
      Preferences.get({ key: 'advottic-bio-user-email' }),
      Preferences.get({ key: 'advottic-bio-enrolled-at' }),
    ]);
    setState({
      kind: 'available',
      type: status.type,
      enrolled: true,
      email,
      enrolledAt,
    });
  }

  async function handleEnable() {
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { data, error: sessErr } = await supabase.auth.getSession();
      if (sessErr || !data.session) {
        throw new Error(sessErr?.message ?? 'No active session.');
      }
      if (!data.session.refresh_token || !data.session.user.email) {
        throw new Error('Session is missing data needed for biometric sign-in.');
      }
      await enrollBiometric({
        refreshToken: data.session.refresh_token,
        email: data.session.user.email,
      });
      // Wipe the dismissal flag so a future sign-out / sign-in doesn't
      // skip the prompt for the same email.
      await Preferences.remove({ key: 'advottic-bio-dismissed-' + data.session.user.email });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable biometric sign-in.');
    } finally {
      setPending(false);
    }
  }

  async function handleDisable() {
    setPending(true);
    setError(null);
    try {
      await clearBiometric();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable biometric sign-in.');
    } finally {
      setPending(false);
    }
  }

  if (state.kind === 'loading' || state.kind === 'web') return null;

  const label =
    state.kind === 'available' ? biometryLabel(state.type) : 'biometric';

  return (
    <div className="space-y-3">
      <div>
        <p className="label">Biometric sign-in</p>
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mb-2">
          Use {label} on this device to skip the email magic-link round-trip on next launch.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {state.kind === 'unsupported' && (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:bg-forest-800/40 dark:border-forest-700/40 dark:text-cream-100/70">
          {state.reason}
        </p>
      )}

      {state.kind === 'available' && !state.enrolled && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? 'Enabling...' : `Enable ${label}`}
        </button>
      )}

      {state.kind === 'available' && state.enrolled && (
        <div className="rounded-lg border border-forest-700/30 bg-forest-50/40 dark:bg-forest-800/30 px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-forest-900 dark:text-cream-100">
              <span className="font-medium">Enabled</span>
              {state.email && <span className="text-ink-500 dark:text-cream-100/55"> · {state.email}</span>}
            </p>
            {state.enrolledAt && (
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                Since {new Date(state.enrolledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={pending}
            className="btn-secondary"
          >
            {pending ? 'Disabling...' : 'Disable'}
          </button>
        </div>
      )}
    </div>
  );
}
