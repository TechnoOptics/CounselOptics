import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

const PUBLISHED_AT = '2026-07-03';
const HEADLINE =
  'Advottic publishes the first side-by-side ranking of small claims court in all 50 states';
const SUBHEAD =
  'A free, sortable comparison of small-claims dollar limits, filing fees, attorney-representation rules, and appeal windows, paired with a CC BY 4.0 open dataset.';

export const metadata: Metadata = {
  title: { absolute: `${HEADLINE} · Advottic` },
  description: SUBHEAD,
  alternates: {
    canonical: '/press/2026-07-03-small-claims-rankings',
  },
  openGraph: {
    title: HEADLINE,
    description: SUBHEAD,
    url: '/press/2026-07-03-small-claims-rankings',
    type: 'article',
    publishedTime: PUBLISHED_AT,
    authors: ['Techno Optics LLC'],
  },
};

export default function SmallClaimsRankingsPressReleasePage() {
  const url =
    'https://advottic.com/press/2026-07-03-small-claims-rankings';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'NewsArticle',
        '@id': `${url}#article`,
        headline: HEADLINE,
        description: SUBHEAD,
        datePublished: PUBLISHED_AT,
        dateModified: PUBLISHED_AT,
        url,
        articleSection: 'Press release',
        keywords: [
          'small claims court',
          'small claims limit by state',
          'legal tech',
          'open data',
          'civil procedure',
          'Advottic',
        ],
        author: {
          '@type': 'Organization',
          name: 'Techno Optics LLC',
          url: 'https://advottic.com/about',
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
        mainEntityOfPage: url,
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Advottic', item: 'https://advottic.com/' },
          { '@type': 'ListItem', position: 2, name: 'Press', item: 'https://advottic.com/press' },
          { '@type': 'ListItem', position: 3, name: HEADLINE, item: url },
        ],
      },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <Link href="/press" className="underline hover:no-underline">
          Press
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          Small claims rankings
        </span>
      </nav>

      <header className="space-y-3">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Press release &bull; {PUBLISHED_AT}
        </p>
        <h1 className="font-display text-[32px] sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.1] text-forest-900 dark:text-cream-100">
          {HEADLINE}
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          {SUBHEAD}
        </p>
      </header>

      <section className="space-y-4 text-[15.5px] leading-[1.75]">
        <p>
          <strong>Edina, MN &mdash; July 3, 2026.</strong> Advottic,
          the AI legal-prep platform built and operated by Techno
          Optics LLC, today published a free, side-by-side ranking
          of small claims court rules across all 50 states &mdash;
          the first time the platform&rsquo;s existing state-by-state
          small claims data has been presented as a single
          comparison instead of 50 individual lookups.
        </p>
        <p>
          The report answers the questions people actually ask when
          they search: which state has the highest small claims
          limit (Delaware and Tennessee, tied at $25,000), which has
          the lowest (Kentucky, at $2,500), which states bar
          attorneys from representing either side (eleven, including
          California and Michigan), and which states allow no appeal
          at all from a small claims judgment (five, including
          Arizona and North Dakota).
        </p>
        <p>
          &ldquo;Every state publishes its own small claims rules,
          but nobody puts them next to each other,&rdquo; said Abel
          Muchai, founder of Techno Optics LLC. &ldquo;If you&rsquo;re
          a tenant in Kentucky wondering why your security-deposit
          claim is capped so much lower than a neighboring state, or
          a reporter trying to explain why your state changed its
          limit, that comparison didn&rsquo;t exist as a single page
          anywhere. Now it does, and it&rsquo;s free.&rdquo;
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          What&rsquo;s in the report
        </h2>
        <ul className="space-y-2 text-[14.5px] leading-relaxed list-disc list-outside pl-5">
          <li>
            A sortable table of all 50 states covering monetary
            limit, filing fee, attorney-representation rules, and
            appeal window.
          </li>
          <li>
            Named superlatives: highest and lowest limits, cheapest
            and most expensive to file, shortest appeal windows.
          </li>
          <li>
            A companion, CC BY 4.0-licensed{' '}
            <Link href="/open-data/small-claims.json" className="underline">
              JSON dataset
            </Link>{' '}
            for researchers, journalists, and downstream products.
          </li>
        </ul>
        <p className="text-[14.5px] leading-relaxed pt-1">
          Read the full report:{' '}
          <Link
            href="/resources/small-claims-rankings"
            className="underline font-medium"
          >
            advottic.com/resources/small-claims-rankings
          </Link>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          About Advottic
        </h2>
        <p className="text-[14.5px] leading-relaxed">
          Advottic is an AI-powered legal-prep platform for
          self-represented individuals and the law firms who
          represent them, built and operated by Techno Optics LLC.
          Individuals use it to organize evidence, prepare for
          hearings, and draft documents with Bella, an always-on AI
          legal assistant. Advottic is not a law firm and does not
          provide legal advice.
        </p>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          Media contact:{' '}
          <a href="mailto:press@advottic.com" className="underline">
            press@advottic.com
          </a>
        </p>
      </section>
    </article>
  );
}
