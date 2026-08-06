'use client';

/**
 * Opt-in two-factor authentication (TOTP) management.
 * (HIPAA 164.312(d) person/entity authentication; SOC 2 CC6.1; ISO A.8.5.)
 *
 * Uses Supabase Auth's MFA API entirely client-side. This is ADDITIVE and
 * opt-in: enrolling adds a second factor for the user who chooses it. It
 * does not change the sign-in requirement for anyone else, so it cannot
 * lock users out. Sign-in-time AAL2 enforcement is a separate, later step
 * that should only be turned on after this flow is validated on-device.
 */
import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
// Shared with both counsel account pages. A pure passthrough outside a
// LocaleProvider, so the consumer profile is unchanged.
import { T, useT } from '@/components/i18n/LocaleProvider';

type Factor = { id: string; friendlyName?: string | null; status: string };
type Step = 'idle' | 'enrolling' | 'verifying';

export function MfaSettings() {
  const t = useT();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('idle');
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (e) throw e;
      const totp = (data?.totp ?? []) as Factor[];
      setFactors(totp);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not load 2FA status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verified = factors.filter((f) => f.status === 'verified');
  const enabled = verified.length > 0;

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      // Clear any half-finished (unverified) factor so re-enrolling never
      // trips Supabase's "factor already exists" error.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of (existing?.all ?? []) as Factor[]) {
        if (f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
        }
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (e) throw e;
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep('verifying');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not start 2FA setup.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!factorId) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const { data: challenge, error: ce } = await supabase.auth.mfa.challenge({ factorId });
      if (ce) throw ce;
      const { error: ve } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (ve) throw ve;
      setStep('idle');
      setQr(null);
      setSecret(null);
      setCode('');
      setFactorId(null);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('That code did not match. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const { error: e } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (e) throw e;
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not remove 2FA. You may need to sign in again first.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-forest-900 dark:text-cream-100">
          <T>Two-factor authentication</T>
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
          <T>
            Add a second step at sign-in using an authenticator app (1Password,
            Authy, Google Authenticator). We don&rsquo;t use SMS codes, which are
            weaker. This is optional but strongly recommended for sensitive
            matters.
          </T>
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-500">
          <T>Checking your 2FA status&hellip;</T>
        </p>
      ) : enabled ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-900/20 p-4 space-y-3">
          <p className="text-sm text-emerald-900 dark:text-emerald-200 font-medium">
            <T>Two-factor authentication is on.</T>
          </p>
          {verified.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-700 dark:text-cream-100/80">
                {f.friendlyName || 'Authenticator app'}
              </span>
              <button
                type="button"
                onClick={() => remove(f.id)}
                disabled={busy}
                className="btn-ghost text-rose-700 hover:text-rose-900 hover:bg-rose-50 text-sm"
              >
                <T>Remove</T>
              </button>
            </div>
          ))}
        </div>
      ) : step === 'verifying' ? (
        <div className="rounded-lg border border-ink-200 dark:border-forest-700/40 p-4 space-y-4">
          <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
            <T>
              Scan this code in your authenticator app, then enter the 6-digit
              code it shows.
            </T>
          </p>
          {qr && (
            // Supabase returns an SVG data-URI; render it directly.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={t('Two-factor QR code')}
              className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
            />
          )}
          {secret && (
            <p className="text-center text-xs text-ink-500 dark:text-cream-100/55">
              <T>Or enter this key manually:</T>{' '}
              <code className="font-mono break-all" data-no-translate>
                {secret}
              </code>
            </p>
          )}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className="input text-center tracking-[0.4em] font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setStep('idle');
                setQr(null);
                setSecret(null);
                setCode('');
                setError(null);
              }}
              className="btn-ghost"
              disabled={busy}
            >
              <T>Cancel</T>
            </button>
            <button
              type="button"
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="btn bg-forest-900 text-cream-50 hover:bg-forest-800 dark:bg-cream-100 dark:text-forest-900"
            >
              {busy ? <T>Verifying&hellip;</T> : <T>Turn on 2FA</T>}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={startEnroll} disabled={busy} className="btn-secondary">
          {busy ? (
            <T>Starting&hellip;</T>
          ) : (
            <T>Set up two-factor authentication</T>
          )}
        </button>
      )}

      {error && (
        <p className="rounded-md border border-rose-300 bg-rose-100 dark:border-rose-700/50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}
