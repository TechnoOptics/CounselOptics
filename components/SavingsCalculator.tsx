'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from '@/components/ExternalLink';
import { FIRM_TIER_PRICING } from '@/lib/firm-pricing';

/**
 * Interactive savings calculator. Lives on /pricing between the
 * consumer and firm tiers. Lets a prospect tick the tools they
 * currently pay for, enter their attorney count, and see the
 * annual delta against Advottic Counsel.
 *
 * Pricing numbers track the per-product comparison pages
 * (/compare/[slug]). When a competitor adjusts pricing, update
 * BOTH the comparison page and this constant.
 *
 * All math is client-side and based on public list pricing. No
 * tracking, no email gate, no "send me the result". Friction is
 * the enemy here; the calculator is purely a demo / SEO surface.
 *
 * Why average (not min) per-user: Stripe / Linear / Notion all
 * cite "typical" pricing in calculators. Using the floor pricing
 * understates savings and reads as misleading once a prospect
 * checks the competitor's site. Using the cap reads as cherry-
 * picked. Averaging mid-tier pricing reflects what a real
 * 5-10-attorney firm actually pays.
 */

type Tool = {
  id: string;
  name: string;
  /** Mid-tier list price per user per month (USD). */
  pricePerUserMonth: number;
  /** Short tagline shown beneath the name. */
  blurb: string;
  /** Internal /compare page for the deep dive. */
  href?: string;
  /** Public pricing page on the competitor's own site. Audit V2-5:
   *  source-stamp the rates so a prospect can verify them. */
  sourceUrl?: string;
};

/**
 * Pricing source-of-truth date. Audit V2-5 (2026-05-12): bake the
 * "Last reviewed" date into the calculator so we can defend the
 * numbers and refresh on a known cadence.
 */
const PRICING_REVIEWED_AT = '2026-05-01';

const TOOLS: Tool[] = [
  {
    id: 'clio',
    name: 'Clio Manage',
    pricePerUserMonth: 129,
    blurb: 'Practice management',
    href: '/compare/clio',
    sourceUrl: 'https://www.clio.com/pricing/',
  },
  {
    id: 'mycase',
    name: 'MyCase',
    pricePerUserMonth: 69,
    blurb: 'Practice management',
    href: '/compare/mycase',
    sourceUrl: 'https://www.mycase.com/pricing/',
  },
  {
    id: 'smokeball',
    name: 'Smokeball',
    pricePerUserMonth: 149,
    blurb: 'Practice management (Windows)',
    href: '/compare/smokeball',
    sourceUrl: 'https://www.smokeball.com/pricing',
  },
  {
    id: 'spellbook',
    name: 'Spellbook',
    pricePerUserMonth: 169,
    blurb: 'Contract review AI',
    href: '/compare/spellbook',
    sourceUrl: 'https://www.spellbook.legal/pricing',
  },
  {
    id: 'cocounsel',
    name: 'Casetext CoCounsel',
    pricePerUserMonth: 280,
    blurb: 'Legal research AI (+ Westlaw)',
    href: '/compare/cocounsel',
    sourceUrl: 'https://casetext.com/pricing/',
  },
  {
    id: 'harvey',
    name: 'Harvey AI',
    pricePerUserMonth: 416,
    blurb: 'Big-law research AI',
    href: '/compare/harvey',
    // Harvey does not publish list pricing; the rate here is the
    // industry-reported figure that has been quoted publicly by
    // partner firms. No public source URL to link.
  },
  {
    id: 'docusign',
    name: 'DocuSign',
    pricePerUserMonth: 45,
    blurb: 'E-signature',
    href: '/compare/docusign',
    sourceUrl: 'https://www.docusign.com/products-and-pricing',
  },
  {
    id: 'lexicata',
    name: 'CRM (Lexicata / Lawmatics)',
    pricePerUserMonth: 79,
    blurb: 'Client intake + CRM',
    sourceUrl: 'https://www.lawmatics.com/pricing/',
  },
];

/** Advottic Counsel tiers, sourced from lib/firm-pricing.ts (also used
 *  by /pricing) rather than a second hand-copied set of the same
 *  numbers. Deliberately caps at Growing Firm - see pickAdvotticTier.
 *  pricePerUserMonth/maxAttorneys are asserted non-null: true for
 *  solo/small_firm/growing_firm by construction (only Enterprise, not
 *  included here, uses `null` for negotiated pricing). */
const ADVOTTIC_TIERS = (['solo', 'small_firm', 'growing_firm'] as const).map((id) => {
  const t = FIRM_TIER_PRICING[id];
  return {
    name: `Counsel ${t.name}`,
    pricePerUserMonth: t.pricePerUserMonth!,
    maxAttorneys: t.maxAttorneys!,
    mattersPerAttorney: t.mattersPerAttorney!,
  };
});

