import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';

export const metadata = {
  title: 'Affiliate program - earn 30% on every Advottic referral',
  description:
    'Earn 30% recurring commission for the first 12 months on every paid Advottic subscription you refer. Free to join. 60-day cookie window. Monthly payouts via Stripe.',
  alternates: { canonical: '/affiliate' },
  openGraph: {
    title: 'Advottic Affiliate Program',
    description:
      'Earn 30% recurring on every paid Advottic referral. Free to join, 60-day cookie, monthly payouts.',
    type: 'website',
    url: '/affiliate',
  },
};

/**
 * Affiliate program landing page. Marketing surface and lead-capture
 * for the Advottic referral program. The actual affiliate dashboard
 * lives behind auth at /counsel/affiliate (firm side) once the user
 * applies and is approved; this page is the public sales pitch.
 *
 * Why bother with affiliates: legal-tech CAC via Google Ads is $80-
 * $200 per signup. Paying 30% recurring to legal-tech creators and
 * lawyer-influencers undercuts Google Ads, lets us compete for
 * high-intent searches we don't yet rank for organically, and seeds
 * trust signals we can't buy directly.
 */

const TIERS: Array<{
  name: string;
  rate: string;
  blurb: string;
  notes: string[];
}> = [
  {
    name: 'Personal plans',
    rate: '30%',
    blurb: 'Personal Pro and Personal Plus subscriptions.',
    notes: [
      'Recurring for the first 12 months of the customer\'s subscription.',
      'Trial-to-paid conversion = qualifying event.',
      'No cap on monthly referrals.',
    ],
  },
  {
    name: 'Counsel firm plans',
    rate: '30%',
    blurb: 'Solo, Small Firm, Growing Firm subscriptions.',
    notes: [
      'Recurring for the first 12 months on every seat.',
      'Per-seat scaling: a 5-seat Small Firm pays you on all 5 seats.',
      'Annual prepaid plans pay out as a single lump on contract start.',
    ],
  },
  {
    name: 'Enterprise',
    rate: '15% flat',
    blurb: '100+ seat enterprise contracts.',
    notes: [
      'One-time payout on contract signing.',
      'Minimum $5,000 commission.',
      'Custom co-marketing available.',
    ],
  },
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Apply in 2 minutes',
    body: 'Tell us about your audience and how you plan to share Advottic. We approve within 2 business days; affiliates with a relevant audience or following are typically auto-approved.',
  },
  {
    title: 'Get your link',
    body: 'You receive a unique tracking URL plus a dashboard with banners, social copy, and live conversion analytics. Drop the link anywhere: blog, YouTube description, newsletter, even a podcast outro.',
  },
  {
    title: 'Earn while we earn',
    body: '60-day cookie window: as long as the visitor signs up within 60 days of clicking your link, you get credit. We pay out monthly via Stripe Connect; minimum $50 payout threshold.',
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is the program free to join?',
    a: 'Yes. There is no fee to apply or remain enrolled. We retain the right to remove affiliates who engage in spam, brand bidding, or coupon-stuffing.',
  },
  {
    q: 'Can I run paid ads on the Advottic brand?',
    a: 'No. Bidding on "Advottic" or close trademark variants in Google Ads or any other paid search platform results in immediate program removal and forfeiture of unpaid commission. You may bid on generic legal-tech keywords.',
  },
  {
    q: 'What if a customer cancels?',
    a: 'Refunds in the first 60 days are clawed back from your next payout. Cancellations after the refund window have no effect on already-paid commission, but stop future commission accrual.',
  },
  {
    q: 'How do you handle attribution?',
    a: 'Last-click within the 60-day window. If a visitor lands via your link and later signs up via a different affiliate inside the window, the most-recent affiliate gets credit. The cookie is first-party so it survives most ad-blocker setups.',
  },
];

export default function AffiliatePage() {
  return (
    <div className="space-y-16 sm:space-y-20 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Affiliate', href: '/affiliate' },
        ]}
      />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Affiliate program</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Refer Advottic. Earn for a year.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          30% recurring commission for the first 12 months on every
          paid plan you refer. Free to join. 60-day cookie window.
          Monthly payouts via Stripe.
        </p>
        <div className="pt-3">
          <a
            href="mailto:affiliates@advottic.com?subject=Affiliate%20program%20application"
            className="btn-primary inline-flex"
          >
            Apply to join
          </a>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          What you earn
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 flex flex-col gap-3"
            >
              <p className="font-display text-xl text-forest-900 dark:text-cream-100">
                {t.name}
              </p>
              <p className="font-display text-3xl text-gold-700 dark:text-amber-300 tabular-nums">
                {t.rate}
              </p>
              <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-snug">
                {t.blurb}
              </p>
              <ul className="space-y-1.5 text-[12.5px] text-ink-600 dark:text-cream-100/65 leading-relaxed pt-1 border-t border-ink-100 dark:border-forest-700/40">
                {t.notes.map((n, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden className="text-forest-700 dark:text-cream-100/70">·</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          How it works
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 space-y-2"
            >
              <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                Step {i + 1}
              </p>
              <p className="font-display text-lg text-forest-900 dark:text-cream-100">
                {s.title}
              </p>
              <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Frequently asked
        </h2>
        <ul className="space-y-3">
          {FAQ.map((qa) => (
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

      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Ready to apply?
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Send a short note about your audience to{' '}
          <a
            href="mailto:affiliates@advottic.com"
            className="underline underline-offset-2"
          >
            affiliates@advottic.com
          </a>
          . We respond within two business days.
        </p>
        <div className="pt-3 flex justify-center gap-3 flex-wrap">
          <a
            href="mailto:affiliates@advottic.com?subject=Affiliate%20program%20application"
            className="btn-primary"
          >
            Apply now
          </a>
          <Link href="/pricing" data-hide-on-ios className="btn-secondary">
            See the plans
          </Link>
        </div>
      </section>
    </div>
  );
}
