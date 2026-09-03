import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { TokenTopUpButton } from './topup-button';
import { PageHeader } from '@/components/counsel/ui';
import { PanelCard, relativeTime } from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateNumeric, formatDateTimeNumeric, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bella tokens · Counsel' };

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

export default async function FirmTokenPoolPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (!['owner', 'admin'].includes(ctx.membership.role)) {
    redirect('/counsel');
  }
  const supabase = createServerSupabase();

  const [{ data: firmRow }, { data: members }, { data: ledgerRaw }] =
    await Promise.all([
      supabase
        .from('firms')
        .select('token_pool_balance, token_pool_period_end')
        .eq('id', ctx.firm.id)
        .maybeSingle(),
      supabase
        .from('firm_members')
        .select('user_id, display_name, role')
        .eq('firm_id', ctx.firm.id),
      supabase
        .from('token_ledger')
        .select('id, occurred_at, delta, reason, balance_after, user_id, metadata')
        .eq('firm_id', ctx.firm.id)
        .order('occurred_at', { ascending: false })
        .limit(50),
    ]);
  const firm = firmRow as {
    token_pool_balance: number;
    token_pool_period_end: string | null;
  } | null;
  const memberRows = (members ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    role: string;
  }>;
  const ledger = (ledgerRaw ?? []) as Array<{
    id: string;
    occurred_at: string;
    delta: number;
    reason: string;
    balance_after: number | null;
    user_id: string | null;
    metadata: Record<string, unknown> | null;
  }>;

  // Per-member usage rollup from the ledger this period.
  const periodStart = (() => {
    if (!firm?.token_pool_period_end) return null;
    const end = new Date(firm.token_pool_period_end);
    end.setMonth(end.getMonth() - 1);
    return end;
  })();
  const userUsage = new Map<string, number>();
  for (const r of ledger) {
    if (!r.user_id || r.delta >= 0) continue;
    if (periodStart && new Date(r.occurred_at) < periodStart) continue;
    userUsage.set(r.user_id, (userUsage.get(r.user_id) ?? 0) + Math.abs(r.delta));
  }
  const memberRanking = memberRows
    .map((m) => ({
      ...m,
      usage: userUsage.get(m.user_id) ?? 0,
    }))
    .sort((a, b) => b.usage - a.usage);

  const balance = firm?.token_pool_balance ?? 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        backLink={
          <Link
            href="/counsel/billing"
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            <T>&larr; Billing</T>
          </Link>
        }
        eyebrow={<T>Counsel · Bella tokens</T>}
        title={<T>Firm pool</T>}
        subtitle={
          <>
            <T>One pool everyone on the firm draws from when they ask Bella.
            Heavy users on a litigation week absorb light users&rsquo;
            unused share.</T>
            {/* This sentence points at TokenTopUpButton, which is hidden in
                both native shells (data-hide-in-app). It carries the same
                attribute so it appears exactly when the button does; without
                it the app reader was told to press a control that was not on
                the page. */}
            <span data-hide-in-app>
              {' '}
              <T>Top up here when the pool runs low; charges go to the
              firm&rsquo;s payment method.</T>
            </span>
          </>
        }
        action={<TokenTopUpButton />}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Pool balance"
          value={formatTokens(balance)}
          tone={balance > 1_000_000 ? 'emerald' : balance > 200_000 ? 'amber' : 'rose'}
          sub={
            firm?.token_pool_period_end
              ? `Renews ${formatDateNumeric(firm.token_pool_period_end)}`
              : 'No active subscription'
          }
        />
        <Stat
          label="Users on team"
          value={String(memberRows.length)}
          sub={`${memberRows.filter((m) => ['owner', 'admin', 'attorney'].includes(m.role)).length} attorneys`}
        />
        <Stat
          label="Period to date"
          value={formatTokens(
            Array.from(userUsage.values()).reduce((s, n) => s + n, 0),
          )}
          sub="tokens consumed by the team"
        />
      </section>

      {memberRanking.some((m) => m.usage > 0) && (
        <PanelCard title={<T>Top consumers (this period)</T>}>
          <ul className="space-y-2">
            {memberRanking.slice(0, 10).map((m) => {
              const total = Array.from(userUsage.values()).reduce(
                (s, n) => s + n,
                0,
              ) || 1;
              const pct = (m.usage / total) * 100;
              return (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 text-[13px]"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate font-medium text-foreground"
                      data-no-translate
                    >
                      {m.display_name ?? m.user_id.slice(0, 8)}
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">
                    {formatTokens(m.usage)}
                  </span>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}

      {ledger.length === 0 ? (
        <PanelCard title={<T>Recent ledger</T>}>
          <p className="text-[13px] italic text-muted">
            <T>No firm-pool activity yet. Tokens consumed by users in firm
            context will land here.</T>
          </p>
        </PanelCard>
      ) : (
        <PanelCard
          title={<T>Recent ledger</T>}
          bodyClassName=""
          action={
            <p className="text-[12px] tabular-nums text-muted">
              {Math.min(ledger.length, 25)}
            </p>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left">
              <thead className="border-b border-edge">
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <th scope="col" className="px-3 py-2"><T>Reason</T></th>
                  <th scope="col" className="px-3 py-2"><T>Occurred</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Change</T></th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 25).map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.1em] text-foreground">
                      {r.reason.replace(/_/g, ' ')}
                    </td>
                    <td
                      className="px-3 py-2.5 text-[12px] text-muted"
                      title={formatDateTimeNumeric(r.occurred_at)}
                      suppressHydrationWarning
                    >
                      {relativeTime(r.occurred_at) ?? ''}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums ${
                        r.delta > 0
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {r.delta > 0 ? '+' : ''}
                      {formatNumber(r.delta)}
                    </td>
                  </tr>
                ))}
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
  sub,
  tone = 'gray',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'gray' | 'amber' | 'emerald' | 'rose';
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
