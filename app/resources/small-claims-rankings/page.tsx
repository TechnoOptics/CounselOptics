import Link from 'next/link';
import {
  STATES_SMALL_CLAIMS,
  SMALL_CLAIMS_REVIEWED_AT,
  getSmallClaimsRankings,
} from '@/lib/state-small-claims';
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
} from '@/components/seo/JsonLd';
import { RankingsTable } from './rankings-table';

export const dynamic = 'force-static';

const TITLE =
  'Small Claims Court Rankings: Every US State Compared (2026)';
const DESCRIPTION =
  'Every US state’s small claims court ranked side by side: dollar limits, filing fees, whether you can bring a lawyer, and appeal rights. Sourced from each state’s controlling statute, reviewed May 2026.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/resources/small-claims-rankings' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/resources/small-claims-rankings',
    type: 'article',
  },
};

/**
 * The flagship citable asset in the small-claims content set: a
 * single page that ranks all 50 states against each other instead
 * of describing them one at a time. This is deliberately the kind
 * of page a local reporter in any one of the 50 states can cite
 * ("how does [state] compare nationally") and the kind of page an
 * LLM answer engine prefers over 50 separate lookups when asked a
 * comparative question ("which state has the highest small claims
 * limit"). Computed from the same STATES_SMALL_CLAIMS dataset that
 * powers /resources/states/[state]/small-claims, so the two surfaces
 * can't drift apart.
 */
export default function SmallClaimsRankingsPage() {
  const r = getSmallClaimsRankings();
  const url = 'https://advottic.com/resources/small-claims-rankings';

  const datasetJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'US Small Claims Court Rankings Dataset',
    description: DESCRIPTION,
    url,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: { '@type': 'Organization', name: 'Advottic', url: 'https://advottic.com/' },
    dateModified: SMALL_CLAIMS_REVIEWED_AT,
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: 'https://advottic.com/open-data/small-claims.json',
      },
    ],
  };

  return (
    <article className="space-y-14 sm:space-y-16 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Resources', href: '/resources' },
          { name: 'Small claims rankings', href: '/resources/small-claims-rankings' },
        ]}
      />
      <ArticleJsonLd
        title={TITLE}
        description={DESCRIPTION}
        slug="small-claims-rankings"
        publishedAt="2026-07-03"
        updatedAt={SMALL_CLAIMS_REVIEWED_AT}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">50-state comparison</p>
        <h1 className="font-display text-[36px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Small claims court, ranked.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Every state sets its own dollar limit, filing fee, and
          rules on lawyers. Here they are side by side instead of
          one page at a time. Reviewed {SMALL_CLAIMS_REVIEWED_AT}.
        </p>
      </header>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Highest limit
          </p>
          <p className="mt-1.5 font-display text-2xl text-forest-900 dark:text-cream-100">
            Delaware &amp; Tennessee: $25,000
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            The only two states above $20,000. National median is
            ${r.nationalMedianLimit.toLocaleString()}.
          </p>
        </div>
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Lowest limit
          </p>
          <p className="mt-1.5 font-display text-2xl text-forest-900 dark:text-cream-100">
            Kentucky: $2,500
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            A tenth of Delaware and Tennessee&rsquo;s cap for the
            same kind of dispute.
          </p>
        </div>
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            {r.noAttorneys.length} states bar lawyers
          </p>
          <p className="mt-1.5 font-display text-2xl text-forest-900 dark:text-cream-100">
            Including California
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            {r.noAttorneys.map((s) => s.name).join(', ')}.
          </p>
        </div>
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            {r.noAppeal.length} states, no appeal
          </p>
          <p className="mt-1.5 font-display text-2xl text-forest-900 dark:text-cream-100">
            The judgment is final
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            {r.noAppeal.map((s) => s.name).join(', ')}. Everywhere
            else, Rhode Island&rsquo;s 2-day window is the
            shortest in the country.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-4">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          All 50 states, sortable
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 max-w-prose">
          Click a column to re-sort. &ldquo;Attorneys&rdquo; is
          Yes / No / Limited. Limited usually means both
          sides have to agree first.
        </p>
        <RankingsTable states={STATES_SMALL_CLAIMS} />
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Methodology
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          Figures are sourced from each state&rsquo;s controlling
          small-claims statute or court self-help center, reviewed
          {' '}{SMALL_CLAIMS_REVIEWED_AT}. Filing fees vary by claim
          amount within a state; the figure shown is the typical
          range at a mid-tier claim. States adjust limits by
          legislation every few years, so verify against the
          state&rsquo;s own court site before filing. This page is
          informational only and is not legal advice.
        </p>
        <p className="text-[13.5px] text-ink-500 dark:text-cream-100/60">
          Full dataset available as JSON, CC BY 4.0, at{' '}
          <Link href="/open-data/small-claims.json" className="underline">
            /open-data/small-claims.json
          </Link>
          . See the{' '}
          <Link href="/resources/states" className="underline">
            individual state pages
          </Link>{' '}
          for the controlling statute citation and appeal process
          in each jurisdiction.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Filing in one of these states?
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70">
          Advottic helps you organize evidence, check your
          deadline, and prepare a packet for the hearing.
        </p>
        <div className="pt-2">
          <Link href="/sign-in?next=/cases" className="btn-primary">
            Start your case for free
          </Link>
        </div>
      </section>
    </article>
  );
}
