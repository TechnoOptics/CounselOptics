import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

const TOOLS: Array<{
  href: string;
  title: string;
  oneLine: string;
  eyebrow: string;
}> = [
  {
    href: '/tools/statute-of-limitations',
    title: 'Statute of limitations checker',
    oneLine:
      'Pick a state and a claim type. Get the deadline to file in plain English. 50 states + DC, 9 claim categories.',
    eyebrow: 'Deadlines',
  },
  {
    href: '/tools/court-deadline-calculator',
    title: 'Court deadline calculator',
    oneLine:
      'Compute answer, appeal, discovery, and motion deadlines from any event date. Federal and state rules. Rolls weekends.',
    eyebrow: 'Deadlines',
  },
];

export const metadata: Metadata = {
  title: { absolute: 'Free legal tools · Advottic' },
  description:
    'Free interactive legal tools: statute of limitations checker, demand-letter starter, deadline calculators. No signup, no email gate.',
  alternates: { canonical: '/tools' },
  openGraph: {
    title: 'Advottic free legal tools',
    description:
      'Interactive checkers and calculators. No signup. No email gate.',
    url: '/tools',
    type: 'website',
  },
};

export default function ToolsIndexPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': 'https://advottic.com/tools#page',
    name: 'Advottic free legal tools',
    url: 'https://advottic.com/tools',
    hasPart: TOOLS.map((t) => ({
      '@type': 'WebApplication',
      name: t.title,
      url: `https://advottic.com${t.href}`,
      applicationCategory: 'LegalService',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    })),
  };
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Tools</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Free interactive legal tools.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Interactive checkers and calculators that answer the
          questions Google searches ask. No signup, no email gate.
        </p>
      </header>

      <ul className="space-y-5">
        {TOOLS.map((t) => (
          <li
            key={t.href}
            className="border-l-2 border-gold-metal/40 pl-5 py-1"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {t.eyebrow}
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link href={t.href} className="hover:underline">
                {t.title}
              </Link>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {t.oneLine}{' '}
              <Link
                href={t.href}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Open the tool &rarr;
              </Link>
            </p>
          </li>
        ))}
      </ul>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          These tools are informational only and are not legal
          advice. Consult a licensed attorney in your
          jurisdiction before relying on a result.
        </p>
      </section>
    </article>
  );
}
