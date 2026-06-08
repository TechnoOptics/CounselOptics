import type { Metadata } from 'next';
import Link from 'next/link';
import { TEMPLATES } from '@/lib/templates';

export const metadata: Metadata = {
  title: { absolute: 'Free legal templates · Advottic' },
  description:
    'Free, lawyer-reviewed legal templates: demand letter, NDA, cease and desist, lease termination notice, security deposit return demand. No signup, no email gate.',
  alternates: { canonical: '/templates' },
  openGraph: {
    title: 'Advottic free legal templates',
    description:
      'Lawyer-reviewed, copy-and-edit-ready templates. No signup. No email gate.',
    url: '/templates',
    type: 'article',
  },
};

export default function TemplatesIndexPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': 'https://advottic.com/templates#page',
    name: 'Advottic free legal templates',
    url: 'https://advottic.com/templates',
    hasPart: TEMPLATES.map((t) => ({
      '@type': 'Article',
      '@id': `https://advottic.com/templates/${t.slug}#article`,
      headline: t.title,
      description: t.oneLine,
      url: `https://advottic.com/templates/${t.slug}`,
      datePublished: t.lastReviewed,
    })),
  };
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Templates</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Free legal templates. No email gate.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Each template is lawyer-reviewed, copy-and-edit-ready, and
          shipped with the warnings that matter (jurisdiction quirks,
          notarization, deadlines).
        </p>
      </header>

      <ul className="space-y-5">
        {TEMPLATES.map((t) => (
          <li
            key={t.slug}
            className="border-l-2 border-gold-metal/40 pl-5 py-1"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {t.category}
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link
                href={`/templates/${t.slug}`}
                className="hover:underline"
              >
                {t.title}
              </Link>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {t.oneLine}{' '}
              <Link
                href={`/templates/${t.slug}`}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Get the template &rarr;
              </Link>
            </p>
          </li>
        ))}
      </ul>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          These templates are informational only and are not legal
          advice. Consult a licensed attorney in your jurisdiction
          before sending anything important.
        </p>
      </section>
    </article>
  );
}
