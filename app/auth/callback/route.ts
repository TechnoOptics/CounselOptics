import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/supabase/server';

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
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/cases';

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

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          successResponse.cookies.set(name, value, options);
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
      return redirectWithError(url, next, error.message);
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
