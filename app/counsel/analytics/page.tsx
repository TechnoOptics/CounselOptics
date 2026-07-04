import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmAnalytics, type StatusCount, type MonthPoint } from '@/lib/counsel-analytics';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics · Counsel' };

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function prettify(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// Friendly labels for known statuses; anything else is prettified.
const LABELS: Record<string, string> = {
  in_progress: 'In progress',
  conflict_check_passed: 'Cleared',
  conflict_check_flagged: 'Conflict flagged',
  engaged: 'Engaged',
  rejected: 'Rejected',
  draft: 'Draft',
  sent: 'Sent',
  completed: 'Completed',
  recalled: 'Recalled',
  paid: 'Paid',
  void: 'Void',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
  unknown: 'Unknown',
};
const label = (s: string) => LABELS[s] ?? prettify(s);

const BAR_TONES = [
  'bg-forest-600 dark:bg-gold-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-ink-400 dark:bg-cream-100/40',
];

export default async function CounselAnalyticsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const a = await getFirmAnalytics(ctx.firm.id);

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>Analytics</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Firm dashboard</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>How</T> {ctx.firm.name}{' '}
          <T>
            is tracking across requests, signing, matters, meetings, and
            money. Live from your own data.
          </T>
        </p>
      </header>

      {/* KPI row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Open requests" value={String(a.requests.open)} sub={`${a.requests.thisMonth} new this month`} tone="forest" href="/counsel/inbox" />
        <Kpi label="Signed this month" value={String(a.signing.completedThisMonth)} sub={`${a.signing.completed} completed all-time`} tone="emerald" href="/counsel/signing" />
        <Kpi label="Upcoming meetings" value={String(a.meetings.upcoming)} sub={`${a.meetings.thisMonth} this month`} tone="sky" href="/counsel/calendar" />
        <Kpi label="Outstanding invoices" value={fmtCents(a.billing.outstandingCents)} sub={`${fmtCents(a.billing.paidThisMonthCents)} paid this month`} tone="amber" href="/counsel/billing" />
        <Kpi label="Requests this year" value={String(a.requests.thisYear)} sub={`${a.requests.total} all-time`} tone="forest" />
        <Kpi label="Avg. resolution" value={a.requests.avgResolutionDays === null ? '—' : `${a.requests.avgResolutionDays.toFixed(1)}d`} sub="request → engaged/closed" tone="ink" />
        <Kpi label="Signing turnaround" value={a.signing.avgTurnaroundDays === null ? '—' : `${a.signing.avgTurnaroundDays.toFixed(1)}d`} sub="sent → signed" tone="ink" />
        <Kpi label="Trust on deposit" value={fmtCents(a.trust.bookBalanceCents)} sub={`${a.people.members} team · ${a.people.employees} staff`} tone="forest" href="/counsel/trust" />
      </section>

      {/* Requests trend + status */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Panel title="Requests, last 6 months">
          <MonthlyBars points={a.requests.monthly} />
        </Panel>
        <Panel title="Requests by status">
          <StatusBars data={a.requests.byStatus} total={a.requests.total} />
        </Panel>
      </section>

      {/* Signing + documents + cases */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Panel title="Signing by status">
          <StatusBars data={a.signing.byStatus} total={a.signing.total} />
        </Panel>
        <Panel title="Cases by status">
          <StatusBars data={a.cases.byStatus} total={a.cases.total} />
        </Panel>
        <Panel title="Documents by status">
          <StatusBars data={a.documents.byStatus} total={a.documents.total} />
        </Panel>
      </section>

      {/* Money */}
      <section className="grid sm:grid-cols-3 gap-3">
        <MoneyStat label="Paid this month" value={fmtCents(a.billing.paidThisMonthCents)} />
        <MoneyStat label="Paid this year" value={fmtCents(a.billing.paidThisYearCents)} />
        <MoneyStat label="Outstanding" value={fmtCents(a.billing.outstandingCents)} accent />
      </section>
    </div>
  );
}

function Kpi({
  label: l,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'forest' | 'emerald' | 'sky' | 'amber' | 'ink';
  href?: string;
}) {
  const accent =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'sky'
        ? 'text-sky-700 dark:text-sky-300'
        : tone === 'amber'
          ? 'text-amber-700 dark:text-amber-300'
          : tone === 'ink'
            ? 'text-ink-700 dark:text-cream-100/80'
            : 'text-forest-800 dark:text-gold-300';
  const body = (
    <div className="card p-4 h-full">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/55">
        <T>{l}</T>
      </p>
      <p className={`mt-1 font-display text-2xl sm:text-[28px] leading-none ${accent}`}>{value}</p>
      <p className="mt-1.5 text-[11.5px] text-ink-500 dark:text-cream-100/55">{sub}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:shadow-card-hover transition-shadow rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <h2 className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-500 dark:text-cream-100/55 mb-4">
        <T>{title}</T>
      </h2>
      {children}
    </div>
  );
}

function MonthlyBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className="flex items-end gap-2 h-40">
      {points.map((p, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-mono tabular-nums text-ink-600 dark:text-cream-100/70">
            {p.count}
          </span>
          <div className="w-full flex items-end h-28">
            <div
              className="w-full rounded-t bg-forest-600 dark:bg-gold-500 transition-all"
              style={{ height: `${Math.max(4, (p.count / max) * 100)}%` }}
            />
          </div>
          <span className="text-[10.5px] text-ink-500 dark:text-cream-100/55">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBars({ data, total }: { data: StatusCount[]; total: number }) {
  if (total === 0) {
    return (
      <p className="text-[12.5px] text-ink-400 dark:text-cream-100/40 italic py-6">
        <T>Nothing yet — this fills in as you use Advottic.</T>
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <li key={d.status}>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span className="text-forest-900 dark:text-cream-100">{label(d.status)}</span>
              <span className="text-ink-500 dark:text-cream-100/55 font-mono tabular-nums">
                {d.count} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-ink-100 dark:bg-forest-800/60 overflow-hidden">
              <div
                className={`h-full rounded-full ${BAR_TONES[i % BAR_TONES.length]}`}
                style={{ width: `${Math.max(3, pct)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MoneyStat({ label: l, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/55">
        <T>{l}</T>
      </p>
      <p
        className={`mt-1 font-mono tabular-nums text-xl font-semibold ${
          accent ? 'text-amber-700 dark:text-amber-300' : 'text-forest-900 dark:text-cream-100'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
