import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { TEMPLATES, getTemplate } from '@/lib/templates';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  return TEMPLATES.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const t = getTemplate(params.slug);
  if (!t) return {};
  return {
    title: { absolute: `${t.title} · Advottic` },
    description: t.oneLine,
    alternates: { canonical: `/templates/${t.slug}` },
    keywords: t.keywords,
    openGraph: {
      title: t.title,
      description: t.oneLine,
      url: `/templates/${t.slug}`,
      type: 'article',
    },
  };
}

export default function TemplatePage({
  params,
}: {
  params: { slug: string };
}) {
  const t = getTemplate(params.slug);
  if (!t) notFound();

  const url = `https://advottic.com/templates/${t.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline: t.title,
        description: t.oneLine,
        datePublished: t.lastReviewed,
        dateModified: t.lastReviewed,
        url,
        articleSection: t.category,
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
            name: 'Templates',
            item: 'https://advottic.com/templates',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: t.title,
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
        <Link href="/templates" className="underline hover:no-underline">
          Templates
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">{t.category}</span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">{t.category}</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {t.title}
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          {t.oneLine}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-forest-900 dark:text-cream-100">
          How to use this template
        </h2>
        <p className="text-[15px] leading-relaxed">{t.context}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-forest-900 dark:text-cream-100">
          Before you send
        </h2>
        <ul className="list-disc list-outside pl-6 space-y-1.5 text-[14.5px]">
          {t.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-forest-900 dark:text-cream-100">
          Template
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/65">
          Replace every {'{{token}}'} with your own information.
          Print, copy, or paste into a document. No signup needed.
        </p>
        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/40 p-5">
          <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap font-mono text-ink-800 dark:text-cream-100/85">
            {t.body}
          </pre>
        </div>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65 space-y-2">
        <p>
          Last reviewed: {t.lastReviewed}. This template is
          informational only and is not legal advice. Consult a
          licensed attorney in your jurisdiction before sending.
        </p>
        <p>
          More templates:{' '}
          <Link href="/templates" className="underline">
            advottic.com/templates
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
