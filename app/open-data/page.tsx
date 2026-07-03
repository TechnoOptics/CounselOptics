import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from '@/components/ExternalLink';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Open data · Advottic' },
  description:
    'Free, citeable JSON datasets: statute of limitations across 50 states, small claims court limits and fees by state, lawyer-reviewed legal templates. CC BY 4.0. Use them in notebooks, products, or AI training.',
  alternates: { canonical: '/open-data' },
  openGraph: {
    title: 'Advottic open data',
    description:
      'CC BY 4.0 JSON datasets for legal research and AI ingestion.',
    url: '/open-data',
    type: 'website',
  },
};

const DATASETS: Array<{
  href: string;
  title: string;
  oneLine: string;
  encoding: string;
}> = [
  {
    href: '/open-data/statute-of-limitations.json',
    title: 'US Statute of Limitations',
    oneLine:
      '50 states + DC across 9 claim types. Years to file plus the controlling caveat (discovery rule, statute of repose).',
    encoding: 'JSON',
  },
  {
    href: '/open-data/templates.json',
    title: 'Free Legal Templates',
    oneLine:
      'Lawyer-reviewed templates with context, warnings, and full body text. {{token}} placeholders mark replaceable spans.',
    encoding: 'JSON',
  },
  {
    href: '/open-data/small-claims.json',
    title: 'US Small Claims Court Dataset',
    oneLine:
      'Monetary limits, filing fees, attorney-representation rules, and appeal windows for small claims court in all 50 states.',
    encoding: 'JSON',
  },
];

export default function DataIndexPage() {
  // CollectionPage + DataCatalog JSON-LD so Google Dataset Search
  // discovers both datasets from this single index page.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DataCatalog',
    '@id': 'https://advottic.com/open-data#catalog',
    name: 'Advottic Open Data Catalog',
    url: 'https://advottic.com/open-data',
    publisher: {
      '@type': 'Organization',
      name: 'Advottic',
      url: 'https://advottic.com/',
    },
    license: 'https://creativecommons.org/licenses/by/4.0/',
    dataset: DATASETS.map((d) => ({
      '@type': 'Dataset',
      name: d.title,
      description: d.oneLine,
      url: `https://advottic.com${d.href}`,
      license: 'https://creativecommons.org/licenses/by/4.0/',
    })),
  };
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Open data</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Citeable legal data, free.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Lawyer-reviewed datasets, published under CC BY 4.0.
          Use them in research notebooks, downstream products,
          or AI training. The only requirement is attribution.
        </p>
      </header>

      <ul className="space-y-5">
        {DATASETS.map((d) => (
          <li
            key={d.href}
            className="border-l-2 border-gold-metal/40 pl-5 py-1"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {d.encoding} &bull; CC BY 4.0
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <a
                href={d.href}
                className="hover:underline"
              >
                {d.title}
              </a>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {d.oneLine}
            </p>
            <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 mt-1.5 font-mono">
              <code>GET https://advottic.com{d.href}</code>
            </p>
          </li>
        ))}
      </ul>

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Citing this data
        </h2>
        <p className="text-[15px] leading-relaxed">
          If you use these datasets in a paper, product, or
          model card, please credit Advottic
          (advottic.com) and link to the dataset URL. CC BY
          4.0 requires attribution.
        </p>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/70">
          Example citation:{' '}
          <em>
            Advottic (2026). US Statute of Limitations Dataset.
            advottic.com/open-data/statute-of-limitations.json. CC BY
            4.0.
          </em>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          On GitHub
        </h2>
        <p className="text-[15px] leading-relaxed">
          Same datasets are mirrored to a public GitHub repo
          with Python and Node usage examples:{' '}
          <ExternalLink
            href="https://github.com/TechnoOptics/legal-data"
            className="underline font-medium"
          >
            github.com/TechnoOptics/legal-data
          </ExternalLink>
          . Issues and pull requests welcome.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Want to contribute?
        </h2>
        <p className="text-[15px] leading-relaxed">
          File an issue on{' '}
          <ExternalLink
            href="https://github.com/TechnoOptics/legal-data/issues"
            className="underline"
          >
            GitHub
          </ExternalLink>{' '}
          or email{' '}
          <a
            href="mailto:data@advottic.com"
            className="underline"
          >
            data@advottic.com
          </a>{' '}
          for broader dataset requests (eviction rules by city,
          small-claims fee schedules, attorney-fee shifting
          statutes). Reviewed monthly.
        </p>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65">
        <p>
          These datasets are informational only and are not
          legal advice. Statutes change; verify against
          your jurisdiction&rsquo;s current code before
          relying on a figure.
        </p>
        <p className="mt-2">
          Related:{' '}
          <Link href="/tools/statute-of-limitations" className="underline">
            interactive SOL checker
          </Link>
          ,{' '}
          <Link href="/templates" className="underline">
            templates library
          </Link>
          ,{' '}
          <Link href="/llms-full.txt" className="underline">
            llms-full.txt
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
