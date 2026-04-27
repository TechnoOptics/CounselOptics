import type { MetadataRoute } from 'next';

/**
 * Public sitemap. Lists every URL we want indexed by Google /
 * Bing / Apple. Auth-only routes (/cases, /profile, /admin, /api,
 * /billing) are NOT here - those are blocked in app/robots.ts and
 * shouldn't appear in search results.
 *
 * Priorities are relative within the site, not absolute. The home
 * page and the canonical /about page sit at the top because they
 * compress what Advottic is into one URL each. State directories
 * and free-tool landing pages are second-tier - they're the SEO
 * workhorses for long-tail queries. Legal pages get crawled but
 * de-emphasized.
 *
 * lastModified is wired to a build-time date stamp. Vercel rebuilds
 * roll it forward automatically, which is the right signal for a
 * mostly-stable marketing site that ships frequently.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://www.advottic.com');

type Entry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
};

const ENTRIES: Entry[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.95 },
  { path: '/welcome', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/example', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/find-counsel', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/file-exhibits', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/public-defender', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/review-my-document', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/security', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/cookies', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/dmca', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/accessibility', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/sign-in', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ENTRIES.map((e) => ({
    url: `${SITE_URL}${e.path}`,
    lastModified: now,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }));
}
