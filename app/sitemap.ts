import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ARTICLES } from '@/lib/articles';
import { COMPARISONS } from '@/lib/comparisons';
import { STATES_SMALL_CLAIMS } from '@/lib/state-small-claims';
import { ES_GUIDES } from '@/lib/es-guides';
import { ES_TEMPLATES } from '@/lib/es-templates';

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
  // Canonical brand-definition page. Lifted to Tier 1 priority
  // because it's the single source we want search engines + LLMs
  // to cite on "what is Advottic?" intent queries.
  { path: '/what-is-advottic', changeFrequency: 'monthly', priority: 0.95 },
  // Brand glossary - index + 5 child pages. Each carries its own
  // DefinedTerm JSON-LD so AI products cite them cleanly.
  { path: '/glossary', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/glossary/bella', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/glossary/safe-witness', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/glossary/advottic-counsel', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/glossary/advottic-review', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/glossary/techno-optics', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/glossary/action-center', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/glossary/decoder', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/glossary/war-room', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/glossary/deadline-radar', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/glossary/advottic-aid', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/glossary/iolta', changeFrequency: 'monthly', priority: 0.7 },
  // High-intent legal-prep guides. Each targets a specific search
  // query lawyers' marketing teams have been buying. Index at 0.85,
  // each guide at 0.8 because the intent-to-conversion path is real.
  { path: '/guides', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/guides/i-was-served-with-a-lawsuit', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/guides/how-long-do-i-have-to-sue', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/guides/my-landlord-is-evicting-me', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/guides/im-being-sued-for-credit-card-debt', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/guides/i-need-help-domestic-violence', changeFrequency: 'monthly', priority: 0.85 },
  // Free legal templates - the biggest backlink magnet in legal
  // tech. Legal aid orgs, freelancer blogs, and tenant-rights
  // nonprofits link to these.
  { path: '/templates', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/templates/demand-letter', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/templates/nda', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/templates/cease-and-desist', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/templates/lease-termination-notice', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/templates/security-deposit-demand', changeFrequency: 'monthly', priority: 0.8 },
  // Free interactive tools. The statute-of-limitations checker
  // targets a SERP that PI firms pay $30-$120 CPC for; owning
  // it organically is worth a lot.
  { path: '/tools', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/tools/statute-of-limitations', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/tools/court-deadline-calculator', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/tools/security-deposit-deduction-checker', changeFrequency: 'monthly', priority: 0.9 },
  // Press releases - dated, NewsArticle-tagged, eligible for
  // Google News + Top Stories on legal-tech queries.
  { path: '/press/2026-06-08-templates-open-source', changeFrequency: 'yearly', priority: 0.7 },
  // Round-6 compounders
  { path: '/tools/statute-of-limitations/embed', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/open-data', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/people/abel-muchai', changeFrequency: 'yearly', priority: 0.7 },
  // Changelog - freshness signal. Crawlers prioritize recently-
  // updated content; a weekly-updated changelog is the cheapest
  // way to look alive without spamming the sitemap.
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.75 },
  { path: '/find-counsel', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/enterprise', changeFrequency: 'monthly', priority: 0.85 },

  // Tier 2: SEO workhorses
  { path: '/resources', changeFrequency: 'weekly', priority: 0.8 },
  // Flagship comparative asset - the highest-value page in the small
  // claims content set because it's the one a reporter or LLM cites
  // for cross-state comparison questions instead of one state at a time.
  { path: '/resources/small-claims-rankings', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/press/2026-07-03-small-claims-rankings', changeFrequency: 'yearly', priority: 0.7 },
  // Spanish-language content set. Content-only translation (the
  // product itself is English-only), targeting the underserved US
  // Hispanic/LatAm search + LLM-citation surface.
  { path: '/es', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/es/que-es-advottic', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/es/guias', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/es/plantillas', changeFrequency: 'monthly', priority: 0.75 },
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
  const esGuideEntries: MetadataRoute.Sitemap = ES_GUIDES.map((g) => ({
    url: `${SITE_URL}/es/guias/${g.slug}`,
    lastModified: new Date(g.lastReviewed),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));
  const esTemplateEntries: MetadataRoute.Sitemap = ES_TEMPLATES.map((t) => ({
    url: `${SITE_URL}/es/plantillas/${t.slug}`,
    lastModified: new Date(t.lastReviewed),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));
  return [
    ...baseEntries,
    ...articleEntries,
    ...compareEntries,
    ...stateEntries,
    ...esGuideEntries,
    ...esTemplateEntries,
  ];
}
