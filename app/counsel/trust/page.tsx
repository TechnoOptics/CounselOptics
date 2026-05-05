import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { reconcileTrustAccount, listTrustTransactions } from '@/lib/trust-accounting';
import { CreateAccountForm } from './create-account-form';
import { RecordTransactionForm } from './record-transaction-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trust accounting · Counsel · Advottic' };

const KIND_TONE: Record<string, string> = {
  deposit:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  earned_fee_transfer:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  disbursement:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  refund:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  bank_fee:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  interest:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  correction:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
};

const POSITIVE = new Set(['deposit', 'refund', 'interest']);

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export default async function CounselTrustPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();

  const { data: accountsRaw } = await supabase
    .from('firm_trust_accounts')
    .select('id, name, bank_name, state, is_iolta, account_number_masked')
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: true });
  const accounts = (accountsRaw ?? []) as Array<{
    id: string;
    name: string;
    bank_name: string | null;
    state: string;
    is_iolta: boolean;
    account_number_masked: string | null;
  }>;

  if (accounts.length === 0) {
    return (
      <div className="space-y-6 animate-fade-up">
        <header>
          <p className="eyebrow mb-1">Counsel · trust</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Trust accounting
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            IOLTA-style ledger of every dollar held for a client. Every state
            bar requires per-matter ledgers, three-way reconciliation against
            the bank statement, and monthly statements per client. Add your
            first trust account below to start.
          </p>
        </header>
        <CreateAccountForm firmId={ctx.firm.id} />
      </div>
    );
  }

  // Pick the first account for the dashboard view (most firms have one).
  const account = accounts[0];
  const recon = await reconcileTrustAccount(ctx.firm.id, account.id);
  const transactions = await listTrustTransactions(ctx.firm.id);

  return (
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Counsel · trust</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {account.name}
          </h1>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
            {account.bank_name ?? 'Bank not set'} ·{' '}
            {account.is_iolta ? 'IOLTA' : 'Trust'} · {account.state}
            {account.account_number_masked && ` · ${account.account_number_masked}`}
          </p>
        </div>
        {accounts.length > 1 && (
          <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">
            {accounts.length - 1} additional account
            {accounts.length === 2 ? '' : 's'} - add UI for multiple accounts
            in a follow-up.
          </p>
        )}
      </header>

      {/* Three-way reconciliation summary */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Book balance"
          value={fmtCents(recon.bookBalanceCents)}
          tone={recon.bookBalanceCents >= 0 ? 'emerald' : 'rose'}
        />
        <Stat
          label="Reconciled balance"
          value={fmtCents(recon.reconciledBalanceCents)}
          tone={
            recon.reconciledBalanceCents === recon.bookBalanceCents
              ? 'emerald'
              : 'amber'
          }
          sub={
            recon.unreconciledCount > 0
              ? `${recon.unreconciledCount} entries unreconciled`
              : 'all entries reconciled'
          }
        />
        <Stat
          label="Clients with funds"
          value={String(
            recon.perClient.filter((c) => c.balanceCents > 0).length,
          )}
          tone="gray"
        />
      </section>

      {/* Per-client breakdown */}
      {recon.perClient.length > 0 && (
        <section className="card p-5 space-y-3">
          <p className="eyebrow">Per-client balances</p>
          <ul className="space-y-1.5 text-[13px]">
            {recon.perClient
              .filter((c) => c.balanceCents !== 0)
              .sort((a, b) => b.balanceCents - a.balanceCents)
              .map((c) => (
                <li
                  key={c.clientLabel}
                  className="flex items-center justify-between"
                >
                  <span className="text-forest-900 dark:text-cream-100">
                    {c.clientLabel}
                  </span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      c.balanceCents < 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-forest-900 dark:text-cream-100'
                    }`}
                  >
                    {fmtCents(c.balanceCents)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
            Negative balances mean the firm has disbursed more than was on
            deposit for that client. This must NEVER happen on an IOLTA
            account; investigate immediately.
          </p>
        </section>
      )}

      {/* Record a new transaction */}
      <RecordTransactionForm firmId={ctx.firm.id} accountId={account.id} />

      {/* Transactions ledger */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Ledger
        </h2>
        {transactions.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No transactions yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {transactions.slice(0, 100).map((t) => {
              const isPositive = POSITIVE.has(t.kind);
              return (
                <li
                  key={t.id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                        {t.clientLabel}
                      </p>
                      <span
                        className={`inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${
                          KIND_TONE[t.kind] ?? KIND_TONE.correction
                        }`}
                      >
                        {t.kind.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {t.description && (
                      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-0.5 truncate">
                        {t.description}
                      </p>
                    )}
                    <p className="text-[10.5px] text-ink-400 dark:text-cream-100/45 mt-0.5 font-mono tabular-nums">
                      {new Date(t.createdAt).toLocaleString()}
                      {t.reference && ` · ref ${t.reference}`}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 font-mono tabular-nums font-semibold ${
                      isPositive
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {isPositive ? '+' : '-'}
                    {fmtCents(t.amountCents)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: 'gray' | 'amber' | 'emerald' | 'rose';
  sub?: string;
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-300'
        : tone === 'rose'
          ? 'text-rose-700 dark:text-rose-300'
          : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2">{label}</p>
      <p className={`font-display text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1.5">
          {sub}
        </p>
      )}
    </div>
  );
}
