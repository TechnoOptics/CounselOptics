import type { Metadata } from 'next';
import Link from 'next/link';
import { DEPOSIT_RULES } from '@/lib/security-deposit-rules';
import { SecurityDepositChecker } from './SecurityDepositChecker';

export const dynamic = 'force-static';

const URL = 'https://advottic.com/tools/security-deposit-deduction-checker';

export const metadata: Metadata = {
  title: {
    absolute:
      'Security deposit deduction checker (50 states) · Advottic',
  },
  description:
    'Free security deposit checker by state. Compute what your landlord can legally keep, the return deadline, and the penalty if they wrongfully withhold. All 50 states + DC.',
  alternates: {
    canonical: '/tools/security-deposit-deduction-checker',
  },
  keywords: [
    'security deposit',
    'can my landlord keep my security deposit',
    'security deposit return',
    'security deposit deduction',
    'wrongful withholding security deposit',
    'security deposit by state',
    'tenant rights security deposit',
  ],
  openGraph: {
    title:
      'Security deposit deduction checker (50 states + DC)',
    description:
      'Free checker for tenants: what can the landlord keep, what is the deadline, what is the penalty if they wrongfully withhold.',
    url: '/tools/security-deposit-deduction-checker',
    type: 'website',
  },
};

export default function SecurityDepositPage() {
  const webApp = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${URL}#app`,
    name: 'Security Deposit Deduction Checker',
    applicationCategory: 'LegalService',
    operatingSystem: 'Web',
    url: URL,
    description:
      'Interactive checker for US security deposit law across 50 states and DC.',
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
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${URL}#faq`,
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Can my landlord keep my entire security deposit?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Most states require the landlord to provide an itemized statement of deductions if they withhold any portion of the deposit, and many states penalize the landlord (often 2x or 3x the wrongfully withheld portion) if they fail to do so within the statutory window. The picker on this page shows the rule for your state.',
        },
      },
      {
        '@type': 'Question',
        name: 'How long does my landlord have to return my security deposit?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'State law sets the deadline. The shortest is 14 days (Alaska, Arizona, Hawaii, Nebraska, New York, Vermont); the longest is 60 days (Alabama, Arkansas, Kentucky, Tennessee, West Virginia). The picker shows the exact deadline for your state.',
        },
      },
      {
        '@type': 'Question',
        name: 'What can I do if my landlord wrongfully kept my deposit?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Send a written demand letter citing the state statute and giving the landlord a deadline (typically 7-14 days) to return the wrongfully withheld portion. If the landlord refuses, you can file in small claims court. Many states allow you to recover 2x or 3x the wrongfully withheld amount plus attorney fees.',
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
        name: 'Security deposit deduction checker',
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
          Security deposit deduction checker
        </span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Tool</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Can my landlord keep my security deposit?
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed max-w-prose">
          Plug in your state, rent, deposit, and what the
          landlord kept. We show the cap, the deadline, and the
          penalty for wrongful withholding under your state&rsquo;s
          landlord-tenant code.
        </p>
      </header>

      <SecurityDepositChecker />

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          What you can do today
        </h2>
        <ol className="list-decimal list-outside pl-5 space-y-2 text-[15px] leading-relaxed">
          <li>
            Photograph the unit on move-out (timestamped). This
            is your evidence that the unit was not damaged.
          </li>
          <li>
            Send a written demand letter citing the statute and
            giving a 7-14 day deadline. Our{' '}
            <Link href="/templates/security-deposit-demand" className="underline">
              free template
            </Link>{' '}
            is the predicate for small claims.
          </li>
          <li>
            If the landlord still refuses, file in small claims.
            Most states let you recover 2x or 3x the wrongfully
            withheld portion plus attorney fees.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Coverage
        </h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[13.5px]">
          {DEPOSIT_RULES.map((s) => (
            <li
              key={s.slug}
              className="text-ink-700 dark:text-cream-100/75"
            >
              {s.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65 space-y-2">
        <p>
          Last reviewed: 2026-06-08. Informational only. Local
          ordinances often impose stricter rules than the state
          floor. Consult a licensed attorney in your state
          before relying on this result.
        </p>
        <p>
          See also:{' '}
          <Link href="/templates/security-deposit-demand" className="underline">
            demand letter template
          </Link>
          ,{' '}
          <Link href="/tools/statute-of-limitations" className="underline">
            statute of limitations
          </Link>
          ,{' '}
          <Link href="/resources/states" className="underline">
            small claims by state
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
