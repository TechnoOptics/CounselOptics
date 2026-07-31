import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/supabase/server';
import { cookieDomainForHost } from '@/lib/supabase/cookie-domain';
import { logSecurityEvent, requestMeta } from '@/lib/security-audit';

export const dynamic = 'force-dynamic';

/**
 * OAuth + magic-link callback.
 *
 * Uses the @supabase/ssr `getAll`/`setAll` cookie adapter (the shape
 * required since 0.5). The older per-cookie `set` callback recreated
 * the outgoing NextResponse on each call, which silently dropped earlier
 * chunks when supabase split a large auth cookie - the visible symptom
 * was Microsoft sign-in succeeding at the provider but landing back on
 * /sign-in because the chunked session never made it to the browser.
 *
 * `setAll` receives the full batch in one call, so we attach every
 * cookie to the same redirect response and ship it.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const oauthErrorDesc = url.searchParams.get('error_description');
  const nextParam = url.searchParams.get('next');
  // `next` accepts a same-origin path (most common) or an absolute
  // https://<slug>.advottic.com URL (Phase 2 tenant subdomain bounce).
  // Anything else falls back to /cases to keep open-redirect closed.
  const next = sanitizeNextRedirect(nextParam);

  // NATIVE RETURN BRIDGE (?native=1) - see docs/APPLE_SIGNIN_DIAGNOSIS.md.
  //
  // Sign in with Apple is the one provider whose response comes back to
  // Supabase as a cross-site form POST (Apple sets response_mode=form_post
  // whenever `name email` scopes are requested). The 302 Supabase then
  // issues in reply to that POST is what has to carry the browser out of
  // the SFSafariViewController the app opened and back into the app. A
  // redirect straight to the com.advottic.app:// custom scheme does not
  // reliably make that jump on iOS, so the auth code Supabase minted is
  // simply never handed to the app: on 2026-07-29 App Review completed
  // Apple sign-in twice, Supabase issued a code both times, and zero
  // sessions were created.
  //
  // So Apple now redirects here, to a plain https URL the Safari sheet is
  // always willing to load, and THIS page performs the hop into the app.
  // It runs no exchange of its own on purpose: the PKCE verifier lives in
  // the app WebView's cookie jar, not the Safari sheet's, so the exchange
  // can only succeed back inside the app (which app/sign-in already does
  // in its appUrlOpen handler). The page auto-navigates to the custom
  // scheme and also offers a real button, because a user tap is the one
  // navigation iOS always honours.
  //
  // Only the native shell ever sets native=1, so the web flow below is
  // untouched.
  if (url.searchParams.get('native') === '1') {
    return nativeReturnBridge({
      code,
      oauthError,
      oauthErrorDesc,
      next,
    });
  }

  if (oauthError) {
    console.error('[auth/callback] provider returned error', {
      oauthError,
      oauthErrorDesc,
    });
    // Common case: an already-used or expired magic link. Supabase
    // returns "access_denied" / "otp_expired" with a description like
    // "Email link is invalid or has expired." If the user actually
    // does have a valid session already (very common - they clicked
    // the link a second time after signing in successfully on the
    // first click), just send them through.
    const errorCode = url.searchParams.get('error_code') ?? '';
    const looksLikeUsedMagicLink =
      /otp_expired|access_denied|invalid|expired|token/i.test(
        `${errorCode} ${oauthError} ${oauthErrorDesc}`,
      );
    if (looksLikeUsedMagicLink) {
      const supabaseUrl = getSupabaseUrl();
      const anonKey = getSupabaseAnonKey();
      if (supabaseUrl && anonKey) {
        const probe = createServerClient(supabaseUrl, anonKey, {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll() {
              /* probe-only; no cookies to write */
            },
          },
        });
        const {
          data: { user },
        } = await probe.auth.getUser();
        if (user) {
          // Already signed in. The expired-link click is harmless;
          // just send them where they were going.
          return NextResponse.redirect(new URL(next, url.origin));
        }
      }
      return redirectWithError(
        url,
        next,
        "That sign-in link has already been used or has expired. Each link works once and lasts an hour. Enter your email below for a fresh one - or use Google / Microsoft.",
      );
    }
    const friendly =
      oauthErrorDesc?.replace(/\+/g, ' ') ||
      `Sign-in failed (${oauthError}). The provider may not be enabled in Supabase.`;
    return redirectWithError(url, next, friendly);
  }

  if (!code) {
    console.error('[auth/callback] missing code param', { url: url.toString() });
    return redirectWithError(
      url,
      next,
      "Sign-in didn't complete - the link may have already been used or expired (each magic link works once and lasts an hour). Try requesting a fresh one below.",
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    console.error('[auth/callback] supabase not configured');
    return redirectWithError(url, next, 'Sign-in is not configured on the server.');
  }

  // Pre-build the success response so the supabase cookie adapter can
  // attach the freshly-issued auth cookies (potentially chunked into
  // several Set-Cookie headers) directly onto the exact redirect we'll
  // ship back to the browser.
  const successResponse = NextResponse.redirect(new URL(next, url.origin));

  // Scope auth cookies to .advottic.com so a session minted here travels
  // to hq.advottic.com and enterprise.advottic.com without forcing
  // another sign-in bounce per subdomain.
  const cookieDomain = cookieDomainForHost(request.headers.get('host'));
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          successResponse.cookies.set(name, value, {
            ...options,
            ...(cookieDomain ? { domain: cookieDomain } : {}),
          });
        });
      },
    },
  });

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', {
        message: error.message,
        status: error.status,
      });
      // Translate the most common Supabase exchange failures into copy
      // a user can act on.
      //
      //  - "code verifier" -> the PKCE cookie was missing or mismatched
      //    between the host that started the flow and the host that
      //    received the callback. Forcing a retry from the apex host
      //    fixes it 95% of the time, so we tell the user to do that.
      //
      //  - "Unable to exchange external code" -> Supabase received the
      //    auth code from the provider (Google / Microsoft / Apple)
      //    but the provider rejected the token-exchange call. This is
      //    almost always a provider-side config issue: the redirect URI
      //    in the provider's app does not match the Supabase callback
      //    URL, or the client secret expired. We can not fix this from
      //    our app; surface a helpful instructions snippet pointing
      //    the user at support and the operator at the right Azure /
      //    Google docs.
      const raw = error.message ?? '';
      let friendly = raw;
      if (/code verifier|pkce|state.*mismatch/i.test(raw)) {
        // PKCE verifier cookie didn't survive the round-trip. Fires
        // in two distinct scenarios:
        //   (a) Magic-link email opened in a different browser than
        //       the one that requested sign-in (Outlook -> Edge while
        //       you're in Opera). The cookie sits with the requester.
        //   (b) OAuth round-trip (Microsoft/Google/Apple) dropped the
        //       cookie. Common causes in Opera: built-in VPN rotated
        //       the exit IP between request and callback, Tracking
        //       Protection stripped third-party cookies during the
        //       provider redirect, or strict-cookie mode dropped it.
        // We sniff the referrer to give per-case advice; if we can't
        // tell, we list both possibilities.
        const ref = request.headers.get('referer') ?? '';
        const fromMicrosoft = /login\.microsoftonline\.com|login\.live\.com/i.test(ref);
        const fromGoogle = /accounts\.google\.com/i.test(ref);
        const fromApple = /appleid\.apple\.com/i.test(ref);
        const fromOauthProvider = fromMicrosoft || fromGoogle || fromApple;
        if (fromOauthProvider) {
          const providerName = fromMicrosoft
            ? 'Microsoft'
            : fromGoogle
              ? 'Google'
              : 'Apple';
          friendly =
            `Sign-in with ${providerName} got back here, but the security cookie that started the flow was dropped along the way. This usually means a browser-level cookie or tracking block on the redirect - in Opera, the built-in VPN or Tracking Protection are the most common cause. Try: (1) turn off Opera's VPN for this site (click the VPN badge in the URL bar), (2) allow third-party cookies for advottic.com under Site settings, then sign in again. Or use the email + 6-digit code path below, which doesn't depend on any cookie surviving the round-trip.`;
        } else {
          friendly =
            "We can't finish here because the security cookie didn't survive the round-trip. If you used an email sign-in link, it most likely opened in a different browser than the one you started in - go back to that browser. Either way, the easiest fix is to use the email + 6-digit code path below; it works across any browser or device.";
        }
      } else if (/unable to exchange external code|invalid client/i.test(raw)) {
        friendly =
          'The sign-in provider rejected the response. This is usually a temporary provider-side issue. Try again in a moment, or use the email + 6-digit code path below (magic link works without any provider). If this keeps happening, email support@advottic.com.';
      }
      // Tag the redirect with a reason so the sign-in page can render
      // a richer "use the 6-digit code" hint panel instead of just
      // the error string.
      return redirectWithError(url, next, friendly, 'pkce');
    }
  } catch (err) {
    console.error('[auth/callback] exchangeCodeForSession threw', err);
    const msg = err instanceof Error ? err.message : 'Sign-in failed.';
    return redirectWithError(url, next, msg);
  }

  // Block-list check: if profiles.is_blocked is true for this user, sign
  // them right back out and surface a friendly message. Wrapped in
  // try/catch so a transient profiles-table read error never strands an
  // otherwise valid session at the sign-in page.
  //
  // Also resolves the default post-sign-in landing: a firm owner/member
  // belongs in the Counsel workspace, not the consumer /cases app. The
  // sign-in page bakes `next=/cases` into this callback URL whenever the
  // user didn't request a specific destination, so we treat a bare
  // `/cases` as the overridable default and send firm members to
  // /counsel. Any deliberate deep link (e.g. /cases/<id>, /inbox) is
  // left untouched.
  let landingOverride: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_blocked')
        .eq('id', user.id)
        .maybeSingle();
      if ((profile as { is_blocked: boolean | null } | null)?.is_blocked) {
        await supabase.auth.signOut();
        return redirectWithError(
          url,
          '/sign-in',
          "Your account is blocked or inactive. If you believe this is a mistake, reach out to contact@advottic.com.",
        );
      }
      // Audit a successful sign-in (HIPAA 164.312(b) access logging).
      const meta = requestMeta(request);
      await logSecurityEvent({
        kind: 'login',
        userId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        url: meta.url,
        details: { email: user.email },
      });
      // Persona-aware default landing (see block comment above). Use
      // THIS client (it holds the freshly-minted session) rather than a
      // fresh cookies()-based client, which wouldn't see the new session
      // yet. RLS scopes firm_members to the caller automatically.
      //
      // The consumer collaborator invite email bakes `next=/cases?welcome=1`,
      // so we treat any `/cases`-prefixed destination as the overridable
      // default here (a deliberate non-cases deep link is left untouched).
      const isCasesDefault =
        next === '/cases' || next === '/cases/' || next.startsWith('/cases?');
      if (isCasesDefault) {
        const { data: memberRows } = await supabase
          .from('firm_members')
          .select('id')
          .eq('user_id', user.id)
          .limit(1);
        if (memberRows && memberRows.length > 0) {
          landingOverride = '/counsel';
        } else {
          // Case-scoped co-counsel GUEST (attorney collaborator, not a firm
          // member) belongs in the firm-framed Counsel view of their matter,
          // not the consumer app. RLS lets the user read their own
          // collaborator + guest rows through this session-scoped client.
          const { data: guestRow } = await supabase
            .from('firm_guest_accounts')
            .select('deactivated_at, must_change_password')
            .eq('user_id', user.id)
            .maybeSingle();
          const g = guestRow as
            | { deactivated_at: string | null; must_change_password: boolean }
            | null;
          if (g?.deactivated_at) {
            // Deactivated guest - fail closed, don't route them into a matter.
          } else {
            const { data: collab } = await supabase
              .from('case_collaborators')
              .select('case_id')
              .eq('user_id', user.id)
              .eq('role', 'attorney')
              .limit(1);
            const firstCaseId = (collab as { case_id: string }[] | null)?.[0]?.case_id;
            if (g?.must_change_password) {
              landingOverride = '/counsel/guest/password';
            } else if (firstCaseId) {
              landingOverride = `/counsel/cases/${firstCaseId}`;
            } else if (g) {
              landingOverride = '/counsel/guest';
            }
          }
        }
      }
    }
  } catch (blockErr) {
    console.error('[auth/callback] block-list check failed (continuing)', blockErr);
  }

  if (landingOverride) {
    // Re-anchor the redirect on the Counsel workspace while carrying
    // over every auth cookie the exchange attached to successResponse.
    const dest = NextResponse.redirect(new URL(landingOverride, url.origin));
    for (const cookie of successResponse.cookies.getAll()) {
      dest.cookies.set(cookie);
    }
    return dest;
  }

  return successResponse;
}

