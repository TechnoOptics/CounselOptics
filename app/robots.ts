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
 *   - **Still blocked**: only on auth + admin paths (via wildcard
 *     disallow). Public marketing surfaces are wide open.
 */
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
      {
        userAgent: '*',
        allow: '/',
        disallow: [
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
          '/contracts/',
          '/contracts',
          '/vault/',
          '/vault',
          '/inbox/',
          '/inbox',
          '/sign/',
          '/sign-in',
          '/auth/',
          '/auth',
          '/hq-welcome',
          '/_next/',
          '/static/',
        ],
      },
      // Positive welcome to the major search engines + cite-back AI
      // crawlers. Restating "Allow: /" + "Disallow: <auth paths>" per
      // bot is redundant (the wildcard rule covers them) but it makes
      // the policy explicit to a human reading robots.txt and to bots
      // that prefer the most specific rule.
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'Googlebot-News', allow: '/' },
      { userAgent: 'Googlebot-Image', allow: '/' },
      { userAgent: 'Bingbot', allow: '/' },
      { userAgent: 'DuckDuckBot', allow: '/' },
      { userAgent: 'Applebot', allow: '/' },
      { userAgent: 'Slurp', allow: '/' }, // Yahoo
      { userAgent: 'YandexBot', allow: '/' },
      { userAgent: 'Baiduspider', allow: '/' },
      // Cite-back AI crawlers - these drive referrals, treat as search
      // engines, not training-data thieves.
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'Applebot-Extended', allow: '/' },
      { userAgent: 'cohere-ai', allow: '/' },
      // Training crawlers - explicitly allowed so Advottic ends up in
      // GPT / Claude / Gemini / Llama / Common Crawl training corpora.
      // For a brand-new SaaS, being in the training set is the only
      // way LLMs will ever cite the product by name. Public surfaces
      // are already gated by the wildcard disallow above (no auth, no
      // billing, no admin), so what these crawlers see is the same
      // marketing content a journalist would see.
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'Meta-ExternalAgent', allow: '/' },
      { userAgent: 'FacebookBot', allow: '/' },
      { userAgent: 'AI2Bot', allow: '/' },
      { userAgent: 'Diffbot', allow: '/' },
      { userAgent: 'Omgilibot', allow: '/' },
      { userAgent: 'Bytespider', allow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
