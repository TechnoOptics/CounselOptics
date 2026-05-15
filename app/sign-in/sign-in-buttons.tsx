'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
// Capacitor is loaded lazily inside the OAuth handlers (line ~221).
// Static-importing @capacitor/core here runs the plugin's module-load
// side effects on every server-side render of the sign-in page,
// which surfaces as React error #419 when SSR aborts inside the
// Suspense boundary around `<Suspense>{children}</Suspense>` in
// app/layout.tsx. The hands-on V3 audit traced 29 such crashes on
// /sign-in?next=/admin and the OAuth callback.
import { createBrowserSupabase } from '@/lib/supabase/client';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { BiometricSignInHint } from '@/components/BiometricSignInHint';

/**
 * Pre-flight cleanup before any auth flow.
 *
 * Two real-world failure modes this fixes:
 *
 * 1. Stale host-scoped Supabase cookies. Before the apex-canonical
 *    migration the browser stored auth cookies as host-scoped on
 *    www.advottic.com (no Domain attribute). After the migration new
 *    cookies are written with Domain=.advottic.com. Browsers keep BOTH
 *    and send both at lookup time. The server reads whichever it
 *    encounters first, which is sometimes the stale one, causing
 *    "PKCE code verifier not found in storage" even though a brand-
 *    new verifier was just written.
 *
 * 2. Half-finished previous OAuth attempts. If a user clicked Sign
 *    in with Microsoft, the exchange failed mid-flow, and they then
 *    click Sign in with Google, the leftover Microsoft-flow verifier
 *    can shadow the new Google one if the cookie names collide.
 *
 * The fix: explicitly delete the PKCE verifier cookie on multiple
 * Domain attributes before starting a new flow. We do NOT touch
 * the actual session cookie (sb-...-auth-token) so an already-signed-
 * in user staying on /sign-in does not get logged out. Only the
 * "code-verifier" cookie family is cleared.
 *
 * The Supabase project ref comes from NEXT_PUBLIC_SUPABASE_URL.
 */
function clearStalePkceCookies() {
  if (typeof document === 'undefined') return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Extract the project ref - the hostname is <ref>.supabase.co.
  const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\./i);
  const ref = match?.[1];
  if (!ref) return;
  const expiredAttrs = 'Max-Age=0; Path=/';
  const baseNames = [
    `sb-${ref}-auth-token-code-verifier`,
  ];
  // Cookies can be chunked across .0 .1 .2 etc. when they are large.
  // Verifier is small enough not to chunk, but cover a few just in case.
  for (const base of baseNames) {
    const variants = [base, `${base}.0`, `${base}.1`, `${base}.2`];
    for (const name of variants) {
      // Host-scoped (no Domain) - clears the pre-migration cookies.
      document.cookie = `${name}=; ${expiredAttrs}`;
      // Domain-scoped .advottic.com - clears the post-migration cookies.
      document.cookie = `${name}=; ${expiredAttrs}; Domain=.advottic.com`;
      // Domain-scoped advottic.com (no leading dot) - some browsers
      // treat these as distinct from .advottic.com. Clear both.
      document.cookie = `${name}=; ${expiredAttrs}; Domain=advottic.com`;
    }
  }
}

/**
 * If the user clicked Sign In on www.advottic.com (somehow without
 * the edge-level www-to-apex redirect having fired - happens on rare
 * Safari + cached-redirect combinations), force a hard navigation to
 * the apex /sign-in BEFORE we set the PKCE verifier cookie. The
 * verifier is anchored to whatever host writes it; mixing hosts
 * across the OAuth roundtrip is the #1 cause of the "code verifier
 * not found" error.
 *
 * Returns true if a redirect was triggered (caller should not
 * continue with the flow on this tick).
 */
function forceApexBeforeAuth(next: string): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (host !== 'www.advottic.com') return false;
  const target = new URL('/sign-in', 'https://advottic.com');
  target.searchParams.set('next', next);
  window.location.replace(target.toString());
  return true;
}

/**
 * Native Sign in with Apple needs a nonce dance:
 *   - Apple embeds SHA256(nonce) in the returned id_token.
 *   - Supabase's signInWithIdToken re-hashes the RAW nonce we give
 *     it and compares, to prove the token was minted for THIS
 *     request (replay protection).
 * So we generate a raw random string, send its SHA-256 to Apple,
 * and hand the raw value to Supabase. Web Crypto is available in the
 * Capacitor WKWebView/Android WebView and in every browser.
 */