/**
 * Custom scheme the iOS and Android shells register for deep links. Kept
 * in sync with CFBundleURLSchemes in .github/workflows/ios-release.yml
 * and the Android intent-filter, and with the redirect the sign-in page
 * builds for Google and Microsoft.
 */
const NATIVE_SCHEME = 'com.advottic.app';

/**
 * Hand an OAuth result back to the native shell.
 *
 * Returns a small https page (which the in-app Safari sheet will always
 * load) that immediately navigates to com.advottic.app://auth/callback
 * carrying the auth code. The app's appUrlOpen listener picks it up and
 * runs exchangeCodeForSession inside the WebView, where the PKCE verifier
 * cookie actually lives.
 *
 * The visible button is not decoration. If the automatic hop is blocked,
 * a tap is a user gesture, and iOS opens app URLs from a user gesture
 * even where it declines to follow an automatic redirect.
 */
function nativeReturnBridge({
  code,
  oauthError,
  oauthErrorDesc,
  next,
}: {
  code: string | null;
  oauthError: string | null;
  oauthErrorDesc: string | null;
  next: string;
}) {
  const params = new URLSearchParams();
  if (code) params.set('code', code);
  if (oauthError) params.set('error', oauthError);
  if (oauthErrorDesc) params.set('error_description', oauthErrorDesc);
  params.set('next', next);
  // Built as a string rather than through the URL constructor: this is a
  // non-http scheme and we want the exact shape the app matches on.
  const deepLink = `${NATIVE_SCHEME}://auth/callback?${params.toString()}`;
  // Only ever interpolated into an href and a JS string literal, both of
  // which are escaped here. code/error/next are already query-encoded by
  // URLSearchParams; this closes the HTML and script-context holes.
  const hrefSafe = deepLink
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const jsSafe = JSON.stringify(deepLink).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Returning to Advottic</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #0F2D24;
    color: #F6F3EC;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; box-sizing: border-box; text-align: center;
  }
  .card { max-width: 22rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.875rem; line-height: 1.6; margin: 0 0 1.5rem; opacity: 0.8; }
  a.btn {
    display: block; padding: 0.875rem 1.25rem; border-radius: 0.625rem;
    background: #F6F3EC; color: #0F2D24; font-size: 0.9375rem;
    font-weight: 600; text-decoration: none;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Signing you in</h1>
    <p>One moment while we take you back to Advottic. If nothing happens, use the button below.</p>
    <a class="btn" id="return" href="${hrefSafe}">Return to Advottic</a>
  </div>
  <script>
    (function () {
      var target = ${jsSafe};
      try { window.location.replace(target); } catch (e) {}
      setTimeout(function () {
        try { document.getElementById('return').click(); } catch (e) {}
      }, 900);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      // The page carries a single-use auth code in its markup. Keep it
      // out of any referrer and out of frames.
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
  });
}

