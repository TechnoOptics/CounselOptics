import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

const PUBLISHED_AT = '2026-06-08';
const HEADLINE =
  'Advottic opens its free legal templates library, no email gate';
const SUBHEAD =
  'Five lawyer-reviewed templates published under a permissive use license alongside a statute-of-limitations checker covering all 50 states.';

export const metadata: Metadata = {
  title: { absolute: `${HEADLINE} · Advottic` },
  description: SUBHEAD,
  alternates: {
    canonical: '/press/2026-06-08-templates-open-source',
  },
  openGraph: {
    title: HEADLINE,
    description: SUBHEAD,
    url: '/press/2026-06-08-templates-open-source',
    type: 'article',
    publishedTime: PUBLISHED_AT,
    authors: ['Techno Optics LLC'],
  },
};

export default function TemplatesPressReleasePage() {
  const url =
    'https://advottic.com/press/2026-06-08-templates-open-source';
  // NewsArticle keeps the page eligible for Google News + the
  // Top Stories rail when legal-tech reporters search for "free
  // legal templates 2026" or similar.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'NewsArticle',
        '@id': `${url}#article`,
        headline: HEADLINE,
        description: SUBHEAD,
        datePublished: PUBLISHED_AT,
        dateModified: PUBLISHED_AT,
        url,
        articleSection: 'Press release',
        keywords: [
          'free legal templates',
          'legal tech',
          'demand letter',
          'NDA template',
          'cease and desist',
          'statute of limitations',
          'Advottic',
        ],
        author: {
          '@type': 'Organization',
          name: 'Techno Optics LLC',
          url: 'https://advottic.com/about',
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
        mainEntityOfPage: url,
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
            name: 'Press',
            item: 'https://advottic.com/press',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: HEADLINE,
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
        <Link href="/press" className="underline hover:no-underline">
          Press
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          Templates announcement
        </span>
      </nav>

      <header className="space-y-3">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Press release &bull; {PUBLISHED_AT}
        </p>
        <h1 className="font-display text-[36px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {HEADLINE}
        </h1>
        <p className="text-[18px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          {SUBHEAD}
        </p>
      </header>

      <section className="space-y-4 text-[15.5px] leading-[1.75]">
        <p>
          <strong>Minneapolis, MN &mdash; June 8, 2026.</strong>{' '}
          Advottic, the AI legal platform built and operated by
          Techno Optics LLC, today opened its library of free,
          lawyer-reviewed legal templates to the public with no
          email gate and no signup. The launch covers five of the
          most-requested documents in consumer legal work: a
          demand letter, a mutual non-disclosure agreement, a
          cease-and-desist letter, a lease termination notice,
          and a security-deposit return demand.
        </p>
        <p>
          The templates are paired with a new interactive
          statute-of-limitations checker that covers all 50
          states and the District of Columbia across nine claim
          types &mdash; personal injury, breach of written
          contract, breach of oral contract, property damage,
          fraud, defamation, medical malpractice, wrongful death,
          and debt collection. The picker returns the controlling
          time window in plain English with the relevant caveat
          (discovery rule, statute of repose, foreign-object
          exception).
        </p>
        <p>
          &ldquo;The status quo for free legal templates is a
          form, an email gate, and an upsell,&rdquo; said Abel
          Muchai, founder of Techno Optics LLC. &ldquo;That
          friction means a tenant trying to write a return-
          deposit letter at 11pm closes the tab. We are removing
          the friction. The templates are good, they are free,
          and there is no wall.&rdquo;
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          What ships today
        </h2>
        <ul className="space-y-2 text-[14.5px] leading-relaxed list-disc list-outside pl-5">
          <li>
            <Link
              href="/templates/demand-letter"
              className="underline"
            >
              Demand letter
            </Link>{' '}
            &mdash; the predicate for most consumer disputes
            (unpaid invoice, lemon-law refund, settlement
            opening).
          </li>
          <li>
            <Link
              href="/templates/nda"
              className="underline"
            >
              Mutual non-disclosure agreement
            </Link>{' '}
            &mdash; a short, plain-English NDA for founders,
            freelancers, and early business conversations.
          </li>
          <li>
            <Link
              href="/templates/cease-and-desist"
              className="underline"
            >
              Cease-and-desist letter
            </Link>{' '}
            &mdash; for trademark, defamation, harassment, and
            unauthorized-use scenarios.
          </li>
          <li>
            <Link
              href="/templates/lease-termination-notice"
              className="underline"
            >
              Lease termination notice
            </Link>{' '}
            &mdash; the notice tenants and landlords use to end a
            lease cleanly.
          </li>
          <li>
            <Link
              href="/templates/security-deposit-demand"
              className="underline"
            >
              Security-deposit return demand
            </Link>{' '}
            &mdash; the formal demand that precedes a small-
            claims filing in most states.
          </li>
          <li>
            <Link
              href="/tools/statute-of-limitations"
              className="underline"
            >
              Statute of limitations checker
            </Link>{' '}
            &mdash; 50 states + DC, 9 claim types, interactive.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Why now
        </h2>
        <p className="text-[15.5px] leading-relaxed">
          Advottic&rsquo;s thesis is that legal AI works best when
          it is bundled with the workflow it operates on. Free,
          static templates are the entry point: a tenant or
          small-business owner who lands on /templates and
          finishes the task can take their case file into the
          full product without losing context. The templates
          library is the consumer half of that strategy; the
          newly shipped Advottic Counsel platform &mdash; case
          management, trust accounting, an AI agent that acts
          inside the firm&rsquo;s tools &mdash; is the
          professional half.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          About Advottic
        </h2>
        <p className="text-[15px] leading-relaxed">
          Advottic is built and operated by Techno Optics LLC, a
          Minnesota-based software company. The platform serves
          two audiences: individuals handling their own legal
          matters and law firms running their entire practice on
          one stack. Free accounts are available at{' '}
          <Link href="/" className="underline">
            advottic.com
          </Link>{' '}
          without a credit card.
        </p>
      </section>

      <section className="space-y-2 pt-2 border-t border-ink-200 dark:border-forest-700/60">
        <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
          Media contact
        </h2>
        <p className="text-[14px] text-ink-700 dark:text-cream-100/80">
          Press:{' '}
          <a
            href="mailto:press@advottic.com"
            className="underline"
          >
            press@advottic.com
          </a>
          <br />
          General:{' '}
          <a
            href="mailto:contact@advottic.com"
            className="underline"
          >
            contact@advottic.com
          </a>
          <br />
          Press kit:{' '}
          <Link href="/press" className="underline">
            advottic.com/press
          </Link>
        </p>
      </section>
    </article>
  );
}
