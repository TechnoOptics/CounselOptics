import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { FIRM_MANAGE_ROLES } from '@/lib/firm-authz';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  reconcileTrustAccount,
  listTrustTransactions,
  getReconciliationWorkspace,
  listTrustReconciliations,
} from '@/lib/trust-accounting-queries';
import { CreateAccountForm } from './create-account-form';
import { RecordTransactionForm } from './record-transaction-form';
import { ReconcileForm } from './reconcile-form';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  PanelCard,
  ViewStrip,
  relativeTime,
  type ViewOption,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
// Audit W20 V3 CR-27: title template applies once at layout level.
export const metadata = { title: 'Trust accounting · Counsel' };

/**
 * One hex per ledger entry kind. Money in reads good, money out reads
 * flagged, a fee transfer reads as something to watch, and a correction is
 * neutral bookkeeping. StatusPill derives the fill and border from the hex.
 */
const KIND_COLOR: Record<string, string> = {
  deposit: PILL_COLORS.good,
  earned_fee_transfer: PILL_COLORS.waiting,
  disbursement: PILL_COLORS.flagged,
  refund: PILL_COLORS.info,
  bank_fee: PILL_COLORS.flagged,
  interest: PILL_COLORS.good,
  correction: PILL_COLORS.neutral,
};

