import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { TokenTopUpButton } from './topup-button';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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
    <div className="space-y-8 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/billing"
          className="text-muted hover:text-foreground"
        >
          <T>&larr; Billing</T>
        </Link>
      </p>

      <PageHeader
        eyebrow={<T>Counsel · Bella tokens</T>}
        title={<T>Firm pool</T>}
        subtitle={
          <T>One pool everyone on the firm draws from when they ask Bella.
          Heavy users on a litigation week absorb light users&rsquo;
          unused share. Top up here when the pool runs low; charges go
          to the firm&rsquo;s payment method.</T>
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
              ? `Renews ${new Date(firm.token_pool_period_end).toLocaleDateString()}`
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
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-foreground">
            <T>Top consumers (this period)</T>
          </h2>
          <ul className="space-y-1.5">
            {memberRanking.slice(0, 10).map((m) => {
              const total = Array.from(userUsage.values()).reduce(
                (s, n) => s + n,
                0,
              ) || 1;
              const pct = (m.usage / total) * 100;
              return (
                <li
                  key={m.user_id}
                  className="card p-3 flex items-center justify-between gap-3 text-[13px]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">
                      {m.display_name ?? m.user_id.slice(0, 8)}
                    </p>
                    <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
                      <span
                        className="block h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono tabular-nums text-foreground font-semibold">
                    {formatTokens(m.usage)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-foreground">
          <T>Recent ledger</T>
        </h2>
        {ledger.length === 0 ? (
          <p className="card p-4 text-[13px] text-muted italic">
            <T>No firm-pool activity yet. Tokens consumed by users in firm
            context will land here.</T>
          </p>
        ) : (
          <ul className="space-y-1.5">
            {ledger.slice(0, 25).map((r) => (
              <li
                key={r.id}
                className="card p-3 flex items-center justify-between gap-3 text-[13px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted">
                    {r.reason.replace(/_/g, ' ')}
                  </p>
                  <p className="text-foreground font-mono tabular-nums">
                    {new Date(r.occurred_at).toLocaleString()}
                  </p>
                </div>
                <p
                  className={`shrink-0 font-mono tabular-nums font-semibold ${
                    r.delta > 0
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {r.delta > 0 ? '+' : ''}
                  {r.delta.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
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
