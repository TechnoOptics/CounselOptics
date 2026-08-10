import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://advottic.com');

/**
 * Crawler policy. Three tiers:
 *
 * 1. **Apex (advottic.com / www.advottic.com)** - the canonical brand
 *    surface. Public marketing routes are wide open, with positive
 *    welcomes to the major search engines + cite-back AI crawlers.
 *    Anything that touches user data, auth, billing, or admin is
 *    hard-blocked.
 *
 * 2. **HQ (hq.advottic.com)** - staff console, never public. Serve a
 *    "Disallow: /" robots.txt so even a passing crawler that follows
 *    a leaked link drops the URL immediately.
 *
 * 3. **Enterprise / tenant (enterprise.advottic.com,
 *    <firm>.advottic.com)** - host aliases for canonical apex
 *    content. Also "Disallow: /" so the ranking signal concentrates
 *    on the apex URL the canonical metadata points at.
 *
 * AI crawler policy on the apex (UPDATED 2026-06-08):
 *   - **Allowed (everything that ingests for training or search)**:
 *     We want Advottic in every LLM's training corpus and in every
 *     real-time search index. A new brand is invisible to LLMs by
 *     default; the only way to fix that is to let the training
 *     crawlers in. Earlier policy hard-blocked GPTBot / CCBot /
 *     ClaudeBot / anthropic-ai / Meta-ExternalAgent / AI2Bot - that
 *     was the single biggest reason "ask ChatGPT about Advottic"
 *     returned nothing. Re-enabled all of them.
 *   - **Still blocked**: the application itself (auth, admin, billing,
 *     case data). Public marketing surfaces are wide open.
 *
 * Group semantics (RFC 9309 section 2.2.1, verified against the RFC
 * text on 2026-08-10): a crawler obeys ONLY the group whose user-agent
 * matches its product token, and falls back to the "*" group solely
 * when no named group matches. Named groups do NOT inherit from the
 * wildcard group, they replace it. So every named group below must
 * repeat the disallow list verbatim; a named group carrying only
 * "Allow: /" hands that agent the whole application. That is what this
 * file used to emit for all 25 named agents, under a comment claiming
 * the opposite. See docs/gtm/technical-backlog.md TECH-001.
 *
 * robots.txt is not a security control and is not relied on as one.
 * Every path in DISALLOW is auth-gated on the server. The disallow
 * list is crawl-budget and index hygiene: it keeps crawlers off 88 API
 * routes and off sign-in walls so the 151-URL marketing surface is
 * what they spend their budget on.
 */

/**
 * The apex disallow list. Applied to EVERY group, wildcard and named
 * alike, because named groups do not inherit (see above).
 */
const DISALLOW: readonly string[] = [
  '/api/',
  '/admin/',
  '/admin',
  '/cases/',
  '/cases',
  '/profile/',
  '/profile',
  '/billing/',
  '/billing',
  '/feedback/',
  '/feedback',
  '/counsel/',
  '/counsel',
  '/portal/',
  '/portal',
  '/contracts/',
  '/contracts',
  '/vault/',
  '/vault',
  '/inbox/',
  '/inbox',
  '/sign/',
  '/sign-in',
  '/send/',
  '/share/',
  '/auth/',
  '/auth',
  '/verify-mfa',
  '/guest-login',
  '/hq-welcome',
  '/war-room',
  '/action-center',
  '/deadlines',
  '/_next/',
  '/static/',
];

/**
 * Agents we name explicitly. Naming an agent grants it nothing the
 * wildcard group does not already grant; the list exists so a human
 * reading robots.txt can see the access decision spelled out. Each one
 * is emitted with the full DISALLOW list, so naming an agent cannot
 * widen its access.
 */
const NAMED_AGENTS: readonly string[] = [
  // Search engines.
  'Googlebot',
  'Googlebot-News',
  'Googlebot-Image',
  'Bingbot',
  'DuckDuckBot',
  'Applebot',
  'Slurp', // Yahoo
  'YandexBot',
  'Baiduspider',
  // Cite-back AI crawlers - these drive referrals, treat as search
  // engines, not training-data thieves.
  'Google-Extended',
  'PerplexityBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'Applebot-Extended',
  'cohere-ai',
  // Training crawlers - explicitly allowed so Advottic ends up in
  // GPT / Claude / Gemini / Llama / Common Crawl training corpora.
  // For a brand-new SaaS, being in the training set is the only way
  // LLMs will ever cite the product by name. What they see is the
  // same marketing content a journalist would see.
  'GPTBot',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Meta-ExternalAgent',
  'FacebookBot',
  'AI2Bot',
  'Diffbot',
  'Omgilibot',
  'Bytespider',
];
export default function robots(): MetadataRoute.Robots {
  // Pull the request host so we can serve a stricter policy on the
  // non-apex subdomains. headers() is request-scoped, so this still
  // statically generates per-request.
  const host = headers().get('host') ?? '';
  const isApex = host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  const isHq = host === 'hq.advottic.com';

  if (!isApex) {
    // HQ + Enterprise + tenant subdomains: block every crawler entirely.
    // The defense-in-depth pattern - middleware already injects an
    // X-Robots-Tag: noindex header, but robots.txt is the FIRST file
    // a polite crawler reads. Telling Bingbot "Disallow: /" before it
    // even fetches the home page is cheaper than waiting for it to
    // discover the noindex meta.
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      // Intentionally omit `sitemap` here - we never want a non-apex
      // crawler to find the apex sitemap from a noindex'd host (it
      // would create duplicate-content signal hints).
      host: isHq ? 'https://hq.advottic.com' : `https://${host}`,
    };
  }

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: [...DISALLOW] },
      ...NAMED_AGENTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: [...DISALLOW],
      })),
    ],
    // Both sitemaps. sitemap-images.xml was live and referenced by
    // nothing (TECH-005).
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-images.xml`],
    host: SITE_URL,
  };
}
