import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /welcome was historically auth-protected as a post-sign-in landing page;
// the new /welcome is a public install + sign-in page used as the share-app
// destination, so it must NOT require auth. Authenticated visitors get
// redirected to /cases inside the page itself.
const PROTECTED_PREFIXES = ['/cases', '/profile', '/admin', '/billing', '/feedback'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

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
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            request.cookies.set({ name, value, ...options });
            response = NextResponse.next({ request });
            response.cookies.set({ name, value, ...options });
          } catch {
            /* swallow - cookie set is best-effort in middleware */
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            request.cookies.set({ name, value: '', ...options });
            response = NextResponse.next({ request });
            response.cookies.set({ name, value: '', ...options });
          } catch {
            /* swallow - cookie remove is best-effort in middleware */
          }
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
