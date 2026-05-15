import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ARTICLES } from '@/lib/articles';
import { COMPARISONS } from '@/lib/comparisons';
import { STATES_SMALL_CLAIMS } from '@/lib/state-small-claims';

/**
 * Public sitemap. Lists every URL we want indexed by Google /
 * Bing / Apple. Auth-only routes (/cases, /profile, /admin, /api,
 * /billing, /counsel, /contracts, /vault, /inbox) are NOT here -
 * those are blocked in app/robots.ts and shouldn't appear in
 * search results.
 *
 * Host-aware: the sitemap is only served on the apex
 * (advottic.com / www.advottic.com). A request to
 * hq.advottic.com/sitemap.xml returns an empty sitemap so a stray
 * crawler that ignores robots.txt does not inherit URL discovery
 * from the non-apex host.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://advottic.com');

type Entry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
};

const ENTRIES: Entry[] = [
  // Tier 1: cornerstone marketing
  { path: '/', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.95 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/find-counsel', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/enterprise', changeFrequency: 'monthly', priority: 0.85 },

  // Tier 2: SEO workhorses
  { path: '/resources', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/review-my-document', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/file-exhibits', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/public-defender', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/welcome', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/invite', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/example', changeFrequency: 'monthly', priority: 0.7 },

  // Tier 3: trust + brand
  { path: '/security', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/security/disclosure', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/status', changeFrequency: 'daily', priority: 0.5 },
  { path: '/press', changeFrequency: 'monthly', priority: 0.55 },
  { path: '/affiliate', changeFrequency: 'monthly', priority: 0.55 },
  { path: '/developers', changeFrequency: 'monthly', priority: 0.55 },
  { path: '/compare', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/resources/states', changeFrequency: 'monthly', priority: 0.8 },

  // Tier 4: legal + utility
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/cookies', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/dmca', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/accessibility', changeFrequency: 'yearly', priority: 0.3 },
  // /sign-in deliberately omitted (Week-1 audit, item #10). Auth screens
  // are noindex'd in app/sign-in/page.tsx metadata; keeping them out of
  // the sitemap removes the conflicting signal entirely.
];

export default function sitemap(): MetadataRoute.Sitemap {
  // Belt-and-suspenders alongside robots.ts: serve an empty sitemap on
  // hq.advottic.com, enterprise.advottic.com, and tenant subdomains so
  // no crawler can use it to discover apex URLs from those hosts.
  const host = headers().get('host') ?? '';
  const isApex =
    host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  if (!isApex) return [];

  const now = new Date();
  const baseEntries: MetadataRoute.Sitemap = ENTRIES.map((e) => ({
    url: `${SITE_URL}${e.path}`,
    lastModified: now,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }));
  // Append every published article so long-tail searches index
  // immediately (the resource library is the SEO compounding flywheel).
  const articleEntries: MetadataRoute.Sitemap = ARTICLES.map((a) => ({
    url: `${SITE_URL}/resources/${a.slug}`,
    lastModified: a.publishedAt ? new Date(a.publishedAt) : now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));
  // Comparison pages target the highest-commercial-intent SEO surface
  // (brand-vs searches), so they get a higher priority than articles.
  const compareEntries: MetadataRoute.Sitemap = COMPARISONS.map((c) => ({
    url: `${SITE_URL}/compare/${c.slug}`,
    lastModified: new Date(c.reviewedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));
  // 50 state small-claims pages. Long-tail volume per page is modest
  // but the aggregate footprint is significant for "small claims [state]"
  // long-tail queries. Priority kept modest to not crowd cornerstone
  // articles in the sitemap signal.
  const stateEntries: MetadataRoute.Sitemap = STATES_SMALL_CLAIMS.map((s) => ({
    url: `${SITE_URL}/resources/states/${s.slug}/small-claims`,
    lastModified: now,
    changeFrequency: 'yearly' as const,
    priority: 0.6,
  }));
  return [...baseEntries, ...articleEntries, ...compareEntries, ...stateEntries];
}
