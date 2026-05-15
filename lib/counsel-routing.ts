/**
 * Counsel-side route utilities.
 *
 * Pulled out of components/counsel/CounselSidebar.tsx so the logic
 * can be unit-tested without bundling the React tree. Audit V5
 * CR-5+CR-28 ("Firm settings dead-click" regression) - the bug came
 * back twice across audits because there was no regression guard
 * against the redirect-cycle path. Now there is:
 * scripts/test/counsel-routing.mjs imports this module and asserts
 * every documented case.
 */

/**
 * Map a canonical /counsel/* href to the URL the browser actually
 * displays.
 *
 *   - In apex mode (advottic.com / hq.advottic.com), counsel pages
 *     live under /counsel/*. Hrefs stay as-is.
 *   - In tenant mode (enterprise.advottic.com, <slug>.advottic.com),
 *     middleware Step-1 redirects /counsel/foo -> /foo for cosmetic
 *     URLs. The sidebar must emit the SHORT path directly so a click
 *     doesn't trigger the redirect (which Next.js's client router
 *     sometimes collapses to a no-op, producing the "dead click"
 *     symptom).
 *
 * Edge cases:
 *   - "/counsel" -> "/" in tenant mode (the dashboard itself).
 *   - "/counsel/" -> "/" (defensive normalization).
 *   - "/" or "/something-non-counsel" -> passthrough.
 */
export function tenantHref(href: string, tenantMode: boolean): string {
  if (!tenantMode) return href;
  if (href === '/counsel' || href === '/counsel/') return '/';
  if (href.startsWith('/counsel/')) return href.slice('/counsel'.length);
  return href;
}

/**
 * Decide whether a sidebar item is "active" for the current pathname.
 * `pathname` is always the canonical (`/counsel/*`) effective path
 * forwarded by the middleware via `x-pathname` - so this function
 * doesn't need to know whether we're on a tenant subdomain.
 *
 *   - Dashboard (/counsel) only highlights on /counsel or /counsel/
 *     so every other page doesn't also mark the dashboard active.
 *   - Every other item highlights when the current path is the
 *     item's path OR a descendant of it.
 */
export function isCounselItemActive(itemHref: string, pathname: string): boolean {
  if (itemHref === '/counsel') {
    return pathname === '/counsel' || pathname === '/counsel/';
  }
  return pathname === itemHref || pathname.startsWith(itemHref + '/');
}
