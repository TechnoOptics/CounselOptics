'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTrustReconciliationAction } from '@/lib/trust-accounting';
import type { UnreconciledEntry } from '@/lib/trust-accounting-queries';
import { T, useT } from '@/components/i18n/LocaleProvider';

const KIND_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  earned_fee_transfer: 'Earned-fee transfer',
  disbursement: 'Disbursement',
  refund: 'Refund',
  bank_fee: 'Bank fee',
  interest: 'Interest',
  correction: 'Correction',
};

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

/**
 * Bank-statement reconciliation. The operator enters the statement's
 * ending balance and date, then checks off the transactions that have
 * cleared the bank. The running "cleared" total (prior reconciliations
 * plus the newly-checked items) is compared live to the bank balance;
 * it reconciles when the difference is zero. Book balance and the
 * outstanding (uncleared) amount are shown for context.
 */
export function ReconcileForm({
  firmId,
  accountId,
  reconciledBaseCents,
  bookBalanceCents,
  unreconciled,
}: {
  firmId: string;
  accountId: string;
  reconciledBaseCents: number;
  bookBalanceCents: number;
  unreconciled: UnreconciledEntry[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bankStr, setBankStr] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const bankCents = useMemo(() => {
    const clean = bankStr.replace(/[^0-9.\-]/g, '');
    if (clean === '' || clean === '-') return null;
    const n = Number(clean);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }, [bankStr]);

  const checkedTotal = useMemo(() => {
    let sum = 0;
    for (const e of unreconciled) if (checked.has(e.id)) sum += e.signedCents;
    return sum;
  }, [checked, unreconciled]);

  const clearedTotal = reconciledBaseCents + checkedTotal;
  const outstanding = bookBalanceCents - clearedTotal;
  const difference = bankCents === null ? null : bankCents - clearedTotal;
  const balanced = difference === 0;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setChecked(new Set(unreconciled.map((e) => e.id)));
  }
  function clearAll() {
    setChecked(new Set());
  }

  function submit() {
    setError(null);
    if (!statementDate) {
      setError(t('Pick the statement date.'));
      return;
    }
    if (bankCents === null) {
      setError(t('Enter the bank statement ending balance.'));
      return;
    }
    startTransition(async () => {
      const res = await createTrustReconciliationAction(firmId, accountId, {
        statementDate,
        bankBalanceCents: bankCents,
        transactionIds: [...checked],
        note: note.trim() || null,
      });
      if (res.ok) {
        setBankStr('');
        setStatementDate('');
        setNote('');
        setChecked(new Set());
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the reconciliation.'));
      }
    });
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <p className="eyebrow"><T>Reconcile against your bank statement</T></p>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed max-w-2xl">
          <T>Enter the statement&rsquo;s ending balance and check off the
          transactions that have cleared the bank. It reconciles when the
          cleared total equals the bank balance. Anything left unchecked is
          an outstanding item that hasn&rsquo;t hit the statement yet.</T>
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Bank statement ending balance</T>
          </span>
          <input
            inputMode="decimal"
            value={bankStr}
            onChange={(e) => setBankStr(e.target.value)}
            placeholder="12500.00"
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Statement date</T>
          </span>
          <input
            type="date"
            value={statementDate}
            onChange={(e) => setStatementDate(e.target.value)}
            className="input"
          />
        </label>
      </div>

      {/* Live summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden ring-1 ring-ink-200 dark:ring-forest-700/40 bg-ink-200 dark:bg-forest-700/40">
        <SummaryCell label={t('Bank balance')} value={bankCents === null ? '—' : fmtCents(bankCents)} />
        <SummaryCell label={t('Cleared total')} value={fmtCents(clearedTotal)} />
        <SummaryCell label={t('Outstanding')} value={fmtCents(outstanding)} muted />
        <SummaryCell
          label={t('Difference')}
          value={difference === null ? '—' : fmtCents(difference)}
          tone={difference === null ? undefined : balanced ? 'good' : 'bad'}
        />
      </div>

      {bankCents !== null && (
        <p
          className={`text-[13px] font-medium ${
            balanced
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-amber-700 dark:text-amber-300'
          }`}
        >
          {balanced
            ? t('Balanced — the cleared total matches the bank statement.')
            : `Off by ${fmtCents(Math.abs(difference ?? 0))}. Check off the transactions that have cleared, or investigate the gap before saving.`}
        </p>
      )}

      {/* Transaction checklist */}
      {unreconciled.length === 0 ? (
        <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          <T>Every recorded transaction is already reconciled. Enter the bank
          balance to confirm it still matches.</T>
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 font-semibold">
              <T>Not yet cleared</T> ({unreconciled.length})
            </p>
            <div className="flex items-center gap-1.5 text-[12px]">
              <button
                type="button"
                onClick={selectAll}
                className="inline-flex items-center min-h-[32px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
              >
                <T>Select all</T>
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center min-h-[32px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
              >
                <T>Clear</T>
              </button>
            </div>
          </div>
          <ul className="divide-y divide-ink-100 dark:divide-forest-700/40 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 overflow-hidden">
            {unreconciled.map((e) => {
              const on = checked.has(e.id);
              return (
                <li key={e.id}>
                  <label
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      on
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                        : 'hover:bg-cream-50/60 dark:hover:bg-forest-800/20'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 flex-none accent-emerald-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-forest-900 dark:text-cream-100 truncate">
                        {e.clientLabel}
                      </span>
                      <span className="block text-[11px] text-ink-500 dark:text-cream-100/55">
                        {KIND_LABEL[e.kind] ?? e.kind}
                        {e.description ? ` · ${e.description}` : ''} ·{' '}
                        {new Date(e.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-mono tabular-nums text-[13px] ${
                        e.signedCents < 0
                          ? 'text-rose-700 dark:text-rose-300'
                          : 'text-forest-900 dark:text-cream-100'
                      }`}
                    >
                      {fmtCents(e.signedCents)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          <T>Note (optional)</T>
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('March 2026 statement; deposit in transit clears 4/2')}
          className="input"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">
          <T>Saving records this reconciliation and marks the checked items
          cleared. Cleared items can&rsquo;t be unmarked.</T>
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-primary shrink-0 disabled:opacity-50"
        >
          {pending ? t('Saving…') : t('Save reconciliation')}
        </button>
      </div>
    </section>
  );
}

function SummaryCell({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
  muted?: boolean;
}) {
  const valueClass =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'bad'
        ? 'text-amber-700 dark:text-amber-300'
        : muted
          ? 'text-ink-600 dark:text-cream-100/60'
          : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="bg-cream-50/60 dark:bg-forest-900/50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/55">
        {label}
      </p>
      <p className={`mt-0.5 font-mono tabular-nums text-[14px] font-semibold ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}
