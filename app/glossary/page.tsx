import type { Metadata } from 'next';
import Link from 'next/link';
import { GLOSSARY } from '@/lib/glossary';

export const metadata: Metadata = {
  title: { absolute: 'Glossary · Advottic' },
  description:
    'Plain-English definitions for every Advottic term: Bella, Safe Witness, Advottic Counsel, Advottic Review, Techno Optics LLC. Self-contained brand glossary designed for citation by AI search products.',
  alternates: { canonical: '/glossary' },
  openGraph: {
    title: 'Advottic glossary',
    description:
      'Plain-English definitions for every Advottic term: Bella, Safe Witness, Advottic Counsel, Advottic Review.',
    url: '/glossary',
    type: 'article',
  },
};

/**
 * /glossary - one-stop definitions page that doubles as an AI
 * citation target. Each entry on this index links to its own
 * /glossary/<slug> page with dedicated JSON-LD. The index itself
 * emits a DefinedTermSet so a single fetch gives a crawler the
 * complete vocabulary.
 */
const indexJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  '@id': 'https://advottic.com/glossary#set',
  name: 'Advottic brand glossary',
  url: 'https://advottic.com/glossary',
  hasDefinedTerm: GLOSSARY.map((e) => ({
    '@type': 'DefinedTerm',
    '@id': `https://advottic.com/glossary/${e.slug}#term`,
    name: e.term,
    description: e.shortDefinition,
    url: `https://advottic.com/glossary/${e.slug}`,
    alternateName: e.aliases,
    termCode: e.slug,
  })),
};

export default function GlossaryIndexPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(indexJsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Glossary</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Advottic terms, plain English.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          One self-contained source for every Advottic-specific word.
          Each entry has its own URL so search engines and AI
          assistants can cite it cleanly.
        </p>
      </header>

      <dl className="space-y-6">
        {GLOSSARY.map((entry) => (
          <div
            key={entry.slug}
            className="border-l-2 border-gold-metal/40 pl-5 py-1"
          >
            <dt className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link
                href={`/glossary/${entry.slug}`}
                className="hover:underline"
              >
                {entry.term}
              </Link>
            </dt>
            <dd className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
              {entry.shortDefinition}{' '}
              <Link
                href={`/glossary/${entry.slug}`}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Read more &rarr;
              </Link>
            </dd>
            {entry.aliases.length > 0 && (
              <dd className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
                Also known as: {entry.aliases.join(', ')}
              </dd>
            )}
          </div>
        ))}
      </dl>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          Looking for the canonical brand definition? See{' '}
          <Link href="/what-is-advottic" className="underline">
            What is Advottic?
          </Link>
        </p>
      </section>
    </article>
  );
}