function redirectWithError(
  requestUrl: URL,
  next: string,
  message: string,
  reason?: string,
) {
  const dest = new URL('/sign-in', requestUrl.origin);
  dest.searchParams.set('error', encodeURIComponent(message));
  dest.searchParams.set('next', next);
  // Optional structured reason (e.g. "pkce") so the sign-in page can
  // surface a dedicated panel instead of just rendering the error
  // string. Free-form so we can extend it without coordinating both
  // sides at once.
  if (reason) dest.searchParams.set('reason', reason);
  return NextResponse.redirect(dest);
}

/**
 * Whitelist `next` for redirects from the OAuth + magic-link callback.
 * Same-origin paths (`/cases`) pass through. Absolute URLs only pass
 * if the host is advottic.com or a *.advottic.com subdomain - this
 * supports the Phase 2 tenant-subdomain bounce (apex `/sign-in?next=https://zinpro.advottic.com/clients`)
 * without opening up to attacker-controlled hosts.
 */
function sanitizeNextRedirect(raw: string | null): string {
  if (!raw) return '/cases';
  // Audit 2026-05-12 P0-1: defensive against `next` arriving double-encoded
  // (e.g. `%252Fcases` for `/cases`). Peel off encoding layers until the
  // path starts with `/` or stops looking encoded. Cap at 3 passes.
  let depth = 0;
  while (depth < 3 && /^(%25)+(2F|3A)/i.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded === raw) break;
      raw = decoded;
      depth++;
    } catch {
      break;
    }
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return '/cases';
    const h = u.host.toLowerCase();
    if (h === 'advottic.com' || h.endsWith('.advottic.com')) {
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return '/cases';
}
