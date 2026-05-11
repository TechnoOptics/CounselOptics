import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { COMPARISONS, type Comparison } from '@/lib/comparisons';
import { BreadcrumbJsonLd, FaqJsonLd } from '@/components/seo/JsonLd';

type Props = { params: { slug: string } };

export const dynamicParams = false;
export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ slug: c.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const c = COMPARISONS.find((x) => x.slug === params.slug);
  if (!c) return { title: 'Not found' };
  const title = `Advottic vs ${c.competitorName} (${c.category}) - honest comparison`;
  const url = `/compare/${c.slug}`;
  return {
    title,
    description: c.description,
    keywords: c.keywords,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: c.description,
      type: 'article',
      url,
      modifiedTime: c.reviewedAt,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: c.description,
    },
  };
}

/**
 * Comparison detail page. Each entry in lib/comparisons.ts gets its
 * own URL at /compare/[slug] with:
 *
 *   - H1 hitting the brand-vs search term
 *   - Honest hook (2 paragraphs)
 *   - Side-by-side feature table (Google's "Product Comparison" rich
 *     snippet candidate)
 *   - Pricing snapshot with source attribution
 *   - "We win when..." paragraphs
 *   - "They win when..." paragraphs - honest balance builds trust
 *     AND ranks better; Google rewards "balanced comparison" signals
 *   - FAQ accordion + FAQPage JSON-LD
 *
 * This page targets the highest-commercial-intent SEO surface in
 * legal-tech: brand-comparison queries. People searching "clio
 * alternatives" are usually 4-8 weeks from a buying decision.
 */