function pickAdvotticTier(attorneys: number) {
  // The wider band wins; an attorney count past the floor of the
  // next tier is treated as that next tier (firms grow into seats).
  // Caps at Growing Firm - Enterprise is negotiated per-seat pricing,
  // not a simple multiplication, so this calculator (and the manual
  // attorney-count input's 500 ceiling) intentionally doesn't model
  // it; a 200-attorney estimate here is a deliberately conservative
  // Growing Firm number, not an Enterprise quote.
  if (attorneys <= FIRM_TIER_PRICING.solo.maxAttorneys!) return ADVOTTIC_TIERS[0];
  if (attorneys <= FIRM_TIER_PRICING.small_firm.maxAttorneys!) return ADVOTTIC_TIERS[1];
  return ADVOTTIC_TIERS[2];
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function SavingsCalculator() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['clio', 'docusign']));
  const [attorneys, setAttorneys] = useState(5);

  const result = useMemo(() => {
    const currentPerUserMonth = TOOLS.filter((t) => selected.has(t.id)).reduce(
      (sum, t) => sum + t.pricePerUserMonth,
      0,
    );
    const currentAnnual = currentPerUserMonth * 12 * attorneys;
    const tier = pickAdvotticTier(attorneys);
    const advotticAnnual = tier.pricePerUserMonth * 12 * attorneys;
    const savings = Math.max(0, currentAnnual - advotticAnnual);
    const pct = currentAnnual > 0 ? Math.round((savings / currentAnnual) * 100) : 0;
    return {
      currentPerUserMonth,
      currentAnnual,
      advotticAnnual,
      advotticTier: tier,
      savings,
      pct,
    };
  }, [selected, attorneys]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label="Savings calculator"
      className="rounded-2xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 p-6 sm:p-8 space-y-6"
    >
      <header className="space-y-2">
        <p className="eyebrow">Savings calculator</p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          What does Advottic save your firm?
        </h2>
        <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-prose">
          Tick the tools you currently pay for, enter your attorney count, see
          the annual delta. Mid-tier list pricing; your real bill may differ.
        </p>
      </header>

      <div className="space-y-3">
        <p className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
          Tools you currently use
        </p>
        <ul className="grid sm:grid-cols-2 gap-2">
          {TOOLS.map((t) => {
            const on = selected.has(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  className={`w-full text-left rounded-lg p-3 ring-1 transition-colors ${
                    on
                      ? 'ring-2 ring-gold-metal bg-amber-50/40 dark:ring-amber-500/60 dark:bg-amber-950/15'
                      : 'ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 hover:ring-ink-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-forest-900 dark:text-cream-100 text-[13.5px]">
                      {t.name}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-ink-600 dark:text-cream-100/65">
                      {USD.format(t.pricePerUserMonth)}/seat/mo
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-snug mt-0.5">
                    {t.blurb}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="attorney-count"
          className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55 block"
        >
          Number of attorneys
        </label>
        <div className="flex items-center gap-3">
          <input
            id="attorney-count"
            type="range"
            min={1}
            max={50}
            value={attorneys}
            onChange={(e) => setAttorneys(Number(e.target.value))}
            className="flex-1 accent-gold-metal"
            aria-valuemin={1}
            aria-valuemax={50}
            aria-valuenow={attorneys}
          />
          <input
            type="number"
            min={1}
            max={500}
            value={attorneys}
            onChange={(e) =>
              setAttorneys(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
            }
            className="input w-20 text-center tabular-nums"
            aria-label="Number of attorneys (manual entry)"
          />
        </div>
      </div>

      <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 sm:p-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
              Current annual spend
            </p>
            <p className="font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100 mt-1">
              {USD.format(result.currentAnnual)}
            </p>
            <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5">
              {selected.size} tool{selected.size === 1 ? '' : 's'} × {attorneys}{' '}
              attorney{attorneys === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
              Advottic annual cost
            </p>
            <p className="font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100 mt-1">
              {USD.format(result.advotticAnnual)}
            </p>
            <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5">
              {result.advotticTier.name} ·{' '}
              {USD.format(result.advotticTier.pricePerUserMonth)}/seat/mo
            </p>
            <p className="text-[11px] text-ink-500 dark:text-cream-100/70 mt-0.5">
              Includes {result.advotticTier.mattersPerAttorney} matters /
              attorney. Extras metered in Bella tokens.
            </p>
          </div>
          <div>
            <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-gold-700 dark:text-amber-300">
              You save
            </p>
            <p className="font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100 mt-1">
              {USD.format(result.savings)}
            </p>
            <p className="text-[11.5px] text-emerald-700 dark:text-emerald-300 mt-0.5">
              {result.pct}% less per year
            </p>
          </div>
        </div>
        {result.currentAnnual === 0 && (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-3">
            Tick at least one tool above to see the comparison.
          </p>
        )}
        {selected.size > 0 && result.savings === 0 && (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-3">
            At your scale and tool mix, Advottic isn&rsquo;t cheaper. Check
            the comparison pages below to see where each tool wins.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          href="/sign-in?next=/counsel/onboarding"
          className="btn-primary"
        >
          Start a 7-day free trial
        </Link>
        <Link href="/compare" className="btn-secondary">
          See feature comparisons
        </Link>
      </div>

      {/* Source-citation footer (audit V2-5). Lists every per-seat
          rate above next to the public pricing URL we sourced it
          from, plus the review date. Harvey does not publish list
          pricing so we mark it as industry-reported. Refresh quarterly. */}
      <div className="space-y-2">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          Per-seat list prices last reviewed{' '}
          <span className="font-medium">{PRICING_REVIEWED_AT}</span> from
          each vendor&rsquo;s public pricing page; we refresh quarterly.
          Negotiated annual contracts often differ. Advottic firm tiers
          described above do not change with the calculator.
        </p>
        <details className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          <summary className="cursor-pointer underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100">
            Show sources for each rate
          </summary>
          <ul className="mt-2 space-y-1 pl-1">
            {TOOLS.map((t) => (
              <li key={t.id} className="font-mono tabular-nums">
                <span className="font-sans">{t.name}</span>{' '}
                {USD.format(t.pricePerUserMonth)}/seat/mo &mdash;{' '}
                {t.sourceUrl ? (
                  <ExternalLink
                    href={t.sourceUrl}
                    className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100 break-all"
                  >
                    {t.sourceUrl.replace(/^https?:\/\//, '')}
                  </ExternalLink>
                ) : (
                  <span className="italic">
                    industry-reported (vendor does not publish list pricing)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
