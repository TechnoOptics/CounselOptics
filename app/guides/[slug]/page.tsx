import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { GUIDES, getGuide } from '@/lib/guides';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const g = getGuide(params.slug);
  if (!g) return {};
  return {
    title: { absolute: `${g.title} · Advottic` },
    description: g.oneLine,
    alternates: { canonical: `/guides/${g.slug}` },
    keywords: g.keywords,
    openGraph: {
      title: g.title,
      description: g.oneLine,
      url: `/guides/${g.slug}`,
      type: 'article',
    },
  };
}

export default function GuidePage({
  params,
}: {
  params: { slug: string };
}) {
  const g = getGuide(params.slug);
  if (!g) notFound();

  const url = `https://advottic.com/guides/${g.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline: g.title,
        description: g.oneLine,
        datePublished: g.lastReviewed,
        dateModified: g.lastReviewed,
        url,
        articleSection: g.category,
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
      },
      {
        '@type': 'HowTo',
        '@id': `${url}#howto`,
        name: g.title,
        description: g.oneLine,
        step: g.steps.map((s, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: s.title,
          text: s.detail,
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: g.faqs.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: f.answer,
          },
        })),
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
            name: 'Guides',
            item: 'https://advottic.com/guides',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: g.title,
            item: url,
          },
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
        <Link href="/guides" className="underline hover:no-underline">
          Guides
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">{g.category}</span>
      </nav>

      {g.crisis && (
        <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-400/40 p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-rose-300 font-semibold">
            Crisis resources
          </p>
          <ul className="text-[14px] text-rose-100/90 space-y-1.5">
            <li>
              <strong className="text-cream-100">Emergency:</strong>{' '}
              <a href="tel:911" className="underline">
                911
              </a>
            </li>
            <li>
              <strong className="text-cream-100">
                National Domestic Violence Hotline:
              </strong>{' '}
              <a href="tel:18007997233" className="underline">
                1-800-799-7233
              </a>{' '}
              · text START to 88788
            </li>
            <li>
              <strong className="text-cream-100">
                988 Suicide &amp; Crisis Lifeline:
              </strong>{' '}
              <a href="tel:988" className="underline">
                call or text 988
              </a>
            </li>
            <li>
              <strong className="text-cream-100">Crisis Text Line:</strong>{' '}
              text HOME to{' '}
              <a href="sms:741741&body=HOME" className="underline">
                741741
              </a>
            </li>
          </ul>
        </div>
      )}

      <header className="space-y-2">
        <p className="eyebrow">{g.category}</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {g.title}
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          {g.oneLine}
        </p>
      </header>

      <section className="space-y-4">
        {g.intro.split('\n\n').map((p, i) => (
          <p key={i} className="text-[15px] leading-relaxed">
            {p}
          </p>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-forest-900 dark:text-cream-100">
          What to do
        </h2>
        <ol className="space-y-5 list-none">
          {g.steps.map((s, i) => (
            <li key={i} className="border-l-2 border-gold-metal/40 pl-5">
              <p className="text-[10px] uppercase tracking-[0.25em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
                Step {i + 1}
              </p>
              <h3 className="font-semibold text-forest-900 dark:text-cream-100 text-[16px] mb-1">
                {s.title}
              </h3>
              <p className="text-[14.5px] leading-relaxed">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-forest-900 dark:text-cream-100">
          Common questions
        </h2>
        <div className="space-y-4">
          {g.faqs.map((f, i) => (
            <details
              key={i}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-4"
            >
              <summary className="font-semibold text-forest-900 dark:text-cream-100 cursor-pointer text-[15px]">
                {f.question}
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-700 dark:text-cream-100/80">
                {f.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65 space-y-2">
        <p>
          Last reviewed: {g.lastReviewed}. This guide is informational
          only and is not legal advice. Consult a licensed attorney in
          your jurisdiction before acting on any of the above.
        </p>
        <p>
          More guides:{' '}
          <Link href="/guides" className="underline">
            advottic.com/guides
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
