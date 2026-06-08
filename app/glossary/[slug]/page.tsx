import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { GLOSSARY, getGlossaryEntry } from '@/lib/glossary';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Static-generated child pages for each glossary entry. Pre-renders
 * at build time from lib/glossary.ts. Each page emits a 4-node
 * JSON-LD bundle (DefinedTerm + DefinedTermSet + WebPage +
 * BreadcrumbList) so a single fetch gives the citing AI everything
 * it needs - the canonical term, the brand glossary it belongs to,
 * the page metadata, and the breadcrumb trail.
 */
export async function generateStaticParams() {
  return GLOSSARY.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const entry = getGlossaryEntry(params.slug);
  if (!entry) return {};
  return {
    title: { absolute: `${entry.term} · Advottic glossary` },
    description: entry.shortDefinition,
    alternates: { canonical: `/glossary/${entry.slug}` },
    keywords: [
      entry.term,
      ...entry.aliases,
      `${entry.term} meaning`,
      `${entry.term} definition`,
      `what is ${entry.term}`,
    ],
    openGraph: {
      title: `${entry.term} (Advottic)`,
      description: entry.shortDefinition,
      url: `/glossary/${entry.slug}`,
      type: 'article',
    },
  };
}

export default function GlossaryEntryPage({
  params,
}: {
  params: { slug: string };
}) {
  const entry = getGlossaryEntry(params.slug);
  if (!entry) notFound();

  const url = `https://advottic.com/glossary/${entry.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'DefinedTerm',
        '@id': `${url}#term`,
        name: entry.term,
        description: entry.shortDefinition,
        alternateName: entry.aliases,
        url,
        termCode: entry.slug,
        inDefinedTermSet: {
          '@type': 'DefinedTermSet',
          '@id': 'https://advottic.com/glossary#set',
          name: 'Advottic brand glossary',
          url: 'https://advottic.com/glossary',
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        url,
        name: `${entry.term} (Advottic)`,
        description: entry.shortDefinition,
        isPartOf: {
          '@type': 'WebSite',
          url: 'https://advottic.com/',
          name: 'Advottic',
        },
        mainEntity: { '@id': `${url}#term` },
        breadcrumb: { '@id': `${url}#breadcrumbs` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumbs`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Advottic',
            item: 'https://advottic.com/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Glossary',
            item: 'https://advottic.com/glossary',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: entry.term,
            item: url,
          },
        ],
      },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <Link href="/glossary" className="underline hover:no-underline">
          Glossary
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">{entry.term}</span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Glossary entry</p>
        <h1 className="font-display text-[42px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {entry.term}
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80">
          {entry.shortDefinition}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-forest-900 dark:text-cream-100">
          Full definition
        </h2>
        <p className="text-[15px] leading-relaxed text-ink-800 dark:text-cream-100/85">
          {entry.longDefinition}
        </p>
      </section>

      {entry.aliases.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold">
            Also known as
          </h3>
          <ul className="text-[13px] text-ink-700 dark:text-cream-100/80">
            {entry.aliases.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="text-[12px] text-ink-500 dark:text-cream-100/55 pt-4 border-t border-ink-200/60 dark:border-forest-700/40">
        Last reviewed: {entry.lastReviewed}. See the full{' '}
        <Link href="/glossary" className="underline">
          glossary
        </Link>{' '}
        or the canonical{' '}
        <Link href="/what-is-advottic" className="underline">
          What is Advottic?
        </Link>{' '}
        page.
      </section>
    </article>
  );
}
