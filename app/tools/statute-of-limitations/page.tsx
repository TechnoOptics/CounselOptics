import type { Metadata } from 'next';
import Link from 'next/link';
import { STATES_SOL, CLAIM_TYPES } from '@/lib/statute-of-limitations';
import { StatuteOfLimitationsChecker } from './StatuteOfLimitationsChecker';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: {
    absolute:
      'Statute of limitations checker (50 states) · Advottic',
  },
  description:
    'Free statute of limitations checker by state and claim type. Personal injury, contract, fraud, defamation, medical malpractice, wrongful death, debt collection. All 50 states + DC. No signup.',
  alternates: { canonical: '/tools/statute-of-limitations' },
  keywords: [
    'statute of limitations',
    'how long do I have to sue',
    'time limit to file lawsuit',
    'personal injury statute of limitations',
    'breach of contract statute of limitations',
    'medical malpractice statute of limitations',
    'fraud statute of limitations',
    'state by state statute of limitations',
  ],
  openGraph: {
    title: 'Statute of limitations checker (50 states + DC)',
    description:
      'Pick a state and a claim type. Get the time limit to file in plain English. Free, no signup.',
    url: '/tools/statute-of-limitations',
    type: 'website',
  },
};

export default function StatuteOfLimitationsPage() {
  const url = 'https://advottic.com/tools/statute-of-limitations';
  // FAQPage JSON-LD seeds the result panel Google shows on
  // related "statute of limitations [claim type]" queries. Each
  // claim type contributes one Q/A.
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: CLAIM_TYPES.map((c) => ({
      '@type': 'Question',
      name: `What is the statute of limitations for ${c.label.toLowerCase()} claims in the United States?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${c.description} Time limits vary by state, generally from 1 to 10 years from the date of harm. Use the picker on this page to find the limit in your state.`,
      },
    })),
  };
  const webAppJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${url}#app`,
    name: 'Statute of Limitations Checker',
    applicationCategory: 'LegalService',
    operatingSystem: 'Web',
    url,
    description:
      'Interactive checker for U.S. statutes of limitation across 50 states and 9 claim types.',
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
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
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
        name: 'Tools',
        item: 'https://advottic.com/tools',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Statute of limitations checker',
        item: url,
      },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          Statute of limitations checker
        </span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Tool</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          How long do I have to sue?
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed max-w-prose">
          Pick a state and a type of claim. We will show you the
          time window in plain English, plus the caveat that
          matters most (discovery rule, statute of repose, foreign
          object exception). Covers all 50 states and DC.
        </p>
      </header>

      <StatuteOfLimitationsChecker />

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Why this matters
        </h2>
        <p className="text-[15px] leading-relaxed">
          Once the statute of limitations runs, your right to sue
          is gone. A judge will dismiss the case at the
          defendant&rsquo;s first request, no matter how strong
          your evidence is. That is why these deadlines are
          considered &ldquo;jurisdictional&rdquo; in most states.
        </p>
        <p className="text-[15px] leading-relaxed">
          A few exceptions can pause the clock: the harm was
          hidden (the &ldquo;discovery rule&rdquo;), the
          plaintiff was a minor or mentally incompetent, the
          defendant left the state, or fraud concealed the cause
          of action. These doctrines are powerful but narrow.
          Talk to a lawyer before assuming one applies to you.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Coverage
        </h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[13.5px]">
          {STATES_SOL.map((s) => (
            <li key={s.slug} className="text-ink-700 dark:text-cream-100/75">
              {s.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65 space-y-2">
        <p>
          Last reviewed: 2026-06-08. Statutes change. The figures
          here reflect the controlling statute as of that date.
          Confirm against your jurisdiction&rsquo;s current code
          and consult a licensed attorney before acting.
        </p>
        <p>
          See also:{' '}
          <Link href="/guides/how-long-do-i-have-to-sue" className="underline">
            the full guide to deadlines
          </Link>
          ,{' '}
          <Link href="/templates/demand-letter" className="underline">
            the demand-letter template
          </Link>
          , or{' '}
          <Link href="/resources/states" className="underline">
            small claims by state
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
