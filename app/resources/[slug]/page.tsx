import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ARTICLES, type Article } from '@/lib/articles';
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
  FaqJsonLd,
} from '@/components/seo/JsonLd';
import { NewsletterSignup } from '@/components/NewsletterSignup';

/**
 * Server-rendered article detail page. Each entry in lib/articles.ts
 * gets its own URL at /resources/[slug] with full structured data
 * (Article + Breadcrumb + optional FAQPage), an internal-link rich
 * body, an FAQ accordion, and a CTA back to the product. The slug
 * route is the SEO workhorse - this is where Google indexes
 * keyword-rich answers and where backlinks land.
 *
 * This file is intentionally unstyled-by-default: it borrows the
 * `prose` class layer from globals.css for typography, and falls
 * back to plain Tailwind for everything else.
 */

type Props = { params: { slug: string } };

// Pre-render every article at build time. Falls back to 404 for
// unknown slugs (dynamicParams = false).
export const dynamicParams = false;
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const a = ARTICLES.find((x) => x.slug === params.slug);
  if (!a) return { title: 'Not found' };
  const url = `/resources/${a.slug}`;
  return {
    title: a.title,
    description: a.description,
    keywords: a.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: a.title,
      description: a.description,
      type: 'article',
      url,
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt ?? a.publishedAt,
    },
    twitter: {
      card: 'summary_large_image',
      title: a.title,
      description: a.description,
    },
  };
}

