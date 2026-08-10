import Link from 'next/link';
import { STATES_SMALL_CLAIMS } from '@/lib/state-small-claims';
import { BreadcrumbJsonLd, ItemListJsonLd } from '@/components/seo/JsonLd';
import { formatNumber } from '@/lib/format';

export const metadata = {
  title: 'Small claims court by state - limits, fees, and process',
  description:
    'State-by-state breakdown of small claims court: monetary limits, filing fees, controlling statutes, and process. All 50 states + DC, reviewed annually.',
  alternates: { canonical: '/resources/states' },
};

/**
 * Index page listing all 50 state small-claims pages. The hub is the
 * crawl-discovery anchor for the programmatic /resources/states/[state]
 * routes - without it, Google has to find every state via the sitemap
 * alone, which is slower.
 */
export default function StatesHubPage() {
  return (
    <div className="space-y-12 sm:space-y-16 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Resources', href: '/resources' },
          { name: 'States', href: '/resources/states' },
        ]}
      />
      {/* ItemList tells Google this hub is a curated list of all 50 state
          guides, which unlocks the carousel SERP treatment for
          navigational "small claims by state" queries. */}
      <ItemListJsonLd
        listName="Small claims court by state"
        items={STATES_SMALL_CLAIMS.map((s) => ({
          name: `${s.name} small claims`,
          href: `/resources/states/${s.slug}/small-claims`,
        }))}
      />
      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">By state</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Small claims court in your state.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          The jurisdictional limit, the filing fee, the governing statute,
          and the appeal window for every U.S. state. Reviewed annually.
        </p>
        <p className="text-[13.5px]">
          <Link
            href="/resources/small-claims-rankings"
            className="underline underline-offset-2 text-forest-900 dark:text-cream-100 font-medium"
          >
            See all 50 states ranked side by side &rarr;
          </Link>
        </p>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 text-[14px]">
          {STATES_SMALL_CLAIMS.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/resources/states/${s.slug}/small-claims`}
                className="flex items-baseline justify-between rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-3 hover:bg-cream-50/60 dark:hover:bg-forest-900/60 transition-colors"
              >
                <span className="font-medium text-forest-900 dark:text-cream-100">
                  {s.name}
                </span>
                <span className="text-[12px] font-mono text-ink-500 dark:text-cream-100/55 tabular-nums">
                  ${formatNumber(s.monetaryLimit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          More topics coming
        </h2>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          State-by-state guides for eviction rules, statute of limitations,
          and IOLTA trust accounting requirements ship throughout 2026.
        </p>
        <div className="pt-3">
          <Link href="/resources" className="btn-secondary">
            All resources
          </Link>
        </div>
      </section>
    </div>
  );
}
