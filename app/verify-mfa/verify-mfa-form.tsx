'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';

type Factor = { id: string; friendlyName?: string | null; status: string };

export function VerifyMfaForm({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabase();
        // If this session is already AAL2 (e.g. the user opened this
        // page in a second tab after verifying in the first), skip
        // straight through rather than asking for a code that would
        // just fail as "already satisfied".
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!cancelled && aal?.currentLevel === 'aal2') {
          router.replace(next);
          return;
        }
        const { data, error: e } = await supabase.auth.mfa.listFactors();
        if (e) throw e;
        const verified = ((data?.totp ?? []) as Factor[]).find((f) => f.status === 'verified');
        if (!cancelled) setFactorId(verified?.id ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load your 2FA factor.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function verify() {
    if (!factorId || code.length !== 6) return;
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
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not match. Try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink-500">Checking your account…</p>;
  }

  if (!factorId) {
    // Shouldn't normally be reachable - middleware only sends users
    // here when Supabase itself reports a verified factor exists for
    // this session. Fail safe with a way back rather than a dead end.
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-700">
          {error ?? "Could not find a verified authenticator for this account."}
        </p>
        <a href="/profile" className="btn-secondary inline-block">
          Go to your profile
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && code.length === 6 && !busy) void verify();
        }}
        placeholder="123456"
        className="input text-center tracking-[0.4em] font-mono text-lg"
      />
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={verify}
        disabled={busy || code.length !== 6}
        className="btn bg-forest-900 text-cream-50 hover:bg-forest-800 dark:bg-cream-100 dark:text-forest-900 w-full justify-center"
      >
        {busy ? 'Verifying…' : 'Verify and continue'}
      </button>
    </div>
  );
}
