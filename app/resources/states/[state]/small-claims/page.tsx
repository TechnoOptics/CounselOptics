import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  STATES_SMALL_CLAIMS,
  SMALL_CLAIMS_REVIEWED_AT,
  type StateSmallClaims,
} from '@/lib/state-small-claims';
import { BreadcrumbJsonLd, LegalServiceStateJsonLd } from '@/components/seo/JsonLd';

/**
 * Programmatic per-state small-claims page. One route, 50 pages
 * (one per state) auto-generated from lib/state-small-claims.ts.
 *
 * Targets "small claims court [state]" searches - high-volume,
 * commercial-intent traffic from people about to file. Each page:
 *
 *   - H1 hits "Small Claims Court in [State]"
 *   - Surfaces the dollar limit, filing fee, and controlling statute
 *     (Google's featured-snippet bait for "what is the small claims
 *     limit in [state]")
 *   - Links back to the cornerstone article /resources/small-claims-court-process
 *   - Drives signups via the Bella case-builder CTA
 *
 * Why programmatic: 50 hand-crafted state pages would take 20 hours;
 * one data file and one component renders them in 30 minutes and
 * stays in sync when a state changes its limit.
 */

type Props = { params: { state: string } };

export const dynamicParams = false;
export function generateStaticParams() {
  return STATES_SMALL_CLAIMS.map((s) => ({ state: s.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const s = STATES_SMALL_CLAIMS.find((x) => x.slug === params.state);
  if (!s) return { title: 'Not found' };
  const title = `Small Claims Court in ${s.name}: Limit, Forms, Process (${new Date().getFullYear()})`;
  const description = `${s.name} small claims court: $${s.monetaryLimit.toLocaleString()} jurisdictional limit, ${s.filingFee} filing fee, attorneys ${s.attorneysAllowed.toLowerCase()}. Statute ${s.statute}. Reviewed ${SMALL_CLAIMS_REVIEWED_AT}.`;
  return {
    title,
    description,
    keywords: [
      `small claims court ${s.name.toLowerCase()}`,
      `${s.name.toLowerCase()} small claims limit`,
      `${s.name.toLowerCase()} small claims process`,
      `how to sue someone in ${s.name.toLowerCase()}`,
    ],
    alternates: { canonical: `/resources/states/${s.slug}/small-claims` },
    openGraph: {
      title,
      description,
      type: 'article',
      url: `/resources/states/${s.slug}/small-claims`,
      modifiedTime: SMALL_CLAIMS_REVIEWED_AT,
    },
  };
}

export default function StateSmallClaimsPage({ params }: Props) {
  const s = STATES_SMALL_CLAIMS.find((x) => x.slug === params.state);
  if (!s) notFound();

  const reviewed = new Date(SMALL_CLAIMS_REVIEWED_AT).toLocaleDateString(
    'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  // Three "neighbor" states for the cross-link strip at the bottom -
  // pick by index proximity in the data file (rough geographic
  // proximity since the data is alphabetical). This builds the
  // internal-link graph that Google rewards.
  const neighbors = neighborsFor(s);

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 space-y-12 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Resources', href: '/resources' },
          { name: 'States', href: '/resources/states' },
          { name: s.name, href: `/resources/states/${s.slug}/small-claims` },
        ]}
      />
      {/* LegalService schema with state-scoped areaServed - drives the
          local SERP for "small claims [state]" queries and qualifies
          the page for Google's Knowledge Panel for jurisdiction-aware
          legal information. */}
      <LegalServiceStateJsonLd
        stateName={s.name}
        stateSlug={s.slug}
        filingFeeRange={s.filingFee}
        monetaryCap={s.monetaryLimit.toLocaleString()}
      />

      <nav
        aria-label="Breadcrumb"
        className="text-[12px] font-mono tracking-tight text-ink-500 dark:text-cream-100/55 pt-2"
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-forest-700 dark:hover:text-cream-100">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/resources" className="hover:text-forest-700 dark:hover:text-cream-100">
              Resources
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              href="/resources/states"
              className="hover:text-forest-700 dark:hover:text-cream-100"
            >
              States
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="text-ink-700 dark:text-cream-100/85">
            {s.name} small claims
          </li>
        </ol>
      </nav>

      <header className="space-y-4">
        <p className="eyebrow">{s.name} ({s.abbr})</p>
        <h1 className="font-display text-[34px] sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.1] text-forest-900 dark:text-cream-100">
          Small Claims Court in {s.name}
        </h1>
        <p className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
          Reviewed {reviewed}
        </p>
        <p className="text-base sm:text-[17px] text-ink-600 dark:text-cream-100/80 leading-relaxed">
          Suing for under ${s.monetaryLimit.toLocaleString()} in {s.name}? You
          do not need a lawyer. This page covers the rules, the filing fee,
          the forms, and what to bring on hearing day - written for people
          who have never been to court.
        </p>
      </header>

      {/* The featured-snippet anchor: facts in a table */}
      <section className="rounded-2xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-6 sm:p-8">
        <h2 className="font-display text-[22px] font-medium text-forest-900 dark:text-cream-100 mb-5">
          {s.name} small claims at a glance
        </h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fact
            label="Jurisdictional limit"
            value={`$${s.monetaryLimit.toLocaleString()}`}
          />
          <Fact label="Filing fee" value={s.filingFee} />
          <Fact label="Court name" value={s.courtName} />
          <Fact label="Controlling statute" value={s.statute} />
          <Fact label="Attorneys permitted" value={s.attorneysAllowed} />
          <Fact
            label="Appeal window"
            value={s.appealWindowDays === 0 ? 'No appeals' : `${s.appealWindowDays} days`}
          />
        </dl>
        {s.notes && (
          <p className="mt-5 pt-4 border-t border-ink-100 dark:border-forest-700/40 text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
            <strong className="font-medium text-forest-900 dark:text-cream-100">
              Note:
            </strong>{' '}
            {s.notes}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-[24px] sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          The 5-step process in {s.name}
        </h2>
        <ol className="space-y-3 text-[15.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7] list-decimal pl-6">
          <li>
            <strong>Send a demand letter.</strong> Many {s.name} courts
            expect proof of a pre-suit demand attempt. See our{' '}
            <Link href="/resources/how-to-write-a-demand-letter" className="underline">
              demand letter guide
            </Link>{' '}
            for a template.
          </li>
          <li>
            <strong>File the complaint.</strong> Pay the {s.filingFee}{' '}
            filing fee at the {s.courtName.toLowerCase()}. The clerk
            assigns a case number and a hearing date.
          </li>
          <li>
            <strong>Serve the defendant.</strong> {s.name} typically
            requires sheriff service, process server, or certified mail
            with return receipt. Personal service by the plaintiff is
            usually not allowed.
          </li>
          <li>
            <strong>Prepare for the hearing.</strong> Bring three copies
            of every document, a one-page chronology, the demand letter
            with proof of service, and an itemized damages calculation.
            {s.attorneysAllowed === 'No' && (
              <>
                {' '}
                Note: {s.attorneysNote.toLowerCase()}
              </>
            )}
          </li>
          <li>
            <strong>Collect after you win.</strong> A judgment is a piece
            of paper. Collection in {s.name} happens via wage
            garnishment, bank levy, or property lien - a separate process
            that can take 3-12 months.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[24px] sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Attorneys in {s.name} small claims
        </h2>
        <p className="text-[15.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          {s.attorneysNote}
        </p>
        {s.attorneysAllowed === 'No' && (
          <p className="text-[14px] text-ink-600 dark:text-cream-100/75 leading-relaxed">
            Most small-claims plaintiffs represent themselves. The whole
            point of the system is that ordinary people can use it. If
            your claim is more complex than the {s.courtName.toLowerCase()}
            can handle, you can file in {s.name}&rsquo;s regular civil
            court instead - but you give up the speed and low cost.
          </p>
        )}
      </section>

      <aside className="rounded-xl ring-2 ring-gold-metal/60 dark:ring-amber-500/40 bg-gradient-to-b from-amber-50/40 to-transparent dark:from-amber-950/20 p-6 sm:p-8 space-y-4">
        <p className="eyebrow">Ready to file?</p>
        <p className="font-display text-xl sm:text-2xl text-forest-900 dark:text-cream-100 leading-tight">
          Build your {s.name} small-claims case file in 15 minutes.
        </p>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/75 leading-relaxed">
          Drag in receipts and photos. Write a 3-sentence narrative.
          Bella generates the demand letter, chronology, itemized
          damages, and exhibit binder - formatted for {s.name} courts.
          Free for the first case.
        </p>
        <Link href="/sign-in?next=/cases/new" className="btn-primary inline-flex">
          Build your case with Bella
        </Link>
      </aside>

      <section className="space-y-5 pt-6 border-t border-ink-200 dark:border-forest-700/40">
        <h2 className="font-display text-[20px] font-medium text-forest-900 dark:text-cream-100">
          Related guides
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          <li>
            <Link
              href="/resources/small-claims-court-process"
              className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4 hover:-translate-y-0.5 hover:shadow-sm transition-all"
            >
              <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                Cornerstone guide
              </p>
              <p className="mt-1 font-medium text-forest-900 dark:text-cream-100 text-[14.5px]">
                Small claims court: full how-to-sue guide
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/resources/how-to-write-a-demand-letter"
              className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4 hover:-translate-y-0.5 hover:shadow-sm transition-all"
            >
              <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                Template
              </p>
              <p className="mt-1 font-medium text-forest-900 dark:text-cream-100 text-[14.5px]">
                How to write a demand letter
              </p>
            </Link>
          </li>
        </ul>
      </section>

      <section className="space-y-5">
        <h2 className="font-display text-[20px] font-medium text-forest-900 dark:text-cream-100">
          Other states
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {neighbors.map((n) => (
            <li key={n.slug}>
              <Link
                href={`/resources/states/${n.slug}/small-claims`}
                className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/40 p-4 hover:-translate-y-0.5 hover:shadow-sm transition-all"
              >
                <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                  {n.abbr} &middot; ${n.monetaryLimit.toLocaleString()} limit
                </p>
                <p className="mt-1 font-medium text-forest-900 dark:text-cream-100 text-[14.5px]">
                  {n.name} small claims
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[13px] pt-2">
          <Link
            href="/resources/states"
            className="text-forest-700 dark:text-cream-100/80 underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            See all 50 states &rarr;
          </Link>
        </p>
      </section>

      <footer className="pt-6 border-t border-ink-200 dark:border-forest-700/40 text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        <p>
          {s.name} court rules change. Verify the current jurisdictional
          limit and filing fee on your local court&rsquo;s website before
          filing. Reviewed {reviewed}. This page is information, not
          legal advice; consult a local attorney for questions specific
          to your matter.
        </p>
      </footer>
    </article>
  );
}

/** Render a single fact row in the at-a-glance grid. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
        {label}
      </dt>
      <dd className="text-[14.5px] text-forest-900 dark:text-cream-100 leading-snug">
        {value}
      </dd>
    </div>
  );
}

/**
 * Three "neighbor" states for the bottom cross-link strip. Pick the
 * two before and one after this state in the alphabetical list. Cheap
 * and good enough; gives Google a rich internal link graph.
 */
function neighborsFor(s: StateSmallClaims): StateSmallClaims[] {
  const idx = STATES_SMALL_CLAIMS.findIndex((x) => x.slug === s.slug);
  const total = STATES_SMALL_CLAIMS.length;
  const prev1 = STATES_SMALL_CLAIMS[(idx - 1 + total) % total];
  const prev2 = STATES_SMALL_CLAIMS[(idx - 2 + total) % total];
  const next1 = STATES_SMALL_CLAIMS[(idx + 1) % total];
  return [prev2, prev1, next1];
}
