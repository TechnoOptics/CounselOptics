import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieDomainForHost } from './cookie-domain';
import { getFirmBySubdomain, RESERVED_SUBDOMAINS } from '@/lib/firm-cache';

/**
 * Phase 2 white-label feature flag. When set to "1" in the
 * environment, requests to <slug>.advottic.com are resolved against
 * the firms table and rewritten to /counsel/* with tenant context
 * injected. When unset, only enterprise.advottic.com and the apex are
 * recognized - the route lives in code already but stays inert until
 * we are ready to send the first customer their dedicated subdomain.
 */
const TENANT_SUBDOMAINS_ENABLED =
  (process.env.NEXT_PUBLIC_TENANT_SUBDOMAINS ?? '').trim() === '1';

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
  // Subdomain routing for hq.advottic.com (-> /admin/*) and
  // enterprise.advottic.com (-> /counsel/*).
  //
  // We do BOTH the URL-cleaning redirect (strip /admin or /counsel
  // from the URL bar) AND the internal rewrite (serve the prefixed
  // route while keeping the URL bar clean) here in middleware. The
  // earlier next.config.mjs implementation chained two beforeFiles
  // rewrites which Vercel's Edge re-evaluated, turning /admin into
  // /admin/admin and 404'ing every signed-in tester once cookies
  // started traveling across subdomains. Doing it in one middleware
  // pass eliminates re-evaluation entirely.
  //
  // Forward the EFFECTIVE pathname to server components via a request
  // header. Server components read it with `headers().get('x-pathname')`.
  // Used by the root layout to swap consumer chrome for counsel chrome
  // when on /counsel/* and for HQ chrome when on /admin/*. The header
  // value is always the canonical prefixed path (/admin/X, /counsel/X)
  // even when the URL bar shows /X on a subdomain - chrome swap, auth
  // check, and perspective detection all see the path that matches the
  // rendered route.
  const host = request.headers.get('host') ?? '';
  const isHqHost = host === 'hq.advottic.com';
  const isEnterpriseHost = host === 'enterprise.advottic.com';

  // Tenant-subdomain detection. <slug>.advottic.com routes the same
  // way as enterprise.advottic.com (rewrite to /counsel/*) but ALSO
  // injects firm context headers so the counsel layout pre-selects
  // the firm and applies their branding instead of showing a switcher.
  // Reserved names (hq, www, etc.) and the apex skip this branch.
  const hostParts = host.split(':')[0].toLowerCase().split('.');
  const looksLikeAdvotticSubdomain =
    hostParts.length === 3 &&
    hostParts[1] === 'advottic' &&
    hostParts[2] === 'com';
  const candidateSlug = looksLikeAdvotticSubdomain ? hostParts[0] : null;
  const isCandidateTenant =
    TENANT_SUBDOMAINS_ENABLED &&
    candidateSlug !== null &&
    !RESERVED_SUBDOMAINS.has(candidateSlug) &&
    !isHqHost &&
    !isEnterpriseHost;

  const originalPath = request.nextUrl.pathname;
  // Tenant subdomains share the /counsel route with enterprise.advottic.com.
  const prefixForHost: string | null = isHqHost
    ? '/admin'
    : isEnterpriseHost || isCandidateTenant
      ? '/counsel'
      : null;

  // Step 1: URL-cleaning redirect.
  // If a user lands on hq.advottic.com/admin/firms (because they pasted
  // an old apex bookmark or a <Link href="/admin/firms"> click), bounce
  // them to hq.advottic.com/firms so the URL bar stays clean. Only
  // applies to the page itself - never to _next assets, API routes, or
  // the /auth/callback that Supabase posts to.
  const isAssetOrApi =
    originalPath.startsWith('/_next/') ||
    originalPath.startsWith('/api/') ||
    originalPath === '/auth/callback' ||
    originalPath === '/favicon.ico';
  if (
    prefixForHost &&
    !isAssetOrApi &&
    (originalPath === prefixForHost ||
      originalPath.startsWith(prefixForHost + '/'))
  ) {
    const cleanPath =
      originalPath === prefixForHost
        ? '/'
        : originalPath.slice(prefixForHost.length);
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.pathname = cleanPath;
    return NextResponse.redirect(cleanUrl);
  }

  // Step 2: Compute the effective path (canonical prefixed path) and
  // decide whether we need to internally rewrite this request.
  const effectivePath = prefixForHost
    ? originalPath === '/' || originalPath === ''
      ? prefixForHost
      : `${prefixForHost}${originalPath}`
    : originalPath;
  const needsRewrite =
    Boolean(prefixForHost) && !isAssetOrApi && effectivePath !== originalPath;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', effectivePath);

  // Tenant subdomain resolution. If the slug matches a firm with
  // subdomain_enabled=true, inject the firm context into request
  // headers so the counsel layout can skip the switcher, pre-select
  // the firm, and apply their branding without an extra DB round-trip.
  // If the slug looks tenant-shaped but does not match any enabled
  // firm, return 404 (don't fall through to the apex - that would
  // mask typos and make all unknown subdomains silently land on the
  // generic enterprise portal, which is not what we want).
  let tenantFirm: Awaited<ReturnType<typeof getFirmBySubdomain>> = null;
  if (isCandidateTenant && candidateSlug && !isAssetOrApi) {
    tenantFirm = await getFirmBySubdomain(candidateSlug);
    if (!tenantFirm) {
      return new NextResponse('Not found', { status: 404 });
    }
    requestHeaders.set('x-tenant-firm-id', tenantFirm.id);
    requestHeaders.set('x-tenant-firm-slug', tenantFirm.slug);
    requestHeaders.set('x-tenant-firm-name', tenantFirm.name);
    requestHeaders.set('x-tenant-firm-accent', tenantFirm.accentColor);
    if (tenantFirm.logoUrl) {
      requestHeaders.set('x-tenant-firm-logo', tenantFirm.logoUrl);
    }
  }

  // Build the initial response. If a subdomain request needs to be
  // served from a prefixed internal route, use NextResponse.rewrite to
  // serve from /admin/X or /counsel/X while keeping the URL bar at /X.
  // Otherwise NextResponse.next is the standard pass-through.
  const buildResponse = (): NextResponse => {
    if (needsRewrite) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = effectivePath;
      return NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  let response = buildResponse();

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
    // Promote the cookie Domain to .advottic.com on production so the
    // session is shared across hq.advottic.com, enterprise.advottic.com,
    // www.advottic.com, and the apex. Without this, navigating to any
    // subdomain triggers a /sign-in bounce because the apex cookies do
    // not travel cross-host.
    const cookieDomain = cookieDomainForHost(host);
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
          // Use the same buildResponse helper so a subdomain rewrite is
          // preserved when Supabase rotates auth cookies mid-request.
          response = buildResponse();
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, {
              ...options,
              ...(cookieDomain ? { domain: cookieDomain } : {}),
            });
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
      // Send unauthed users from hq.advottic.com, enterprise.advottic.com,
      // OR a tenant subdomain (<slug>.advottic.com) to advottic.com/sign-in
      // (apex). Supabase Auth's Allowed Redirect URLs list whitelists the
      // apex /auth/callback - OAuth from a sibling host falls back to Site
      // URL and breaks. The wildcard *.advottic.com entry handles the
      // tenant case, but we still anchor sign-in on the apex so PKCE
      // verifier cookies land where the callback will read them. After
      // sign-in completes the apex page bounces back to the tenant URL
      // because the auth cookie is Domain=.advottic.com and travels.
      const isTenantSubdomain = Boolean(tenantFirm);
      if (isHqHost || isEnterpriseHost || isTenantSubdomain) {
        signInUrl.host = 'advottic.com';
      }
      // For tenant subdomains, preserve the FULL URL (not just the path)
      // so /sign-in can route the user back to <slug>.advottic.com after
      // authentication. For hq/enterprise the path-only `next` is fine
      // because /sign-in's router.replace(next) lands on the apex which
      // already routes /admin and /counsel to their respective shells.
      const nextValue =
        isTenantSubdomain && tenantFirm
          ? `https://${tenantFirm.slug}.advottic.com${originalPath === '/' ? '' : originalPath}`
          : effectivePath;
      signInUrl.searchParams.set('next', nextValue);
      return NextResponse.redirect(signInUrl);
    }
  } catch (err) {
    // Surfacing the message to Vercel runtime logs, not the user.
    console.warn('[middleware] auth check failed; passing through:', err instanceof Error ? err.message : err);
  }

  return response;
}