const POSITIVE = new Set(['deposit', 'refund', 'interest']);

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export default async function CounselTrustPage({
  searchParams,
}: {
  searchParams?: { account?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if ((await getFirmSurfaceSettings(ctx.firm.id)).hideTimeBilling) {
    redirect('/counsel');
  }
  const supabase = createServerSupabase();
  // FIRM_MANAGE_ROLES is owner/admin/attorney, exactly the role list in the
  // firm_trust_accounts RLS policy. Shared so the gate cannot drift from the
  // policy on its own. The database stays the authority; this only avoids
  // offering a write that would always be refused.
  const canManageAccounts = (FIRM_MANAGE_ROLES as readonly string[]).includes(
    ctx.membership.role,
  );

  const { data: accountsRaw, error: accountsError } = await supabase
    .from('firm_trust_accounts')
    .select('id, name, bank_name, state, is_iolta, account_number_masked')
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: true });
  // A failed read must never render as "you have no trust accounts". On a
  // money page an empty list and a broken query look identical, and the wrong
  // one invites a firm to create a duplicate account for funds it already
  // holds.
  if (accountsError) {
    // Raw Postgres text goes to the runtime log for operators, never into the
    // thrown message: that message is echoed to the crash reporter and is
    // visible in development.
    console.error('[trust] accounts read failed:', accountsError.message);
    throw new Error('Trust accounts could not be loaded.');
  }
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
        {/*
          Audit W20 V3 CR-8: the old copy implied three-way reconciliation
          "against the bank statement" - which read as automated bank-feed
          integration. The form only collects account label, bank, last-4,
          and state; the actual reconciliation today is between the matter
          ledger, the firm general ledger, and a bank statement the operator
          uploads monthly. Aligning the copy to what the flow actually does
          keeps the promise honest. The Plaid live-feed path is on the
          roadmap and will replace the upload step when it ships.
        */}
        <PageHeader
          eyebrow={<T>Counsel · trust</T>}
          title={<T>Trust accounting</T>}
          subtitle={
            <T>
              IOLTA-style ledger of every dollar held for a client. Every state
              bar requires per-matter ledgers, per-client statements, and a
              regular reconciliation against your bank statement. Advottic keeps
              the book side - per-matter and per-client balances - and gives you
              a reconciliation tool: enter your statement&rsquo;s ending balance,
              check off what has cleared, and it confirms the two agree. Add your
              first trust account below to start.
            </T>
          }
        />
        {canManageAccounts ? (
          <CreateAccountForm firmId={ctx.firm.id} />
        ) : (
          /*
            Only an owner, admin, or attorney may read or create rows in
            firm_trust_accounts (the firm_trust_accounts_member policy covers
            ALL commands). A paralegal is admitted by the ledger's SELECT
            policy and by both write RPCs, but cannot read the ACCOUNT row, so
            this branch is all they ever see. Showing them the creation form
            would offer a write the database will always refuse.

            The copy therefore promises nothing: saying "once one exists you
            will see the ledger" would be permanently false for a paralegal,
            because accounts.length stays 0 for them no matter how many
            accounts the firm has. The underlying policy gap is reported to
            the humans rather than patched here; RLS is not ours to change.
          */
          <p className="card p-5 text-[13px] text-muted leading-relaxed">
            <T>
              Trust accounts are managed by a firm owner, administrator, or
              attorney. Ask one of them if you need access to this ledger.
            </T>
          </p>
        )}
      </div>
    );
  }

  // Select the account from the URL (?account=), defaulting to the
  // first. Everything below - reconciliation and the ledger - is scoped
  // to this one account so a multi-account firm never sees one account's
  // header over another account's numbers.
  const account =
    accounts.find((a) => a.id === searchParams?.account) ?? accounts[0];
  const recon = await reconcileTrustAccount(ctx.firm.id, account.id);
  const transactions = await listTrustTransactions(ctx.firm.id, {
    accountId: account.id,
  });
  const reconWorkspace = await getReconciliationWorkspace(
    ctx.firm.id,
    account.id,
  );
  const pastReconciliations = await listTrustReconciliations(
    ctx.firm.id,
    account.id,
  );

  // One view per trust account. These are real subsets: everything below
  // the header is scoped to the selected account. No counts, because the
  // page loads the ledger for the selected account only and a per-account
  // transaction count is a number this page does not have.
  const accountViews: ViewOption[] = accounts.map((a) => ({
    key: a.id,
    label: <span data-no-translate>{a.name}</span>,
  }));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · trust</T>}
        title={account.name}
        meta={
          <>
            {account.bank_name ?? <T>Bank not set</T>} ·{' '}
            {account.is_iolta ? 'IOLTA' : 'Trust'} · {account.state}
            {account.account_number_masked && ` · ${account.account_number_masked}`}
          </>
        }
      />

      {accounts.length > 1 && (
        <ViewStrip
          options={accountViews}
          active={account.id}
          href={(key) => `/counsel/trust?account=${key}`}
          label="Trust accounts"
        />
      )}

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
        <PanelCard title={<T>Per-client balances</T>}>
          <ul className="space-y-1.5 text-[13px]">
            {recon.perClient
              .filter((c) => c.balanceCents !== 0)
              .sort((a, b) => b.balanceCents - a.balanceCents)
              .map((c) => (
                <li
                  key={c.clientLabel}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-foreground" data-no-translate>
                    {c.clientLabel}
                  </span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      c.balanceCents < 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-foreground'
                    }`}
                  >
                    {fmtCents(c.balanceCents)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            <T>
              Negative balances mean the firm has disbursed more than was on
              deposit for that client. This must NEVER happen on an IOLTA
              account; investigate immediately.
            </T>
          </p>
        </PanelCard>
      )}

      {/* Record a new transaction */}
      <RecordTransactionForm firmId={ctx.firm.id} accountId={account.id} />

      {/* Bank-statement reconciliation */}
      <ReconcileForm
        firmId={ctx.firm.id}
        accountId={account.id}
        reconciledBaseCents={reconWorkspace.reconciledBaseCents}
        bookBalanceCents={recon.bookBalanceCents}
        unreconciled={reconWorkspace.unreconciled}
      />

      {pastReconciliations.length > 0 && (
        <PanelCard title={<T>Reconciliation history</T>} bodyClassName="">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead className="border-b border-edge">
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <th scope="col" className="px-3 py-2"><T>Statement date</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Bank</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Cleared</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Difference</T></th>
                  <th scope="col" className="px-3 py-2"><T>Status</T></th>
                </tr>
              </thead>
              <tbody>
                {pastReconciliations.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5 text-[13px] text-foreground">
                      {new Date(r.statementDate).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                      {fmtCents(r.bankBalanceCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                      {fmtCents(r.reconciledBalanceCents)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums ${
                        r.differenceCents === 0
                          ? 'text-muted'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {fmtCents(r.differenceCents)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        size="sm"
                        dot
                        color={
                          r.status === 'balanced'
                            ? PILL_COLORS.good
                            : PILL_COLORS.waiting
                        }
                      >
                        {r.status}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}

      {/* Transactions ledger, on the list pattern's table. Every amount
          keeps its sign, its colour and its label; only the row geometry
          changed. */}
      {transactions.length === 0 ? (
        <PanelCard title={<T>Ledger</T>}>
          <p className="text-[13px] italic text-muted">
            <T>No transactions yet.</T>
          </p>
        </PanelCard>
      ) : (
        <PanelCard
          title={<T>Ledger</T>}
          bodyClassName=""
          action={
            <p className="text-[12px] tabular-nums text-muted">
              {Math.min(transactions.length, 100)}
            </p>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead className="border-b border-edge">
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <th scope="col" className="px-3 py-2"><T>Client</T></th>
                  <th scope="col" className="px-3 py-2"><T>Kind</T></th>
                  <th scope="col" className="px-3 py-2"><T>Description</T></th>
                  <th scope="col" className="px-3 py-2"><T>Recorded</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Amount</T></th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 100).map((t) => {
                  const isPositive = POSITIVE.has(t.kind);
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                    >
                      <td
                        className="max-w-[14rem] truncate px-3 py-2.5 text-[13px] font-medium text-foreground"
                        data-no-translate
                      >
                        {t.clientLabel}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill
                          size="sm"
                          dot
                          color={KIND_COLOR[t.kind] ?? KIND_COLOR.correction}
                        >
                          {t.kind.replace(/_/g, ' ')}
                        </StatusPill>
                      </td>
                      <td
                        className="max-w-[18rem] truncate px-3 py-2.5 text-[12.5px] text-muted"
                        data-no-translate
                      >
                        {t.description ?? ''}
                        {t.reference ? ` · ref ${t.reference}` : ''}
                      </td>
                      <td
                        className="px-3 py-2.5 text-[12px] text-muted"
                        title={new Date(t.createdAt).toLocaleString()}
                        suppressHydrationWarning
                      >
                        {relativeTime(t.createdAt) ?? ''}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums ${
                          isPositive
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {isPositive ? '+' : '-'}
                        {fmtCents(t.amountCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}
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
          : 'text-foreground';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2"><T>{label}</T></p>
      <p className={`text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted mt-1.5">
          {sub}
        </p>
      )}
    </div>
  );
}
