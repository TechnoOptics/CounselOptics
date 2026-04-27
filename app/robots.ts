import type { MetadataRoute } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://www.advottic.com');

/**
 * Crawler policy. Public marketing routes are open. Anything that
 * touches user data, auth, billing, or admin is hard-blocked - we do
 * not want signed-out search-engine requests indexing case files,
 * Stripe checkout redirects, or admin dashboards.
 *
 * Two AI-crawler bots are explicitly disallowed:
 *   - GPTBot (OpenAI training crawler)
 *   - CCBot (Common Crawl, used downstream by many model trainers)
 * Search-aware AI crawlers like Google-Extended, PerplexityBot, and
 * ChatGPT-User remain allowed because they cite the source - that
 * pattern is a referral channel, not training data theft. Adjust to
 * taste.
 */
export default function robots(): MetadataRoute.Robots {
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
          '/auth/',
          '/auth',
          '/_next/',
          '/static/',
        ],
      },
      // Block training-only AI crawlers that don't cite or drive
      // referrals. Citing crawlers like PerplexityBot, ChatGPT-User,
      // and Google-Extended (Bard / AI Overviews) remain allowed
      // because they're a referral channel, not training-data theft.
      { userAgent: 'GPTBot', disallow: '/' },
      { userAgent: 'CCBot', disallow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