export default function ComparePage({ params }: Props) {
  const c = COMPARISONS.find((x) => x.slug === params.slug);
  if (!c) notFound();

  const reviewedDate = new Date(c.reviewedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <article className="max-w-5xl mx-auto px-4 sm:px-6 space-y-12 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Compare', href: '/compare' },
          {
            name: `Advottic vs ${c.competitorName}`,
            href: `/compare/${c.slug}`,
          },
        ]}
      />
      <FaqJsonLd questions={c.faq} />

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
            <Link href="/compare" className="hover:text-forest-700 dark:hover:text-cream-100">
              Compare
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="text-ink-700 dark:text-cream-100/85">
            Advottic vs {c.competitorName}
          </li>
        </ol>
      </nav>

      <header className="space-y-5 max-w-3xl">
        <p className="eyebrow">{c.category}</p>
        <h1 className="font-display text-[36px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Advottic vs {c.competitorName}
        </h1>
        <p className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
          Last reviewed {reviewedDate}
        </p>
        <div className="space-y-3 text-[16px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          {c.hook.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </header>

      {/* Side-by-side feature table */}
      <section className="space-y-4">
        <h2 className="font-display text-[26px] sm:text-[32px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Side-by-side feature comparison
        </h2>
        <div className="overflow-x-auto rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40">
          <table className="w-full text-[13.5px]">
            <thead className="bg-cream-50 dark:bg-forest-900/60">
              <tr>
                <th className="text-left p-3 sm:p-4 font-semibold text-forest-900 dark:text-cream-100 w-[40%]">
                  Feature
                </th>
                <th className="text-left p-3 sm:p-4 font-semibold text-forest-900 dark:text-cream-100">
                  Advottic
                </th>
                <th className="text-left p-3 sm:p-4 font-semibold text-forest-900 dark:text-cream-100">
                  {c.competitorName}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
              {c.features.map((f) => (
                <tr key={f.label} className="bg-white dark:bg-forest-950/40">
                  <td className="p-3 sm:p-4 align-top text-forest-900 dark:text-cream-100">
                    {f.label}
                  </td>
                  <td className="p-3 sm:p-4 align-top text-ink-700 dark:text-cream-100/80">
                    {f.advottic}
                  </td>
                  <td className="p-3 sm:p-4 align-top text-ink-700 dark:text-cream-100/80">
                    {f.competitor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing snapshot */}
      <section className="rounded-2xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-gradient-to-b from-amber-50/30 to-transparent dark:from-amber-950/15 p-6 sm:p-8 space-y-3">
        <h2 className="font-display text-[22px] font-medium text-forest-900 dark:text-cream-100">
          Pricing snapshot
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
              Advottic
            </dt>
            <dd className="mt-1 font-display text-base font-medium text-forest-900 dark:text-cream-100">
              {c.pricing.advottic}
            </dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
              {c.competitorName}
            </dt>
            <dd className="mt-1 font-display text-base font-medium text-forest-900 dark:text-cream-100">
              {c.pricing.competitor}
            </dd>
          </div>
        </dl>
        {c.pricing.sourceUrl && (
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 pt-2 border-t border-ink-100 dark:border-forest-700/40">
            Source:{' '}
            <a
              href={c.pricing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {c.pricing.sourceLabel ?? c.pricing.sourceUrl}
            </a>
          </p>
        )}
      </section>

      {/* Where Advottic wins */}
      <section className="space-y-5">
        <h2 className="font-display text-[26px] sm:text-[32px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          When Advottic is the better fit
        </h2>
        <div className="space-y-5">
          {c.advotticWins.map((w, i) => (
            <div
              key={i}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 sm:p-6 space-y-2"
            >
              <h3 className="font-display text-[18px] font-medium text-forest-900 dark:text-cream-100">
                {w.heading}
              </h3>
              <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
                {w.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Where the competitor wins - honest balance */}
      <section className="space-y-5">
        <h2 className="font-display text-[26px] sm:text-[32px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          When {c.competitorName} is the better fit
        </h2>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-prose">
          We name the cases where the competitor is the right call. Honest
          comparison builds trust and helps you make a decision you
          won&rsquo;t regret.
        </p>
        <div className="space-y-5">
          {c.competitorWins.map((w, i) => (
            <div
              key={i}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/40 p-5 sm:p-6 space-y-2"
            >
              <h3 className="font-display text-[18px] font-medium text-forest-900 dark:text-cream-100">
                {w.heading}
              </h3>
              <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
                {w.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <aside className="rounded-xl ring-2 ring-gold-metal/60 dark:ring-amber-500/40 bg-gradient-to-b from-amber-50/40 to-transparent dark:from-amber-950/20 p-6 sm:p-8 space-y-4 max-w-3xl">
        <p className="eyebrow">Ready to try Advottic?</p>
        <p className="font-display text-xl sm:text-2xl text-forest-900 dark:text-cream-100 leading-tight">
          14-day free trial. No credit card. Migrate from {c.competitorName} in
          one click.
        </p>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/75 leading-relaxed">
          Counsel Small Firm starts at $99 per user per month with everything
          included: case management, IOLTA, e-signature, Bella AI, and the
          marketplace.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/sign-in?next=/counsel/onboarding" className="btn-primary">
            Start 14-day trial
          </Link>
          <Link href="/pricing" className="btn-secondary">
            See all pricing
          </Link>
        </div>
      </aside>

      {/* FAQ */}
      <section className="space-y-5 max-w-3xl">
        <h2 className="font-display text-[26px] sm:text-[32px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Frequently asked
        </h2>
        <ul className="space-y-3">
          {c.faq.map((qa) => (
            <li
              key={qa.q}
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
                  {qa.a}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {/* Related comparisons */}
      <section className="space-y-5 pt-6 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-[20px] font-medium text-forest-900 dark:text-cream-100">
          More comparisons
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {COMPARISONS.filter((x) => x.slug !== c.slug)
            .slice(0, 3)
            .map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/compare/${r.slug}`}
                  className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4 hover:-translate-y-0.5 hover:shadow-sm transition-all"
                >
                  <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                    Advottic vs
                  </p>
                  <p className="mt-1 font-medium text-forest-900 dark:text-cream-100 text-[14.5px]">
                    {r.competitorName}
                  </p>
                </Link>
              </li>
            ))}
        </ul>
        <p className="text-[13px] pt-2">
          <Link
            href="/compare"
            className="text-forest-700 dark:text-cream-100/80 underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            See all comparisons &rarr;
          </Link>
        </p>
      </section>

      <footer className="pt-8 border-t border-ink-200 dark:border-forest-700/40 text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        <p>
          This comparison is independent. Advottic does not have a paid
          relationship with {c.competitorName}. Pricing and features are
          accurate as of {reviewedDate} per the cited sources; subject to
          change as competitors evolve. Email{' '}
          <a href="mailto:hello@advottic.com" className="underline">
            hello@advottic.com
          </a>{' '}
          to flag inaccuracies.
        </p>
      </footer>
    </article>
  );
}
