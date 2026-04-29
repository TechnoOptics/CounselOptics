import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /welcome was historically auth-protected as a post-sign-in landing page;
// the new /welcome is a public install + sign-in page used as the share-app
// destination, so it must NOT require auth. Authenticated visitors get
// redirected to /cases inside the page itself.
const PROTECTED_PREFIXES = ['/cases', '/profile', '/admin', '/billing', '/feedback', '/counsel'];

/**
 * Edge auth-refresh middleware.
 *
 * Uses the @supabase/ssr `getAll`/`setAll` adapter pattern (required since
 * 0.5). The earlier `get`/`set`/`remove` shape recreated the NextResponse
 * inside every `set` call, which silently dropped earlier chunks when
 * Supabase split a large auth cookie - the visible symptom was OAuth
 * sign-in (especially Microsoft, where sessions are big enough to chunk)
 * appearing successful but landing the user back on /sign-in because the
 * chunked session never made it to the browser intact.
 */
export async function updateSession(request: NextRequest) {
  // Forward the current pathname to server components via a request
  // header. Server components can read it with `headers().get('x-pathname')`.
  // Used by the root layout to swap consumer chrome for counsel chrome
  // when the visitor is on /counsel/*.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Supabase not configured - let the app render its setup state.
    return response;
  }

  // Anything below can throw on Edge: a transient Supabase hiccup, a flaky
  // cookie callback, or an unexpected payload. We never want middleware to
  // 500 the whole site (MIDDLEWARE_INVOCATION_FAILED) - if auth lookup fails
  // we fall through to the page, which already handles its own auth state.
  try {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mirror cookies onto the request so further server-side reads in
          // this middleware see the fresh values.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Recreate the response ONCE, then attach every cookie in one go.
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const needsAuth = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
    if (needsAuth && !user) {
      const signInUrl = request.nextUrl.clone();
      signInUrl.pathname = '/sign-in';
      signInUrl.searchParams.set('next', path);
      return NextResponse.redirect(signInUrl);
    }
  } catch (err) {
    // Surfacing the message to Vercel runtime logs, not the user.
    console.warn('[middleware] auth check failed; passing through:', err instanceof Error ? err.message : err);
  }

  return response;
}
