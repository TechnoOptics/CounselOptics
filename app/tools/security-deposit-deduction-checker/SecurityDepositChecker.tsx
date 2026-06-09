'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DEPOSIT_RULES,
  getDepositRule,
} from '@/lib/security-deposit-rules';

/**
 * Security deposit deduction checker.
 *
 * Tenant inputs: state, deposit amount, monthly rent, claimed
 * deductions. We compute:
 *   - Is the deposit within the state's cap?
 *   - Is the deduction window still open?
 *   - What is the maximum recoverable penalty if the landlord
 *     wrongfully withheld?
 *
 * This is the highest-intent tenant-rights SERP ("can my
 * landlord keep my security deposit") and a frequent gateway
 * to small claims filings.
 */
function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function SecurityDepositChecker() {
  const [stateSlug, setStateSlug] = useState<string>('california');
  const [depositStr, setDepositStr] = useState<string>('2000');
  const [rentStr, setRentStr] = useState<string>('1800');
  const [deductionsStr, setDeductionsStr] = useState<string>('1500');

  const rule = useMemo(
    () => getDepositRule(stateSlug),
    [stateSlug],
  );
  const deposit = Number(depositStr) || 0;
  const rent = Number(rentStr) || 0;
  const deductions = Number(deductionsStr) || 0;
  const refund = Math.max(0, deposit - deductions);

  const depositOverCap =
    rule?.maxMonths != null && rent > 0
      ? deposit > rule.maxMonths * rent
      : false;
  const maxAllowed =
    rule?.maxMonths != null ? rule.maxMonths * rent : null;

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
            {DEPOSIT_RULES.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Monthly rent ($)
          </span>
          <input
            type="number"
            min={0}
            value={rentStr}
            onChange={(e) => setRentStr(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Deposit you paid ($)
          </span>
          <input
            type="number"
            min={0}
            value={depositStr}
            onChange={(e) => setDepositStr(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Amount landlord kept ($)
          </span>
          <input
            type="number"
            min={0}
            value={deductionsStr}
            onChange={(e) => setDeductionsStr(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          />
        </label>
      </div>

      {rule && (
        <div className="rounded-xl ring-1 ring-gold-metal/30 bg-gradient-to-br from-cream-50/60 to-cream-50/20 dark:from-forest-900/60 dark:to-forest-900/20 p-6 sm:p-7 space-y-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
              {rule.name}
            </p>
            <p className="font-display text-[28px] sm:text-[36px] leading-tight text-forest-900 dark:text-cream-100 mt-1">
              {fmtMoney(refund)} owed back
            </p>
            <p className="text-[14px] text-ink-700 dark:text-cream-100/80 mt-1">
              That is the math: deposit {fmtMoney(deposit)} minus
              deductions {fmtMoney(deductions)}.
            </p>
          </div>

          <ul className="text-[13.5px] space-y-2 text-ink-700 dark:text-cream-100/80 border-t border-ink-200/60 dark:border-forest-700/40 pt-3">
            <li>
              <strong>Deposit cap:</strong>{' '}
              {rule.maxMonths === null
                ? 'No statutory cap in this state.'
                : `${rule.maxMonths} month${rule.maxMonths === 1 ? '' : 's'} of rent (${maxAllowed !== null ? fmtMoney(maxAllowed) : '-'} max for your rent).`}{' '}
              {depositOverCap && (
                <span className="text-red-700 dark:text-red-300 font-semibold">
                  Your deposit is over the cap; you may be
                  entitled to the excess back regardless of
                  damages.
                </span>
              )}
            </li>
            <li>
              <strong>Return deadline:</strong> Landlord has{' '}
              {rule.returnDays} days from move-out to return the
              deposit or send an itemized statement of deductions.
            </li>
            <li>
              <strong>Itemized statement:</strong>{' '}
              {rule.itemizedRequired
                ? 'Required if landlord withholds any portion.'
                : 'Not required, but recommended for any deduction.'}
            </li>
            <li>
              <strong>Interest:</strong>{' '}
              {rule.interestRequired
                ? 'Landlord must pay interest on the held deposit.'
                : 'No statutory interest requirement.'}
            </li>
            <li>
              <strong>Penalty for wrongful withholding:</strong>{' '}
              {rule.penalty}
            </li>
            {rule.note && (
              <li className="italic border-l-2 border-gold-metal/40 pl-3">
                {rule.note}
              </li>
            )}
          </ul>

          <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 pt-2 border-t border-ink-200/60 dark:border-forest-700/40">
            Informational only. Local ordinances (NYC, SF,
            Chicago, etc.) and lease terms can change the
            answer. Consult a licensed attorney in {rule.name}{' '}
            before relying on this result.
          </p>
        </div>
      )}

      <div className="text-[13px] text-ink-600 dark:text-cream-100/70 pt-2">
        Next:{' '}
        <Link href="/templates/security-deposit-demand" className="underline">
          send the demand letter
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
