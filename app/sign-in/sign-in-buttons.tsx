'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { LoadingOverlay } from '@/components/LoadingOverlay';

type Provider = 'google' | 'azure';
type Mode = Provider | 'email';

export function SignInButtons({ next }: { next: string }) {
  const [pending, setPending] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  async function signInWithProvider(provider: Provider) {
    setError(null);
    setEmailSent(null);
    setPending(provider);
    try {
      const supabase = createBrowserSupabase();
      const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          // Microsoft (Azure) needs an explicit `User.Read` scope alongside
          // openid/profile/email to reliably return the user's email -
          // some tenants (especially personal accounts) skip email
          // otherwise, which makes Supabase fail to create the session.
          scopes:
            provider === 'azure'
              ? 'openid profile email User.Read offline_access'
              : undefined,
          queryParams:
            provider === 'azure'
              ? { prompt: 'select_account' }
              : undefined,
        },
      });
      if (authError) throw authError;
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Sign-in failed.';
      const friendly = /provider is not enabled|unsupported provider/i.test(raw)
        ? `${provider === 'azure' ? 'Microsoft' : 'Google'} sign-in isn't connected to this account yet. Use the email magic link below - or ask your admin to enable the ${provider === 'azure' ? 'Azure' : 'Google'} provider in Supabase.`
        : raw;
      setError(friendly);
      setPending(null);
    }
  }

  async function signInWithEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEmailSent(null);
    setPending('email');
    try {
      const supabase = createBrowserSupabase();
      const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (authError) throw authError;
      setEmailSent(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => signInWithProvider('google')}
        disabled={pending !== null}
        className="btn-secondary w-full"
      >
        {pending === 'google' ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => signInWithProvider('azure')}
        disabled={pending !== null}
        className="btn-secondary w-full"
      >
        {pending === 'azure' ? <Spinner /> : <MicrosoftIcon />}
        Continue with Microsoft
      </button>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-ink-200" />
        <span className="text-[11px] uppercase tracking-wider text-ink-400">or</span>
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <form onSubmit={signInWithEmail} className="space-y-2">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending !== null}
          className="input"
        />
        <button type="submit" disabled={pending !== null} className="btn-primary w-full">
          {pending === 'email' ? <Spinner /> : <MailIcon />}
          Send magic link
        </button>
      </form>

      {emailSent && (
        <p className="rounded-lg border border-forest-200 bg-cream-50 px-3 py-2 text-xs text-forest-900">
          Check {emailSent} for a sign-in link from Supabase.
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}

      {/* While the OAuth redirect is in flight, the page would otherwise
          stay interactive for a heartbeat - which feels broken. Show the
          full-screen loading veil for a calming "thinking" moment. */}
      <LoadingOverlay
        show={pending !== null && pending !== 'email'}
        label="Bringing you in"
      />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7l9 6 9-6M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
