/**
 * Where a signed-in visitor is sent after /sign-in.
 *
 * Extracted from app/sign-in/page.tsx so the page, the middleware gate and
 * the /auth/landing route handler all agree on one sanitiser. Duplicating an
 * open-redirect guard is how one copy quietly drifts.
 */

/**
 * Validate `next` for both same-origin path redirects (`/cases`,
 * `/counsel/clients`) and cross-origin advottic.com subdomain
 * redirects (`https://zinpro.advottic.com/clients`). The cross-origin
 * case is required by Phase 2 white-label: an unauthed visit to
 * `zinpro.advottic.com` bounces through `advottic.com/sign-in?next=https://zinpro.advottic.com/...`,
 * and after auth we have to send the user back to the tenant
 * subdomain.
 *
 * Any other absolute URL is rejected to avoid an open-redirect
 * vulnerability - we never want `next` to land a freshly-authenticated
 * session on an attacker-controlled host.
 */
export function sanitizeNext(raw: string | undefined): string {
  if (!raw) return '/cases';
  // Audit 2026-05-12 P0-1: some upstream callers pass an
  // already-URL-encoded `next` value into encodeURIComponent, producing
  // a `%2520` (double-encoded space) or `%252F` (double-encoded slash).
  // Peel encoding layers off until the string starts with `/` or stops
  // looking URL-encoded - capped at 3 passes to avoid pathological loops.
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
  // `startsWith('/') && !startsWith('//')` is not enough to prove a value is
  // same-origin. A browser (and `new URL(value, base)`) treats a backslash as
  // a slash and strips leading control characters, so `/\evil.com`,
  // `/\/evil.com` and `/\t/evil.com` all resolve to a foreign host. That did
  // not matter while the only consumer rendered a page; it matters now that
  // /auth/landing turns the result straight into a Location header on the
  // path every signed-in visitor to /sign-in takes. Resolve against a
  // throwaway origin and insist the origin survives.
  if (raw.startsWith('/')) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(raw, 'https://origin.invalid').origin === 'https://origin.invalid';
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return '/cases';
    // Collapse sign-in alias paths to their bare workspace prefix so
    // a stale link with next=/admin/sign-in (which 404s because no
    // such route exists) lands the user on /admin after auth - the
    // page they actually wanted. Mirror logic of SIGN_IN_ALIASES in
    // lib/supabase/middleware.ts.
    if (/^\/admin\/(sign-in|signin|login)\/?$/.test(raw)) return '/admin';
    if (/^\/counsel\/(sign-in|signin|login)\/?$/.test(raw)) return '/counsel';
    return raw;
  }
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
