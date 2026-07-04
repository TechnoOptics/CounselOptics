import { createClient } from '@supabase/supabase-js';

/**
 * Edge-friendly firm-by-subdomain cache.
 *
 * The tenant subdomain resolver runs in middleware on every page load
 * for `<slug>.advottic.com`, so the lookup must not block on a
 * cold-start round-trip to Postgres. We cache the
 * subdomain → firm-context mapping in-process for 60 seconds, then
 * lazy-refresh on the next miss.
 *
 * Kept dependency-light (raw `@supabase/supabase-js` against the anon
 * key, no PostgREST types) so it bundles into the edge runtime
 * without dragging the full SSR adapter.
 */
export type TenantFirmCacheEntry = {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
  logoUrl: string | null;
  subdomainEnabled: boolean;
};

type CacheBucket = {
  value: TenantFirmCacheEntry | null;
  expiresAt: number;
};

// Reserved subdomains that must NEVER resolve to a tenant. These are
// either existing route hosts (hq, enterprise) or operational names we
// want to keep available regardless of what slug a firm picks.
export const RESERVED_SUBDOMAINS = new Set<string>([
  'www',
  'hq',
  'enterprise',
  'auth',
  'api',
  'admin',
  'app',
  'mail',
  'static',
  'cdn',
  'm',
  'mobile',
  'staging',
  'preview',
  'dev',
  'test',
]);

const TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000; // Cache "no such firm" briefly to absorb scans
const cache = new Map<string, CacheBucket>();

function getEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  return { url, anon };
}

/**
 * Look up a firm by subdomain (case-insensitive). Returns:
 *   - a cache entry when the subdomain matches a firm with subdomain_enabled = true
 *   - null when the subdomain is reserved, unknown, or disabled
 *
 * Never throws. A transient Supabase error returns null and the cache
 * is NOT populated, so the next request will retry.
 */
export async function getFirmBySubdomain(
  subdomain: string,
): Promise<TenantFirmCacheEntry | null> {
  const key = subdomain.toLowerCase();
  if (RESERVED_SUBDOMAINS.has(key)) return null;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const env = getEnv();
  if (!env) return null;

  try {
    const supabase = createClient(env.url, env.anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Read branding through the SECURITY DEFINER RPC (explicit public
    // column allowlist) rather than a direct table select. The old
    // firms_public_tenant_select policy exposed every column of any
    // subdomain-enabled firm to anon (token_pool_balance, created_by,
    // full metadata); the RPC returns only public branding columns and
    // already filters to subdomain_enabled = true, case-insensitively.
    // See supabase/fixes/2026-07-04-firm-public-tenant-rpc.sql.
    const { data, error } = await supabase
      .rpc('get_public_tenant_firm', { _slug: key })
      .maybeSingle();

    if (error || !data) {
      cache.set(key, { value: null, expiresAt: now + NEGATIVE_TTL_MS });
      return null;
    }

    const entry: TenantFirmCacheEntry = {
      id: (data as { id: string }).id,
      slug: (data as { slug: string }).slug,
      name: (data as { name: string }).name,
      accentColor:
        (data as { accent_color: string | null }).accent_color || '#0f2d24',
      logoUrl: (data as { logo_url: string | null }).logo_url,
      subdomainEnabled: true,
    };
    cache.set(key, { value: entry, expiresAt: now + TTL_MS });
    return entry;
  } catch {
    // Don't cache on unexpected errors - retry next request.
    return null;
  }
}

/**
 * Drop a single subdomain from the cache. Called from the HQ admin
 * surface when the subdomain_enabled flag flips so operators don't
 * have to wait the TTL for the change to land at the edge.
 */
export function invalidateFirmSubdomain(subdomain: string) {
  cache.delete(subdomain.toLowerCase());
}
