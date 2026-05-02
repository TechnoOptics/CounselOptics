import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /welcome was historically auth-protected as a post-sign-in landing page;
// the new /welcome is a public install + sign-in page used as the share-app
// destination, so it must NOT require auth. Authenticated visitors get
// redirected to /cases inside the page itself.
const PROTECTED_PREFIXES = ['/cases', '/profile', '/admin', '/billing', '/feedback', '/counsel'];

// Publicly accessible routes that live UNDER a protected prefix. The
// /counsel namespace is invitation-only, but the public application form
// (/counsel/request) and the grant-redemption welcome page
// (/counsel/welcome) must be reachable without an account so prospective
// firms can apply and approved firms can redeem their setup link.
const PUBLIC_OVERRIDES = ['/counsel/request', '/counsel/welcome'];

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
  // Forward the EFFECTIVE pathname to server components via a request
  // header. Server components read it with `headers().get('x-pathname')`.
  // Used by the root layout to swap consumer chrome for counsel chrome
  // when on /counsel/* and for HQ chrome when on /admin/*.
  //
  // Special-case hq.advottic.com and enterprise.advottic.com: their URL
  // bars never show the internal route prefix ("/admin" or "/counsel"),
  // so paths look like hq.advottic.com/firms or
  // enterprise.advottic.com/clients. The routes still live under the
  // prefix (app/admin/X/page.tsx, app/counsel/X/page.tsx) - rewrites in
  // next.config.mjs map them. For x-pathname we report the canonical
  // prefixed path so chrome swap, auth check, and perspective detection
  // all see the path that matches the rendered route. No host-aware
  // branching needed in any consumer of the header.
  const host = request.headers.get('host') ?? '';
  const isHqHost = host === 'hq.advottic.com';
  const isEnterpriseHost = host === 'enterprise.advottic.com';
  const originalPath = request.nextUrl.pathname;
  const prefixForHost: string | null = isHqHost
    ? '/admin'
    : isEnterpriseHost
      ? '/counsel'
      : null;
  const effectivePath = prefixForHost
    ? originalPath === '/' || originalPath === ''
      ? prefixForHost
      : originalPath.startsWith(prefixForHost)
        ? originalPath
        : `${prefixForHost}${originalPath}`
    : originalPath;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', effectivePath);
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

    // Auth check uses the EFFECTIVE path so a request to
    // hq.advottic.com/firms (which resolves to /admin/firms) is
    // gated by the /admin protected prefix as expected.
    const isPublicOverride = PUBLIC_OVERRIDES.some(
      (p) => effectivePath === p || effectivePath.startsWith(p + '/'),
    );
    const needsAuth =
      !isPublicOverride &&
      PROTECTED_PREFIXES.some((p) => effectivePath === p || effectivePath.startsWith(p + '/'));
    if (needsAuth && !user) {
      const signInUrl = request.nextUrl.clone();
      signInUrl.pathname = '/sign-in';
      // Send unauthed users from hq.advottic.com or enterprise.advottic.com
      // to advottic.com/sign-in (apex). Supabase Auth's Allowed Redirect
      // URLs list only whitelists the apex /auth/callback - OAuth from a
      // sibling host falls back to Site URL and breaks. Sending unauthed
      // subdomain users straight to apex also avoids the www -> apex hop.
      if (isHqHost || isEnterpriseHost) {
        signInUrl.host = 'advottic.com';
      }
      // Preserve the original URL the user was trying to reach so we
      // can land them back there post-sign-in.
      signInUrl.searchParams.set('next', effectivePath);
      return NextResponse.redirect(signInUrl);
    }
  } catch (err) {
    // Surfacing the message to Vercel runtime logs, not the user.
    console.warn('[middleware] auth check failed; passing through:', err instanceof Error ? err.message : err);
  }

  return response;
}
