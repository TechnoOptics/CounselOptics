import type { Metadata } from 'next';
import Link from 'next/link';
import { CHANGELOG } from '@/lib/changelog';

export const metadata: Metadata = {
  title: { absolute: 'Changelog · Advottic' },
  description:
    "Everything we've shipped on Advottic, in chronological order. Personal-safety features, AI updates, firm-side launches, pricing changes.",
  alternates: {
    canonical: '/changelog',
    types: {
      'application/rss+xml': '/feed.xml',
      'application/atom+xml': '/atom.xml',
    },
  },
  openGraph: {
    title: 'Advottic changelog',
    description: "Everything we've shipped, in chronological order.",
    url: '/changelog',
    type: 'article',
  },
};

const CATEGORY_LABELS: Record<string, { label: string; tone: string }> = {
  feature: { label: 'Feature', tone: 'bg-emerald-500/10 text-emerald-300' },
  fix: { label: 'Fix', tone: 'bg-sky-500/10 text-sky-300' },
  security: { label: 'Security', tone: 'bg-rose-500/10 text-rose-300' },
  // The one `text-gold-metal` call site outside the counsel shell and
  // the always-dark share viewer, so it is the one that needs its own
  // light value rather than the shell repaint the others get: this page
  // is white in the consumer light theme, where #c79532 measures
  // 2.33:1.
  brand: { label: 'Brand', tone: 'bg-gold-metal/15 text-gold-900 dark:text-gold-metal' },
  pricing: { label: 'Pricing', tone: 'bg-amber-500/10 text-amber-300' },
};

export default function ChangelogPage() {
  // Two JSON-LD nodes in one @graph: an ItemList for the page as a
  // whole, plus an Article per entry so each shipped feature is an
  // independently-citable creative work. AI tools that prefer to
  // cite a specific update ("Advottic shipped Safe Witness live
  // tracking on 2026-05-22") can lift the Article URL directly
  // instead of the whole changelog page.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        '@id': 'https://advottic.com/changelog#list',
        name: 'Advottic changelog',
        url: 'https://advottic.com/changelog',
        itemListElement: CHANGELOG.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: { '@id': `https://advottic.com/changelog#${c.slug}` },
        })),
      },
      ...CHANGELOG.map((c) => ({
        '@type': 'Article',
        '@id': `https://advottic.com/changelog#${c.slug}`,
        headline: c.title,
        description: c.summary,
        datePublished: c.date,
        dateModified: c.date,
        url: c.link
          ? `https://advottic.com${c.link}`
          : `https://advottic.com/changelog#${c.slug}`,
        author: {
          '@type': 'Organization',
          name: 'Advottic',
          url: 'https://advottic.com/',
        },
        publisher: {
          '@type': 'Organization',
          name: 'Advottic',
          url: 'https://advottic.com/',
          logo: {
            '@type': 'ImageObject',
            url: 'https://advottic.com/advottic-mark.png',
          },
        },
        articleSection: c.category,
        isPartOf: { '@id': 'https://advottic.com/changelog#list' },
      })),
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Changelog</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          What we've shipped.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Most-recent first. Subscribe via{' '}
          <a href="/feed.xml" className="underline">
            RSS
          </a>{' '}
          or{' '}
          <a href="/atom.xml" className="underline">
            Atom
          </a>{' '}
          to follow along.
        </p>
      </header>

      <ol className="space-y-8 list-none">
        {CHANGELOG.map((entry) => {
          const cat = CATEGORY_LABELS[entry.category] ?? CATEGORY_LABELS.feature;
          return (
            <li
              key={entry.slug}
              id={entry.slug}
              className="border-l-2 border-gold-metal/40 pl-5 scroll-mt-20"
            >
              <div className="flex items-center gap-2 mb-1">
                <time className="text-[12px] font-mono text-ink-500 dark:text-cream-100/55">
                  {entry.date}
                </time>
                <span
                  className={`text-[10px] uppercase tracking-[0.15em] font-semibold rounded-full px-2 py-0.5 ${cat.tone}`}
                >
                  {cat.label}
                </span>
              </div>
              <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
                {entry.link ? (
                  <Link href={entry.link} className="hover:underline">
                    {entry.title}
                  </Link>
                ) : (
                  entry.title
                )}
              </h2>
              <p className="text-[15px] text-ink-700 dark:text-cream-100/80">
                {entry.summary}
              </p>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
