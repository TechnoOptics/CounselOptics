/**
 * Cookie-domain helper.
 *
 * Auth cookies must be shared across hq.advottic.com, enterprise.advottic.com,
 * www.advottic.com, and the apex advottic.com so a session signed in at the
 * apex carries through to the founder cockpit at hq.advottic.com and the
 * organizational workspace at enterprise.advottic.com without bouncing
 * through /sign-in to inject the cookie into the right host.
 *
 * Browser-default cookies are host-scoped: a cookie set on advottic.com is
 * NOT sent to hq.advottic.com. We override the Domain attribute to
 * `.advottic.com` (leading dot) so every advottic.com subdomain receives
 * the same auth state.
 *
 * Anywhere ELSE (localhost in dev, *.vercel.app preview deployments, tester
 * sandboxes) we leave Domain unset and let the browser scope cookies to the
 * exact host - cross-subdomain sharing on those origins would be wrong AND
 * setting Domain=.localhost / .vercel.app rejects on most browsers.
 */
export function cookieDomainForHost(
  host: string | undefined | null,
): string | undefined {
  if (!host) return undefined;
  // Strip an optional port (host can be "example.com:3000" in dev).
  const h = host.toLowerCase().split(':')[0];
  if (h === 'advottic.com' || h.endsWith('.advottic.com')) {
    return '.advottic.com';
  }
  return undefined;
}
