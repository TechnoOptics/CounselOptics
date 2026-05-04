'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { LoadingOverlay } from '@/components/LoadingOverlay';

type Provider = 'google' | 'azure' | 'apple';
type Mode = Provider | 'email';

/**
 * Sign-in surface. Apple is gated behind NEXT_PUBLIC_APPLE_ENABLED so
 * the button only renders when the .p8 secret is actually wired up
 * in Supabase - otherwise users see "Unsupported provider: missing
 * OAuth secret" at the callback. Set the env var to "1" in Vercel
 * once the Apple Developer credentials are pasted into the Supabase
 * Apple provider config.
 */
const APPLE_ENABLED =
  (process.env.NEXT_PUBLIC_APPLE_ENABLED ?? '').trim() === '1';

export function SignInButtons({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Once the magic-link email has been requested, verifyMode flips on
  // so the form renders the 6-digit OTP input instead of the email
  // box. Supabase sends BOTH a magic link AND the 6-digit token in
  // the same email by default, so users have two paths:
  //   - Click the link in the email (works on web; opens whichever
  //     browser the email client routes to, which on mobile may not
  //     be the same browser they started in - hence the OTP path)
  //   - Type the 6-digit code into the field below (always keeps the
  //     user in the same browser session, so on success the Supabase
  //     cookies land in the right place and they're signed in
  //     immediately).
  const [verifyMode, setVerifyMode] = useState(false);

  async function signInWithProvider(provider: Provider) {
    setError(null);
    setEmailSent(null);
    setPending(provider);
    try {
      const supabase = createBrowserSupabase();
      // Use the user's current origin, NOT NEXT_PUBLIC_SITE_URL - if the
      // user is on advottic.com (apex) but SITE_URL points at
      // www.advottic.com, the PKCE verifier cookie gets written to
      // apex while the OAuth callback comes back on www, and the
      // server-side exchange fails with "PKCE code verifier not
      // found in storage." Anchoring on window.location.origin keeps
      // the cookie and the callback on the same host.
      const origin = window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          // Microsoft (Azure) needs an explicit `User.Read` scope alongside
          // openid/profile/email to reliably return the user's email -
          // some tenants (especially personal accounts) skip email
          // otherwise, which makes Supabase fail to create the session.
          // Apple needs `name email` so we get the display name on first
          // sign-in (Apple only sends it once, ever, on the very first
          // authorization) - Supabase persists it on the auth.users row.
          scopes:
            provider === 'azure'
              ? 'openid profile email User.Read offline_access'
              : provider === 'apple'
                ? 'name email'
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
      const providerLabel =
        provider === 'azure' ? 'Microsoft' : provider === 'apple' ? 'Apple' : 'Google';
      const supabaseProviderName =
        provider === 'azure' ? 'Azure' : provider === 'apple' ? 'Apple' : 'Google';
      const friendly = /provider is not enabled|unsupported provider/i.test(raw)
        ? `${providerLabel} sign-in isn't connected to this account yet. Use the email magic link below - or ask your admin to enable the ${supabaseProviderName} provider in Supabase.`
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
      // Use the user's current origin, NOT NEXT_PUBLIC_SITE_URL - if the
      // user is on advottic.com (apex) but SITE_URL points at
      // www.advottic.com, the PKCE verifier cookie gets written to
      // apex while the OAuth callback comes back on www, and the
      // server-side exchange fails with "PKCE code verifier not
      // found in storage." Anchoring on window.location.origin keeps
      // the cookie and the callback on the same host.
      const origin = window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (authError) throw authError;
      setEmailSent(email.trim());
      setVerifyMode(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Sign-in failed.';
      // Supabase's per-email throttle returns
      //   "For security purposes, you can only request this after N seconds."
      // Parse the seconds and show a friendly countdown so a tester does not
      // think the form is broken when they click twice in quick succession.
      const m = /after\s+(\d+)\s+seconds?/i.exec(raw);
      if (m) {
        setError(
          `Just a moment - a magic link is already on its way to ${email.trim()}. Check your inbox (and spam). You can request another in ${m[1]} seconds.`,
        );
      } else if (/over_email_send_rate_limit|email rate limit/i.test(raw)) {
        setError(
          "We're sending sign-in emails as fast as we can. Try again in a minute, or use Google / Microsoft above.",
        );
      } else {
        setError(raw);
      }
    } finally {
      setPending(null);
    }
  }

  /**
   * Verify the 6-digit OTP code the user typed. This path keeps the
   * user in the SAME browser they started in, which is the whole
   * reason it exists - tapping the magic link in a mail client (Gmail,
   * Outlook on mobile, etc.) often opens the link in an in-app browser
   * separate from the original tab, so the session cookie lands
   * somewhere the original sign-in page can never see. Code entry
   * sidesteps that by establishing the session in the current browsing
   * context. After verifyOtp resolves, supabase has set its cookies
   * for the current origin; router.push hands off to the destination
   * and the server will see the new session on the next request.
   */
  async function verifyEmailCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending('email');
    try {
      const supabase = createBrowserSupabase();
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      });
      if (authError) throw authError;
      if (!data.session) {
        throw new Error('Sign-in succeeded but no session was returned. Try again.');
      }
      // The session cookies are set. Push to the requested destination
      // (defaults to /cases via the page wrapper). Use replace so the
      // sign-in page is dropped from history - users hitting Back from
      // /cases shouldn't bounce to the sign-in form.
      router.replace(next);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not verify the code.';
      const friendly = /token has expired|invalid|incorrect/i.test(raw)
        ? "That code didn't work. Codes expire after 1 hour and can only be used once. Request a fresh one below."
        : raw;
      setError(friendly);
    } finally {
      setPending(null);
    }
  }

  function startOver() {
    setVerifyMode(false);
    setEmailSent(null);
    setCode('');
    setError(null);
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
      {/* Apple-styled button per Apple's HIG: black surface, white
          glyph + label, "Sign in with Apple" wording. Required by
          App Store Review Guideline 4.8 because Google + Microsoft
          are also offered. Required by Apple's HIG that this button
          stand alone (don't squash it into the secondary palette).
          Only rendered when NEXT_PUBLIC_APPLE_ENABLED=1 - otherwise
          clicking it would land on Supabase's "missing OAuth secret"
          error because the .p8 secret hasn't been wired up yet. */}
      {APPLE_ENABLED && (
        <button
          type="button"
          onClick={() => signInWithProvider('apple')}
          disabled={pending !== null}
          className="btn w-full bg-black text-white hover:bg-zinc-900 border border-black font-medium"
        >
          {pending === 'apple' ? <Spinner /> : <AppleIcon />}
          Sign in with Apple
        </button>
      )}

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-ink-200" />
        <span className="text-[11px] uppercase tracking-wider text-ink-400">or</span>
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      {!verifyMode ? (
        <form onSubmit={signInWithEmail} className="space-y-2">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending !== null}
            className="input"
            autoComplete="email"
            inputMode="email"
          />
          <button type="submit" disabled={pending !== null} className="btn-primary w-full">
            {pending === 'email' ? <Spinner /> : <MailIcon />}
            Email me a sign-in code
          </button>
        </form>
      ) : (
        <form onSubmit={verifyEmailCode} className="space-y-2">
          <p className="rounded-lg border border-forest-200 bg-cream-50 px-3 py-2 text-xs text-forest-900 leading-relaxed">
            We sent a 6-digit code to <strong>{emailSent}</strong>. Type it below to sign in
            here, or click the link in the email - either works.
          </p>
          <input
            type="text"
            required
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={pending !== null}
            className="input tracking-[0.4em] text-center font-mono text-lg"
            // inputMode="numeric" pulls up the digit pad on mobile;
            // autoComplete="one-time-code" lets iOS / Android suggest
            // the code straight from the email notification banner so
            // the user can tap once instead of switching apps.
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            minLength={6}
            pattern="\d{6}"
          />
          <button
            type="submit"
            disabled={pending !== null || code.length !== 6}
            className="btn-primary w-full"
          >
            {pending === 'email' ? <Spinner /> : <MailIcon />}
            Sign in
          </button>
          <button
            type="button"
            onClick={startOver}
            disabled={pending !== null}
            className="text-xs text-ink-500 hover:text-ink-900 underline w-full text-center"
          >
            Use a different email
          </button>
        </form>
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

function AppleIcon() {
  // Glyph from Apple's published "Sign in with Apple" guidance, in
  // pure white at the same visual weight as the other provider icons.
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
      <path
        fill="currentColor"
        d="M11.66 8.51c-.02-2.05 1.67-3.03 1.75-3.08-.96-1.4-2.45-1.59-2.97-1.61-1.27-.13-2.47.74-3.11.74-.65 0-1.64-.72-2.7-.7-1.39.02-2.67.81-3.38 2.04-1.44 2.5-.37 6.21 1.04 8.24.69.99 1.5 2.1 2.57 2.06 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.69.64 1.11-.02 1.81-1.01 2.5-2 .79-1.16 1.11-2.28 1.13-2.34-.02-.01-2.16-.83-2.18-3.33zM9.55 2.57c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.23-.53.61-.99 1.59-.87 2.52.91.07 1.85-.46 2.42-1.15z"
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
