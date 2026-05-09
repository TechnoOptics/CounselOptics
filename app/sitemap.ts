import type { MetadataRoute } from 'next';
import { ARTICLES } from '@/lib/articles';

/**
 * Public sitemap. Lists every URL we want indexed by Google /
 * Bing / Apple. Auth-only routes (/cases, /profile, /admin, /api,
 * /billing, /counsel, /contracts, /vault, /inbox) are NOT here -
 * those are blocked in app/robots.ts and shouldn't appear in
 * search results.
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

  // Tier 4: legal + utility
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/cookies', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/dmca', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/accessibility', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/sign-in', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
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
  return [...baseEntries, ...articleEntries];
}
