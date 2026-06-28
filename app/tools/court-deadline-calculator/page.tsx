import type { Metadata } from 'next';
import Link from 'next/link';
import { CourtDeadlineCalculator } from './CourtDeadlineCalculator';

export const dynamic = 'force-static';

const URL = 'https://advottic.com/tools/court-deadline-calculator';

export const metadata: Metadata = {
  title: {
    absolute: 'Court deadline calculator (FRCP + state) · Advottic',
  },
  description:
    'Free court deadline calculator. Compute answer deadlines, appeal windows, discovery cutoffs, and statute-of-limitations dates from any event. Rolls weekends. Federal and state rules.',
  alternates: { canonical: '/tools/court-deadline-calculator' },
  keywords: [
    'court deadline calculator',
    'answer deadline',
    'response to complaint deadline',
    'civil procedure deadline calculator',
    'FRCP deadline',
    'state court answer deadline',
    'appeal deadline calculator',
  ],
  openGraph: {
    title: 'Court deadline calculator',
    description:
      'Free calculator for answer, appeal, discovery, and SOL deadlines. Federal + state rules.',
    url: '/tools/court-deadline-calculator',
    type: 'website',
  },
};

export default function CourtDeadlineCalculatorPage() {
  const webApp = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${URL}#app`,
    name: 'Court Deadline Calculator',
    applicationCategory: 'LegalService',
    operatingSystem: 'Web',
    url: URL,
    description:
      'Interactive calculator for civil procedure deadlines, including answer windows, appeals, discovery cutoffs, and statute-of-limitations dates.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Advottic',
      url: 'https://advottic.com/',
    },
  };
  // Each Q/A mirrors a fact stated in the visible sections below
  // (the deadline types the tool covers, the FRCP/state 30-day answer
  // window, and the next-business-day weekend convention) so the
  // FAQPage schema stays in sync with the page content.
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${URL}#faq`,
    mainEntity: [
      {
        '@type': 'Question',
        name: 'How is the answer deadline calculated?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The answer deadline is counted forward from the date you were served. Under the Federal Rules of Civil Procedure the window is 21 days; most state courts (including CA, NY, TX, FL, and IL) use a 30-day window. Pick the event and rule set and the calculator does the date math for you.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do weekends and holidays count toward the deadline?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Every day is counted, but if the final day lands on a Saturday, Sunday, or court holiday, the deadline rolls forward to the next business day. This is the standard next-business-day convention most courts follow. The calculator applies it automatically when you choose to roll weekends.',
        },
      },
      {
        '@type': 'Question',
        name: 'What deadlines can this calculator compute?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'It computes answer and response deadlines, appeal windows, discovery cutoffs, and statute-of-limitations dates, measured from any event you enter such as the date you were served, the hearing date, or the date judgment was entered.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is this a substitute for checking my local court rules?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. The calculator uses the standard federal and state windows, but local rules, the method of service, and court holidays can shorten or extend any deadline. Treat the result as a starting point and confirm the date against your court\'s local rules or a licensed attorney before relying on it.',
        },
      },
    ],
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${URL}#breadcrumbs`,
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
        name: 'Tools',
        item: 'https://advottic.com/tools',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Court deadline calculator',
        item: URL,
      },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApp) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <Link href="/tools" className="underline hover:no-underline">
          Tools
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          Court deadline calculator
        </span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Tool</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Court deadline calculator.
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed max-w-prose">
          Pick the event (you were served, the hearing is set,
          the judgment was entered) and the type of deadline.
          We do the date math and roll weekends to the next
          business day if you want.
        </p>
      </header>

      <CourtDeadlineCalculator />

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          How the deadlines are computed
        </h2>
        <p className="text-[15px] leading-relaxed">
          The default rule sets are the Federal Rules of Civil
          Procedure (FRCP) and the typical state-court windows
          (CA, NY, TX, FL, IL all use the 30-day answer window).
          State variants are noted in the picker. Local rules
          can shorten or extend any of these windows; always
          confirm in your specific court&rsquo;s local rules.
        </p>
        <p className="text-[15px] leading-relaxed">
          Weekend rolling follows the standard
          &ldquo;next-business-day&rdquo; convention used by
          most courts: a Saturday deadline rolls to Monday, a
          Sunday rolls to Monday, and a backward count from a
          weekend rolls back to Friday.
        </p>
      </section>

      <section className="space-y-4 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Common questions
        </h2>
        <div className="space-y-3">
          {faq.mainEntity.map((qa) => (
            <details
              key={qa.name}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-4"
            >
              <summary className="font-medium text-forest-900 dark:text-cream-100 cursor-pointer text-[15px]">
                {qa.name}
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-700 dark:text-cream-100/80">
                {qa.acceptedAnswer.text}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65 space-y-2">
        <p>
          Last reviewed: 2026-06-08. Informational only.
          Service method, holidays, and local rules all affect
          the actual computed deadline. Confirm with your state
          code or a licensed attorney before relying on a date.
        </p>
        <p>
          See also:{' '}
          <Link href="/tools/statute-of-limitations" className="underline">
            statute of limitations checker
          </Link>
          ,{' '}
          <Link href="/templates/demand-letter" className="underline">
            demand letter template
          </Link>
          ,{' '}
          <Link href="/guides/i-was-served-with-a-lawsuit" className="underline">
            how to respond to a lawsuit
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
