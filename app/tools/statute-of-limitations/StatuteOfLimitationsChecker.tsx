'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CLAIM_TYPES,
  STATES_SOL,
  formatYears,
  getState,
  getClaimType,
} from '@/lib/statute-of-limitations';

/**
 * Interactive picker. Pick a state and a claim type, get the
 * statute of limitations in plain English with the relevant
 * caveat (discovery rule, statute of repose, etc.).
 *
 * Client-only so the URL stays clean; we don't want every
 * combination crawled as a separate page (that would split
 * PageRank across 459 thin pages instead of concentrating it
 * on this one tool).
 */
export function StatuteOfLimitationsChecker() {
  const [stateSlug, setStateSlug] = useState<string>('california');
  const [claimId, setClaimId] = useState<string>('personal-injury');

  const state = useMemo(() => getState(stateSlug), [stateSlug]);
  const claim = useMemo(() => getClaimType(claimId), [claimId]);
  const limit = state?.limits[claim?.id ?? 'personal-injury'];

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Your state
          </span>
          <select
            value={stateSlug}
            onChange={(e) => setStateSlug(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          >
            {STATES_SOL.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Type of claim
          </span>
          <select
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          >
            {CLAIM_TYPES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state && claim && limit && (
        <div className="rounded-xl ring-1 ring-gold-metal/30 bg-gradient-to-br from-cream-50/60 to-cream-50/20 dark:from-forest-900/60 dark:to-forest-900/20 p-6 sm:p-7 space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
            Statute of limitations
          </p>
          <p className="font-display text-[36px] sm:text-[44px] leading-none text-forest-900 dark:text-cream-100">
            {formatYears(limit.years)}
          </p>
          <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
            {claim.label} claims in {state.name} must generally be
            filed within {formatYears(limit.years)} of when the
            harm occurred.
          </p>
          {limit.note && (
            <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 italic border-l-2 border-gold-metal/40 pl-3">
              {limit.note}
            </p>
          )}
          <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 pt-2 border-t border-ink-200/60 dark:border-forest-700/40">
            Informational only. Statutes change, exceptions apply,
            and your specific facts may toll or shorten the clock.
            Consult a licensed attorney in {state.name} before
            relying on this number.
          </p>
        </div>
      )}

      {claim && (
        <details className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-4">
          <summary className="cursor-pointer text-[14px] font-medium text-forest-900 dark:text-cream-100">
            What counts as a {claim.label.toLowerCase()} claim?
          </summary>
          <p className="mt-3 text-[13.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
            {claim.description}
          </p>
        </details>
      )}

      <div className="text-[13px] text-ink-600 dark:text-cream-100/70 pt-2">
        Next:{' '}
        <Link href="/templates" className="underline">
          start a demand letter
        </Link>{' '}
        or{' '}
        <Link href="/sign-in?next=/cases/new" className="underline">
          open a case file in Advottic
        </Link>
        .
      </div>
    </section>
  );
}