export default function ArticlePage({ params }: Props) {
  const article = ARTICLES.find((a) => a.slug === params.slug);
  if (!article) notFound();

  const date = new Date(article.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // 3 related articles in the same category (excluding self), then
  // pad with cross-category if needed. Cheap signal that boosts
  // dwell time + internal-link graph.
  const sameCat = ARTICLES.filter(
    (a) => a.category === article.category && a.slug !== article.slug,
  );
  const otherCat = ARTICLES.filter(
    (a) => a.category !== article.category && a.slug !== article.slug,
  );
  const related = [...sameCat, ...otherCat].slice(0, 3);

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 space-y-10 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Resources', href: '/resources' },
          { name: article.title, href: `/resources/${article.slug}` },
        ]}
      />
      <ArticleJsonLd
        title={article.title}
        description={article.description}
        slug={article.slug}
        publishedAt={article.publishedAt}
        updatedAt={article.updatedAt}
      />
      {article.faq && article.faq.length > 0 && (
        <FaqJsonLd questions={article.faq} />
      )}

      {/* Breadcrumb (visible) */}
      <nav
        aria-label="Breadcrumb"
        className="text-[12px] font-mono tracking-tight text-ink-500 dark:text-cream-100/55 pt-2"
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-forest-700 dark:hover:text-cream-100">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              href="/resources"
              className="hover:text-forest-700 dark:hover:text-cream-100"
            >
              Resources
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="text-ink-700 dark:text-cream-100/85 truncate max-w-[60vw]">
            {article.title}
          </li>
        </ol>
      </nav>

      <header className="space-y-4">
        <div className="flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
          <span>{categoryLabel(article.category)}</span>
          <span aria-hidden>·</span>
          <span>{date}</span>
          <span aria-hidden>·</span>
          <span>{article.readMinutes} min read</span>
        </div>
        <h1 className="font-display text-[34px] sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.1] text-forest-900 dark:text-cream-100">
          {article.title}
        </h1>
        <p className="text-base sm:text-[17px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          {article.description}
        </p>
      </header>

      <div className="space-y-10 prose prose-lg max-w-none">
        {article.sections.map((s, i) => (
          <section key={i} className="space-y-3">
            <h2 className="font-display text-[24px] sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
              {s.heading}
            </h2>
            {s.body.map((para, j) => (
              <p
                key={j}
                className="text-[15.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]"
              >
                {renderInline(para)}
              </p>
            ))}
          </section>
        ))}
      </div>

      {article.cta && (
        <aside className="rounded-xl ring-2 ring-gold-metal/60 dark:ring-amber-500/40 bg-gradient-to-b from-amber-50/40 to-transparent dark:from-amber-950/20 p-6 sm:p-8 space-y-4">
          <p className="eyebrow">Ready to act on this?</p>
          <p className="font-display text-xl sm:text-2xl text-forest-900 dark:text-cream-100 leading-tight">
            Let Bella draft it for you in two minutes.
          </p>
          <p className="text-[14px] text-ink-600 dark:text-cream-100/75 leading-relaxed">
            Advottic&rsquo;s legal AI handles the boilerplate so you
            can focus on the substance. Free for the first three
            drafts.
          </p>
          <Link href={article.cta.href} className="btn-primary inline-flex">
            {article.cta.label}
          </Link>
        </aside>
      )}

      {article.faq && article.faq.length > 0 && (
        <section className="space-y-5">
          <h2 className="font-display text-[24px] sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Frequently asked questions
          </h2>
          <ul className="space-y-3">
            {article.faq.map((qa, i) => (
              <li
                key={i}
                className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40"
              >
                <details className="group">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-start justify-between gap-3 p-4 sm:p-5">
                    <span className="font-medium text-forest-900 dark:text-cream-100 text-[15px] leading-snug">
                      {qa.q}
                    </span>
                    <span
                      aria-hidden
                      className="text-ink-500 dark:text-cream-100/55 text-lg leading-none transition-transform group-open:rotate-45 mt-0.5 shrink-0"
                    >
                      +
                    </span>
                  </summary>
                  <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-[14.5px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
                    {renderInline(qa.a)}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pt-6 border-t border-ink-200 dark:border-forest-700/40">
        <NewsletterSignup
          source={`article_${article.slug}`}
          variant="card"
        />
      </section>

      <section className="space-y-5 pt-6 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-[20px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Related guides
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {related.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/resources/${r.slug}`}
                className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4 hover:-translate-y-0.5 hover:shadow-sm transition-all"
              >
                <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                  {categoryLabel(r.category)}
                </p>
                <p className="mt-1 font-medium text-forest-900 dark:text-cream-100 text-[14.5px] leading-snug">
                  {r.title}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[13px] pt-2">
          <Link
            href="/resources"
            className="text-forest-700 dark:text-cream-100/80 underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            Browse all resources &rarr;
          </Link>
        </p>
      </section>

      <footer className="pt-8 border-t border-ink-200 dark:border-forest-700/40 text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        <p>
          This guide is for general information and is not legal
          advice. Laws vary by jurisdiction; consult a licensed
          attorney for advice on your specific matter. Advottic is a
          service of Techno Optics LLC.
        </p>
      </footer>
    </article>
  );
}

/**
 * Render a paragraph with inline `[label](href)` link syntax. Keeps
 * authoring simple in lib/articles.ts (no JSX inside the strings)
 * while still letting us emit real internal links Google can crawl
 * and follow as anchor signals.
 *
 * We escape paranoid: only `[...](...)` matches; everything else is
 * plain text. No HTML injection vector since we never use
 * dangerouslySetInnerHTML on this output.
 */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match [label](href). Label disallows `]`, href disallows `)`.
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const label = m[1];
    const href = m[2];
    if (href.startsWith('http')) {
      parts.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-forest-700 dark:text-cream-100/85 underline underline-offset-2 hover:text-gold-700 dark:hover:text-gold-300"
        >
          {label}
        </a>,
      );
    } else {
      parts.push(
        <Link
          key={key++}
          href={href}
          className="text-forest-700 dark:text-cream-100/85 underline underline-offset-2 hover:text-gold-700 dark:hover:text-gold-300"
        >
          {label}
        </Link>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function categoryLabel(c: Article['category']): string {
  switch (c) {
    case 'self_help':
      return 'Self-help';
    case 'practice_management':
      return 'For law firms';
    case 'contracts':
      return 'Contracts';
    case 'ai_legal':
      return 'Legal AI';
    case 'compliance':
      return 'Compliance';
  }
}