function cryptoRandomString(byteLen = 32): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

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

  // Navigate after a successful sign-in. Most of the time `next` is a
  // same-origin path like "/cases" and router.replace handles it. For
  // Phase 2 white-label, the apex /sign-in can receive an absolute
  // <slug>.advottic.com URL when a tenant subdomain bounced an unauthed
  // visitor through the apex - in that case we have to do a full-page
  // navigation because router.replace cannot cross hosts. The auth
  // cookie is Domain=.advottic.com so the session travels with the
  // navigation. sanitizeNext on the server already validated the URL is
  // on advottic.com, so this cannot land on an attacker-controlled host.
  function goNext(target: string) {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      window.location.href = target;
      return;
    }
    router.replace(target);
  }
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
    // Pre-flight: if we landed on www somehow, bounce to apex first.
    // Returns true if a redirect was triggered; in that case stop here
    // and let the next page render run the flow on the right host.
    if (forceApexBeforeAuth(next)) return;
    // Pre-flight: nuke any leftover PKCE verifier cookies from a
    // previous (perhaps failed) attempt. Prevents the host-vs-domain
    // cookie shadowing that produces "PKCE code verifier not found".
    clearStalePkceCookies();
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
      const oauthOptions = {
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
        // `prompt: select_account` forces the provider to show the
        // account chooser instead of silently re-using the last
        // signed-in session. Without this, a user who is already
        // signed into Google in this browser is signed straight into
        // Advottic under THAT identity - even if they came to /sign-in
        // specifically to switch accounts. Microsoft has always set
        // this; Google had been omitted (default was "use whichever
        // Google account is sitting in chrome.google.com"). Apple
        // doesn't honor prompt= but its native sheet always shows
        // the chooser, so it's a no-op there.
        queryParams:
          provider === 'azure' || provider === 'google'
            ? { prompt: 'select_account' }
            : undefined,
      };

      // Native shells (iOS / Android Capacitor) need a different OAuth
      // dance than the web. On the web Supabase just does
      //   window.location.href = oauthUrl
      // and after the provider redirects back to /auth/callback, the
      // page handles the exchange in the same browser context.
      //
      // On native that breaks: tapping "Continue with Google" launches
      // the OAuth provider in a Custom Tab (Android) or SFSafariViewController
      // (iOS), and after Supabase redirects back to advottic.com/auth/callback
      // the user is stranded INSIDE that browser tab - the cookies land
      // in the web context and never make it back into the app's WebView.
      //
      // The fix is the standard mobile OAuth pattern:
      //   1. Ask Supabase for the OAuth URL but skipBrowserRedirect.
      //   2. Open it ourselves with @capacitor/browser so we control the tab.
      //   3. Subscribe to App.appUrlOpen BEFORE opening - the autoVerify
      //      App Link on advottic.com/auth/callback (assetlinks.json is
      //      hosted under /.well-known/) routes the redirect back into
      //      the app as a deep link.
      //   4. When the deep link fires, close the in-app browser and
      //      hand the URL off to the WebView's /auth/callback route,
      //      which exchanges the code server-side - the WebView's
      //      cookie jar is the same origin (advottic.com) so the new
      //      session lands in the right place.
      // The native fix only works on AABs that bundle the @capacitor/browser
      // plugin (versionCode 6+). Older shells (v1.0.2 / versionCode 5) fall
      // through to the web flow, which is the same broken-but-survivable
      // experience they had before this hotfix - they will pick up the new
      // path automatically once Play auto-updates them.
      const { Capacitor } = await import('@capacitor/core');

      // ===================================================================
      // NATIVE ON-DEVICE SIGN-IN (no browser at all)
      // ===================================================================
      // The user explicitly does not want OAuth punted to a browser
      // sheet. For Apple on iOS we use the OS-native
      // ASAuthorizationController sheet (@capacitor-community/apple-
      // sign-in) and hand the resulting identity token straight to
      // Supabase via signInWithIdToken. No SFSafariViewController, no
      // Universal Link round-trip - the system Apple sheet slides up
      // over the app and the session lands directly in the WebView
      // cookie jar.
      //
      // This is ADDITIVE and FAIL-SAFE: any failure that is not an
      // explicit user-cancel falls through to the existing browser /
      // web OAuth flow below, so sign-in can never regress (old shells
      // without the plugin, or before the Supabase Apple provider
      // lists com.advottic.app as an authorized client ID, just keep
      // the previous behavior).
      //
      // Google native needs iOS/Android OAuth client IDs provisioned
      // in Google Cloud + registered on Supabase's Google provider, so
      // it stays on the browser flow until those exist. Microsoft has
      // no native Supabase signInWithIdToken path and stays on the
      // browser flow by design.
      if (
        provider === 'apple' &&
        Capacitor.getPlatform() === 'ios' &&
        Capacitor.isPluginAvailable('SignInWithApple')
      ) {
        try {
          const { SignInWithApple } = await import(
            '@capacitor-community/apple-sign-in'
          );
          const rawNonce = cryptoRandomString();
          const hashedNonce = await sha256Hex(rawNonce);
          const appleResult = await SignInWithApple.authorize({
            // The native client ID is the app bundle ID (NOT the web
            // Services ID). Supabase's Apple provider must list this
            // under "Authorized Client IDs" or it rejects the token
            // with "Unacceptable audience" - in which case we fall
            // through to the browser flow.
            clientId: 'com.advottic.app',
            redirectURI: `${origin}/auth/callback`,
            scopes: 'email name',
            nonce: hashedNonce,
          });
          const idToken = appleResult.response?.identityToken;
          if (!idToken) {
            throw new Error('Apple returned no identity token.');
          }
          const { error: idErr } = await supabase.auth.signInWithIdToken({
            provider: 'apple',
            token: idToken,
            nonce: rawNonce,
          });
          if (idErr) throw idErr;
          // Session cookies are set on advottic.com (the WebView
          // origin). Hand off to the destination.
          goNext(next);
          return;
        } catch (nativeErr) {
          const m =
            nativeErr instanceof Error
              ? nativeErr.message
              : String(nativeErr);
          // User dismissed the native sheet on purpose - do NOT then
          // pop a browser at them; just reset and let them retry.
          if (
            /cancel|1001|user canceled|the operation couldn.?t be completed/i.test(
              m,
            )
          ) {
            setPending(null);
            return;
          }
          // Plugin/config failure - fall through to the browser/web
          // OAuth flow so sign-in still works.
          console.warn(
            '[auth] native Apple sign-in failed, falling back to browser flow:',
            m,
          );
        }
      }
      // ===================================================================

      const browserAvailable =
        Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Browser');
      if (browserAvailable) {
        const [{ App }, { Browser }] = await Promise.all([
          import('@capacitor/app'),
          import('@capacitor/browser'),
        ]);

        // Arm the deep-link listener BEFORE asking for the OAuth URL,
        // so we never miss the redirect even if the provider is fast.
        const sub = await App.addListener('appUrlOpen', async ({ url }) => {
          if (!url.includes('/auth/callback')) return;
          await sub.remove();
          // Close the OAuth tab so the user is no longer staring at
          // the spinner in the browser - the app takes over from here.
          try {
            await Browser.close();
          } catch {
            // Harmless if the tab already self-closed (iOS sometimes
            // does this after a redirect chain).
          }
          // Navigate the WebView to the callback URL. This runs the
          // server-side route handler at /auth/callback, which calls
          // exchangeCodeForSession with the PKCE verifier from the
          // WebView's cookie jar and sets the new auth cookies on
          // advottic.com (which IS the WebView's origin).
          try {
            const u = new URL(url);
            router.replace(u.pathname + u.search);
          } catch {
            router.replace(next);
          }
        });

        const { data, error: authError } = await supabase.auth.signInWithOAuth({
          provider,
          options: { ...oauthOptions, skipBrowserRedirect: true },
        });
        if (authError) {
          await sub.remove();
          throw authError;
        }
        if (!data?.url) {
          await sub.remove();
          throw new Error('Sign-in URL was not returned by the auth provider.');
        }
        await Browser.open({ url: data.url, presentationStyle: 'fullscreen' });
        return;
      }

      // Web flow: Supabase JS handles the redirect itself.
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: oauthOptions,
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
    if (forceApexBeforeAuth(next)) return;
    clearStalePkceCookies();
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
      // The session cookies are set. Hand off to the requested
      // destination (defaults to /cases via the page wrapper).
      // goNext handles both same-origin paths and cross-host
      // *.advottic.com URLs (Phase 2 tenant subdomains).
      goNext(next);
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
      {/* Native shells with biometric hardware but not yet enrolled
          see this hint above the OAuth buttons. Enrolled users land
          on BiometricUnlockGate instead, which replaces the form
          entirely. Web is a no-op. */}
      <BiometricSignInHint />
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
