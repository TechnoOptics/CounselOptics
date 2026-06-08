import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

const NAME = 'Abel Muchai';
const ROLE = 'Founder, Techno Optics LLC (Advottic)';
const URL = 'https://advottic.com/people/abel-muchai';

export const metadata: Metadata = {
  title: { absolute: `${NAME} · Founder of Advottic` },
  description: `${NAME} is the founder of Techno Optics LLC, the company behind Advottic, an AI-powered legal platform for individuals and law firms.`,
  alternates: { canonical: '/people/abel-muchai' },
  openGraph: {
    title: `${NAME}, founder of Advottic`,
    description: `Founder of Techno Optics LLC and Advottic, an AI legal platform.`,
    url: '/people/abel-muchai',
    type: 'profile',
  },
};

export default function FounderPage() {
  // Person + ProfilePage JSON-LD. The sameAs array ties this URL
  // to the Wikidata item (Q140132010) and the GBP profile so
  // Google's Knowledge Graph can fuse them. Each external
  // identifier compounds E-E-A-T - Google rewards "real person
  // with verifiable presence across the web" over "anonymous
  // marketing page."
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${URL}#page`,
        url: URL,
        mainEntity: { '@id': `${URL}#person` },
      },
      {
        '@type': 'Person',
        '@id': `${URL}#person`,
        name: NAME,
        givenName: 'Abel',
        familyName: 'Muchai',
        jobTitle: 'Founder',
        url: URL,
        worksFor: {
          '@type': 'Organization',
          name: 'Techno Optics LLC',
          url: 'https://advottic.com/about',
          sameAs: [
            'https://www.wikidata.org/wiki/Q140132010',
          ],
        },
        knowsAbout: [
          'Legal technology',
          'Artificial intelligence',
          'Software engineering',
          'Consumer law',
          'Law firm operations',
        ],
        nationality: 'American',
        homeLocation: {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Minneapolis',
            addressRegion: 'MN',
            addressCountry: 'US',
          },
        },
        sameAs: [
          'https://www.wikidata.org/wiki/Q140132010',
        ],
      },
      {
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
            name: 'People',
            item: 'https://advottic.com/people',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: NAME,
            item: URL,
          },
        ],
      },
    ],
  };

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          {NAME}
        </span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Founder</p>
        <h1 className="font-display text-[44px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {NAME}
        </h1>
        <p className="text-[17px] text-ink-700 dark:text-cream-100/80">
          {ROLE}
        </p>
      </header>

      <section className="space-y-4 text-[15px] leading-[1.75]">
        <p>
          Abel Muchai is the founder of Techno Optics LLC, the
          Minnesota-based software company that builds and
          operates Advottic, an AI-powered legal platform. He
          leads product, engineering, and go-to-market.
        </p>
        <p>
          He started Advottic on the thesis that legal AI works
          best when it is bundled with the workflow it operates
          on. Stand-alone AI products force firms to maintain
          three vendors and copy-paste between them. Advottic
          ships the AI inside the dashboard that already runs
          the firm: case management, time and billing, IOLTA
          trust accounting, e-signature, and an AI agent that
          acts inside the firm&rsquo;s tools.
        </p>
        <p>
          He is available for press interviews on legal
          technology, AI in professional services, and
          consumer access to law. Reach him through{' '}
          <a href="mailto:press@advottic.com" className="underline">
            press@advottic.com
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Topics
        </h2>
        <ul className="grid sm:grid-cols-2 gap-2 text-[14.5px]">
          <li className="border-l-2 border-gold-metal/40 pl-3">
            How AI changes legal services
          </li>
          <li className="border-l-2 border-gold-metal/40 pl-3">
            Building software for regulated industries
          </li>
          <li className="border-l-2 border-gold-metal/40 pl-3">
            Consumer access to law
          </li>
          <li className="border-l-2 border-gold-metal/40 pl-3">
            Small-firm operations and software adoption
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Verified profiles
        </h2>
        <ul className="space-y-2 text-[14.5px]">
          <li>
            Wikidata:{' '}
            <a
              href="https://www.wikidata.org/wiki/Q140132010"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Q140132010 (Advottic)
            </a>
          </li>
          <li>
            Press kit:{' '}
            <Link href="/press" className="underline">
              advottic.com/press
            </Link>
          </li>
          <li>
            Company:{' '}
            <Link href="/about" className="underline">
              About Advottic
            </Link>
          </li>
        </ul>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65">
        <p>
          Last reviewed: 2026-06-08. For interview requests or
          background information, email{' '}
          <a href="mailto:press@advottic.com" className="underline">
            press@advottic.com
          </a>
          .
        </p>
      </section>
    </article>
  );
}
