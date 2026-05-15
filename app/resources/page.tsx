import Link from 'next/link';
import { ARTICLES, type Article } from '@/lib/articles';
import { BreadcrumbJsonLd, ItemListJsonLd } from '@/components/seo/JsonLd';
import { NewsletterSignup } from '@/components/NewsletterSignup';

export const metadata = {
  title: 'Resources - templates, guides, and legal explainers',
  description:
    'Free legal templates, deep-dive how-to guides, and unbiased software comparisons. Written by the Advottic team for individuals handling their own matters and the firms that serve them.',
  alternates: { canonical: '/resources' },
  openGraph: {
    title: 'Advottic Resources',
    description:
      'Free legal templates, deep-dive how-to guides, and unbiased software comparisons.',
    type: 'website',
    url: '/resources',
  },
};

/**
 * Public-facing resource library. Hub page that lists every entry in
 * lib/articles.ts grouped by category. The hub itself is a major SEO
 * surface (Google rewards expert hub pages with site-link snippets);
 * the individual articles each target their own keyword cluster.
 *
 * Adding new articles is a one-touch operation - append to ARTICLES
 * in lib/articles.ts and this page picks them up automatically. The
 * sitemap also auto-includes them via app/sitemap.ts.
 */

// Display labels + sort order for each category. The first entry on
// the page should always be the most "obvious" / highest-volume
// search bucket; less common categories sit further down.
const CATEGORY_META: Record<
  Article['category'],
  { label: string; blurb: string; order: number }
> = {
  self_help: {
    label: 'Self-help guides',
    blurb:
      'Step-by-step playbooks for handling common matters yourself, with free templates.',
    order: 1,
  },
  contracts: {
    label: 'Contracts &amp; agreements',
    blurb:
      'What contract clauses actually mean, and how to negotiate them without a lawyer.',
    order: 2,
  },
  ai_legal: {
    label: 'Legal AI &amp; tools',
    blurb:
      'Honest comparisons of legal AI products, and how the underlying tech actually works.',
    order: 3,
  },
  practice_management: {
    label: 'For law firms',
    blurb:
      'Operational playbooks for solo and small-firm attorneys: trust accounting, intake, billing.',
    order: 4,
  },
  compliance: {
    label: 'Compliance &amp; legality',
    blurb:
      'Plain-English explanations of the laws that quietly govern everyday business.',
    order: 5,
  },
};

export default function ResourcesPage() {
  // Group + sort. ARTICLES from lib/articles.ts is the single source.
  const byCategory = new Map<Article['category'], Article[]>();
  for (const a of ARTICLES) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }
  const orderedCategories = (Array.from(byCategory.keys()) as Article['category'][]).sort(
    (x, y) => CATEGORY_META[x].order - CATEGORY_META[y].order,
  );

  // Featured = highest-priority articles for the hero strip. Pick the
  // 3 most recent across all categories. The "featured" carousel is
  // the SEO double-dip - it links twice to high-priority articles.
  const featured = [...ARTICLES]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3);

  return (
    <div className="space-y-16 sm:space-y-20 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Resources', href: '/resources' },
        ]}
      />
      {/* ItemList schema for the resource hub. Surfaces the article
          carousel SERP treatment for "legal templates" / "small claims
          guide" / similar navigational queries. */}
      <ItemListJsonLd
        listName="Advottic legal resource library"
        items={ARTICLES.map((a) => ({
          name: a.title,
          href: `/resources/${a.slug}`,
        }))}
      />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Resources</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Free templates, real explainers.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          {ARTICLES.length} guides written by the Advottic team. No SEO
          fluff: just the answers we wish someone had given us when we
          were figuring this out the first time.
        </p>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Featured
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {featured.map((a) => (
            <ArticleCard key={a.slug} article={a} featured />
          ))}
        </div>
      </section>

      {orderedCategories.map((cat) => {
        const meta = CATEGORY_META[cat];
        const list = byCategory.get(cat) ?? [];
        return (
          <section
            key={cat}
            className="max-w-6xl mx-auto px-4 sm:px-6 space-y-5"
          >
            <header className="space-y-1.5 max-w-2xl">
              <h2
                className="font-display text-2xl text-forest-900 dark:text-cream-100"
                dangerouslySetInnerHTML={{ __html: meta.label }}
              />
              <p className="text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
                {meta.blurb}
              </p>
            </header>
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <li key={a.slug}>
                  <ArticleCard article={a} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="max-w-3xl mx-auto px-4 sm:px-6">
        <NewsletterSignup source="resources_hub" variant="card" />
      </section>
    </div>
  );
}

/**
 * Single article card. Renders into either the featured strip
 * (`featured`) or a category list (default). Markup is identical;
 * the visual treatment changes via class.
 */
function ArticleCard({
  article,
  featured = false,
}: {
  article: Article;
  featured?: boolean;
}) {
  const date = new Date(article.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <Link
      href={`/resources/${article.slug}`}
      className={`block rounded-xl ring-1 p-5 sm:p-6 space-y-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        featured
          ? 'ring-2 ring-gold-metal/60 bg-gradient-to-b from-amber-50/30 to-transparent dark:ring-amber-500/40 dark:from-amber-950/15'
          : 'ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40'
      }`}
    >
      <div className="flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
        <span>{date}</span>
        <span aria-hidden>·</span>
        <span>{article.readMinutes} min read</span>
      </div>
      <h3 className="font-display text-lg sm:text-xl text-forest-900 dark:text-cream-100 leading-tight">
        {article.title}
      </h3>
      <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        {article.description}
      </p>
      <p className="text-[12px] font-medium text-forest-700 dark:text-cream-100/85">
        Read the guide &rarr;
      </p>
    </Link>
  );
}
