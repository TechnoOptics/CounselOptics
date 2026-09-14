import type { Metadata } from 'next';
import Link from 'next/link';
import { GUIDES } from '@/lib/guides';
import { Prose } from '@/components/marketing/file';

export const metadata: Metadata = {
  title: { absolute: 'Legal-prep guides · Advottic' },
  description:
    'Plain-English answers to specific legal-prep questions: what to do when served with a lawsuit, statute-of-limitations basics, eviction defense, credit-card debt defense, domestic-violence safety planning.',
  alternates: {
    canonical: '/guides',
    languages: { 'en-US': '/guides', 'es-US': '/es/guias', 'x-default': '/guides' },
  },
  openGraph: {
    title: 'Advottic legal-prep guides',
    description:
      'Plain-English answers to specific legal-prep questions. Each guide: action steps, FAQs, and the right hotlines.',
    url: '/guides',
    type: 'article',
  },
};

export default function GuidesIndexPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': 'https://advottic.com/guides#page',
    name: 'Advottic legal-prep guides',
    url: 'https://advottic.com/guides',
    hasPart: GUIDES.map((g) => ({
      '@type': 'Article',
      '@id': `https://advottic.com/guides/${g.slug}#article`,
      headline: g.title,
      description: g.oneLine,
      url: `https://advottic.com/guides/${g.slug}`,
      datePublished: g.lastReviewed,
    })),
  };
  return (
    <Prose
      label="Guides"
      title="Specific questions, plain-English answers."
      lede="Each guide is a calm checklist for a specific legal-prep moment: what to do today, what to do this week, and which hotlines to call if things are urgent. Not legal advice."
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-2"></header>

      <ul className="space-y-5">
        {GUIDES.map((g) => (
          <li
            key={g.slug}
            className="border-l-2 border-gold-metal/40 pl-5 py-1"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {g.category}
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link
                href={`/guides/${g.slug}`}
                className="hover:underline"
              >
                {g.title}
              </Link>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {g.oneLine}{' '}
              <Link
                href={`/guides/${g.slug}`}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Read the guide &rarr;
              </Link>
            </p>
          </li>
        ))}
      </ul>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          These guides are informational only and are not legal
          advice. Consult a licensed attorney in your jurisdiction
          before acting on any of them.
        </p>
      </section>
    </Prose>
  );
}
