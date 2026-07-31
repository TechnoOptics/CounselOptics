import Link from 'next/link';
import Image from 'next/image';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';
import { isIosAppRequest } from '@/lib/ios-gate';

export const metadata = {
  title: 'Press kit',
  description:
    'Press kit for Advottic: company facts, founder bio, brand assets, screenshots, and media contact.',
  alternates: { canonical: '/press' },
  openGraph: {
    title: 'Advottic press kit',
    description:
      'Company facts, founder bio, brand assets, screenshots, and media contact.',
    type: 'website',
    url: '/press',
  },
};

/**
 * Press / media kit. Single resource page that journalists hit when
 * researching the company. Loaded with: one-paragraph company
 * description, founder bio, key product facts, brand assets (logo
 * download in two color variants), and a single media-contact email.
 *
 * The signal Google + LLM crawlers extract from this page is the
 * authoritative "who is Advottic" answer, which they then echo back
 * in zero-click summaries. Keep the bullet facts fresh.
 */

const FACTS: Array<{ label: string; value: string }> = [
  { label: 'Legal name', value: 'Techno Optics LLC' },
  { label: 'Product name', value: 'Advottic' },
  { label: 'Founded', value: '2024' },
  { label: 'Headquarters', value: 'Minnesota, USA' },
  { label: 'Category', value: 'Legal technology / SaaS' },
  {
    label: 'Pricing',
    value: 'Free tier; $19-$39/mo personal; $59-$149/user/mo for firms',
  },
  {
    label: 'Coverage',
    value: 'United States (50 states + Federal); auto-fill for CA/NY/TX/FL',
  },
];

export default function PressPage() {
  const isIos = isIosAppRequest();
  return (
    <div className="space-y-16 sm:space-y-20 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Press', href: '/press' },
        ]}
      />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Press kit</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          For journalists &amp; analysts.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Everything you need to write about Advottic, in one page.
          For interviews, embargo requests, or product demos, email{' '}
          <a
            href="mailto:press@advottic.com"
            className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            press@advottic.com
          </a>
          .
        </p>
      </header>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          About Advottic
        </h2>
        <div className="space-y-4 text-[15px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          <p>
            Advottic is an AI-powered legal platform with two
            audiences. Individuals use it to handle their own matters:
            organize a case file, draft demand letters, review
            contracts, get plain-English answers from Bella, an
            always-on AI legal assistant. Law firms use Advottic
            Counsel to run their entire practice: case management,
            time and billing, IOLTA trust accounting, e-signature, and
            an AI agent that takes action inside the firm&rsquo;s
            tools (drafting documents, running conflict checks,
            starting time entries on its own).
          </p>
          <p>
            The thesis: legal AI works best when it is bundled with
            the workflow it operates on. Stand-alone AI products force
            firms to maintain three vendors and copy-paste between
            them. Advottic ships the AI inside the dashboard that
            already runs the firm.
          </p>
          <p>
            Advottic is built and operated by Techno Optics LLC, a
            Minnesota-based software company.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Fast facts
        </h2>
        <dl className="grid sm:grid-cols-2 gap-3">
          {/* The "Pricing" fact is a price list. Guideline 3.1.1: no prices
              inside the iOS app. Dropped from the iOS render (server signal)
              and marked data-hide-on-ios as the second signal. Every other
              fact is unchanged on every platform. */}
          {FACTS.filter((f) => !(isIos && f.label === 'Pricing')).map((f) => (
            <div
              key={f.label}
              {...(f.label === 'Pricing' ? { 'data-hide-on-ios': '' } : {})}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4"
            >
              <dt className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                {f.label}
              </dt>
              <dd className="mt-1 text-[14.5px] text-forest-900 dark:text-cream-100 leading-snug">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Brand assets
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-prose">
          Always preserve the wordmark&rsquo;s aspect ratio. Use the
          dark variant on light backgrounds and the light variant on
          dark / colored backgrounds. Minimum clear space on all sides
          equals the cap-height of the &ldquo;A&rdquo;.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white p-6 flex items-center justify-center">
            <Image
              src="/advottic-wordmark.png"
              alt="Advottic wordmark, dark variant"
              width={14494}
              height={1699}
              className="h-10 w-auto"
            />
          </div>
          <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-forest-950 p-6 flex items-center justify-center">
            <Image
              src="/advottic-wordmark.png"
              alt="Advottic wordmark, light variant"
              width={14494}
              height={1699}
              className="h-10 w-auto"
            />
          </div>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          Right-click the wordmark to download. Vector versions and
          additional formats available on request.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Media contact
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          Press inquiries:{' '}
          <a
            href="mailto:press@advottic.com"
            className="font-medium text-forest-900 dark:text-cream-100 underline underline-offset-2"
          >
            press@advottic.com
          </a>
          <br />
          General contact:{' '}
          <a
            href="mailto:contact@advottic.com"
            className="font-medium text-forest-900 dark:text-cream-100 underline underline-offset-2"
          >
            contact@advottic.com
          </a>
          <br />
          Security disclosure:{' '}
          <a
            href="mailto:security@advottic.com"
            className="font-medium text-forest-900 dark:text-cream-100 underline underline-offset-2"
          >
            security@advottic.com
          </a>
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-3 text-center">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Want to try the product?
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Free accounts are available without a credit card. For a
          guided walkthrough or sandbox access, email press.
        </p>
        <div className="pt-3">
          <Link href="/sign-in?next=/cases" className="btn-primary">
            Create a free account
          </Link>
        </div>
      </section>
    </div>
  );
}
