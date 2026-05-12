import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/supabase/server';
import { cookieDomainForHost } from '@/lib/supabase/cookie-domain';

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
        friendly =
          'Sign-in started on one window and finished on another, or your browser cleared the temporary sign-in cookie. Open https://advottic.com/sign-in fresh in the same window and try again.';
      } else if (/unable to exchange external code|invalid client/i.test(raw)) {
        friendly =
          'The sign-in provider rejected the response. This is usually a temporary provider-side issue. Try again in a moment, or use a different provider (email magic link works without provider setup). If this keeps happening, email support@advottic.com.';
      }
      return redirectWithError(url, next, friendly);
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
    }
  } catch (blockErr) {
    console.error('[auth/callback] block-list check failed (continuing)', blockErr);
  }

  return successResponse;
}

function redirectWithError(requestUrl: URL, next: string, message: string) {
  const dest = new URL('/sign-in', requestUrl.origin);
  dest.searchParams.set('error', encodeURIComponent(message));
  dest.searchParams.set('next', next);
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
