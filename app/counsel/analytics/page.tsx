import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmAnalytics, type StatusCount, type MonthPoint } from '@/lib/counsel-analytics';
import { getFirmImpact, type Bucket, type FirmImpact } from '@/lib/counsel-impact';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Impact · Counsel' };

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
function fmtHours(hours: number) {
  if (hours >= 100) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}
function prettify(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// Friendly labels for known statuses; anything else is prettified.
const LABELS: Record<string, string> = {
  in_progress: 'In progress',
  under_review: 'Under review',
  needs_evidence: 'Needs evidence',
  export_ready: 'Export ready',
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

export default async function CounselImpactPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [a, impact] = await Promise.all([
    getFirmAnalytics(ctx.firm.id),
    getFirmImpact(ctx.firm.id),
  ]);

  const trustCents = a.trust.bookBalanceCents;

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Impact</T>}
        title={<T>Firm impact</T>}
        subtitle={
          <>
            <T>The work</T> {ctx.firm.name}{' '}
            <T>
              is carrying right now, at a glance: matters, evidence, the
              calendar ahead, and the money in motion. Live from your own
              data.
            </T>
          </>
        }
      />

      {/* Impact KPI row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Open matters"
          value={String(impact.matters.open)}
          sub={`${impact.matters.total} total`}
          tone="forest"
          href="/counsel/cases"
        />
        <Kpi
          label="Evidence logged"
          value={String(impact.evidence.total)}
          sub={`${impact.evidence.high} highly relevant`}
          tone="emerald"
        />
        <Kpi
          label="Upcoming hearings"
          value={String(impact.schedule.hearingsUpcoming)}
          sub={`${impact.schedule.deadlinesUpcoming} due within 30 days`}
          tone="sky"
          href="/counsel/calendar"
        />
        <Kpi
          label="Overdue deadlines"
          value={String(impact.schedule.deadlinesOverdue)}
          sub="hearing passed, matter still open"
          tone={impact.schedule.deadlinesOverdue > 0 ? 'rose' : 'ink'}
          href="/counsel/cases"
        />
        <Kpi
          label="Hours logged"
          value={fmtHours(impact.time.hoursLogged)}
          sub={`${fmtHours(impact.time.billableHours)} billable`}
          tone="forest"
          href="/counsel/time"
        />
        <Kpi
          label="Unbilled time"
          value={fmtCents(impact.time.unbilledCents)}
          sub={`${fmtCents(a.billing.outstandingCents)} invoiced, unpaid`}
          tone="amber"
          href="/counsel/billing"
        />
        <Kpi
          label="Trust on deposit"
          value={fmtCents(trustCents)}
          sub="client funds held"
          tone="forest"
          href="/counsel/trust"
        />
        <Kpi
          label="Open requests"
          value={String(a.requests.open)}
          sub={`Needs attention plus in review · ${a.requests.thisMonth} new this month`}
          tone="sky"
          href="/counsel/inbox"
        />
      </section>

      {/* Matters */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Panel title="Matters by status">
          <StatusBars data={impact.matters.byStatus} total={impact.matters.total} />
        </Panel>
        <Panel title="Matters by type">
          <BucketBars data={impact.matters.byType} total={impact.matters.total} />
        </Panel>
        <Panel title="Matters by posture">
          <BucketBars data={impact.matters.byPosture} total={impact.matters.total} />
        </Panel>
      </section>

      {/* Evidence + schedule */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Panel title="Evidence relevance">
          <RelevanceSplit ev={impact.evidence} />
        </Panel>
        <Panel title="On the calendar">
          <SchedulePanel schedule={impact.schedule} />
        </Panel>
      </section>

      {/* Activity + signing */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Panel title="Matters opened, last 6 months">
          <MonthlyBars points={impact.activity} />
        </Panel>
        <Panel title="Requests, last 6 months">
          <MonthlyBars points={a.requests.monthly} />
        </Panel>
      </section>

      {/* Money + time */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MoneyStat label="Unbilled time" value={fmtCents(impact.time.unbilledCents)} accent />
        <MoneyStat label="Billed time" value={fmtCents(impact.time.billedCents)} />
        <MoneyStat label="Paid this month" value={fmtCents(a.billing.paidThisMonthCents)} />
        <MoneyStat label="Trust on deposit" value={fmtCents(trustCents)} />
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
  tone: 'forest' | 'emerald' | 'sky' | 'amber' | 'rose' | 'ink';
  href?: string;
}) {
  const accent =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'sky'
        ? 'text-sky-700 dark:text-sky-300'
        : tone === 'amber'
          ? 'text-amber-700 dark:text-amber-300'
          : tone === 'rose'
            ? 'text-rose-700 dark:text-rose-300'
            : tone === 'ink'
              ? 'text-foreground'
              : 'text-accent-text';
  const body = (
    <div className="card p-4 h-full">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
        <T>{l}</T>
      </p>
      <p className={`mt-1 text-2xl sm:text-[28px] leading-none ${accent}`}>{value}</p>
      <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p>
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
      <h2 className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mb-4">
        <T>{title}</T>
      </h2>
      {children}
    </div>
  );
}

function EmptyNote() {
  return (
    <p className="text-[12.5px] text-muted italic py-6">
      <T>Nothing yet. This fills in as you use Advottic.</T>
    </p>
  );
}

function MonthlyBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className="flex items-end gap-2 h-40">
      {points.map((p, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-mono tabular-nums text-muted">
            {p.count}
          </span>
          <div className="w-full flex items-end h-28">
            <div
              className="w-full rounded-t bg-forest-600 dark:bg-gold-500 transition-all"
              style={{ height: `${Math.max(4, (p.count / max) * 100)}%` }}
            />
          </div>
          <span className="text-[10.5px] text-muted">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBars({ data, total }: { data: StatusCount[]; total: number }) {
  if (total === 0) return <EmptyNote />;
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <li key={d.status}>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span className="text-foreground">{label(d.status)}</span>
              <span className="text-muted font-mono tabular-nums">
                {d.count} · {pct}%
              </span>
            </div>
            <Track pct={pct} tone={BAR_TONES[i % BAR_TONES.length]} />
          </li>
        );
      })}
    </ul>
  );
}

function BucketBars({ data, total }: { data: Bucket[]; total: number }) {
  if (total === 0 || data.length === 0) return <EmptyNote />;
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <li key={d.key}>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span className="text-foreground" data-no-translate>{d.label}</span>
              <span className="text-muted font-mono tabular-nums">
                {d.count} · {pct}%
              </span>
            </div>
            <Track pct={pct} tone={BAR_TONES[i % BAR_TONES.length]} />
          </li>
        );
      })}
    </ul>
  );
}

function Track({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${Math.max(3, pct)}%` }}
      />
    </div>
  );
}

function RelevanceSplit({ ev }: { ev: FirmImpact['evidence'] }) {
  if (ev.scored === 0) {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">
          <T>Evidence items logged</T>:{' '}
          <span className="font-mono tabular-nums text-foreground">
            {ev.total}
          </span>
        </p>
        <p className="text-[12px] text-muted italic">
          <T>
            None scored for relevance yet. Run Advottic Review on a matter
            to see how its evidence maps to the case.
          </T>
        </p>
      </div>
    );
  }
  const segs = [
    { key: 'high', label: 'Highly relevant', count: ev.high, tone: 'bg-emerald-500' },
    { key: 'medium', label: 'Relevant', count: ev.medium, tone: 'bg-amber-500' },
    { key: 'low', label: 'Low relevance', count: ev.low, tone: 'bg-ink-300 dark:bg-forest-700' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <p className="text-[12.5px] text-muted">
          <span className="font-mono tabular-nums text-foreground text-lg">
            {ev.scored}
          </span>{' '}
          <T>of</T> {ev.total} <T>items scored</T>
        </p>
        {ev.avgScore !== null && (
          <p className="text-[12px] text-muted">
            <T>Avg</T>{' '}
            <span className="font-mono tabular-nums">{ev.avgScore.toFixed(0)}</span>/100
          </p>
        )}
      </div>
      {/* Segmented bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-2">
        {segs.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className={s.tone}
              style={{ width: `${(s.count / ev.scored) * 100}%` }}
              title={`${s.label}: ${s.count}`}
            />
          ) : null,
        )}
      </div>
      <ul className="space-y-1.5">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 text-foreground">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.tone}`} aria-hidden />
              <SegLabel k={s.key} />
            </span>
            <span className="text-muted font-mono tabular-nums">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Static, translatable labels for the three relevance bands (keyed so
// the guard sees literal <T> children, not a dynamic wrap).
function SegLabel({ k }: { k: string }) {
  if (k === 'high') return <T>Highly relevant</T>;
  if (k === 'medium') return <T>Relevant</T>;
  return <T>Low relevance</T>;
}

function SchedulePanel({
  schedule,
}: {
  schedule: {
    hearingsUpcoming: number;
    nextHearings: Array<{ caseId: string; title: string; at: string; location: string | null }>;
    deadlinesOverdue: number;
    deadlinesUpcoming: number;
  };
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat value={schedule.hearingsUpcoming} label="Upcoming hearings" />
        <MiniStat value={schedule.deadlinesUpcoming} label="Due in 30 days" />
        <MiniStat
          value={schedule.deadlinesOverdue}
          label="Overdue"
          tone={schedule.deadlinesOverdue > 0 ? 'rose' : 'ink'}
        />
      </div>
      {schedule.nextHearings.length > 0 ? (
        <ul className="space-y-1.5 pt-1">
          {schedule.nextHearings.map((h) => (
            <li key={h.caseId}>
              <Link
                href={`/counsel/cases/${h.caseId}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-surface-2 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] text-foreground truncate" data-no-translate>
                    {h.title}
                  </span>
                  {h.location && (
                    <span className="block text-[11px] text-muted truncate" data-no-translate>
                      {h.location}
                    </span>
                  )}
                </span>
                <span className="text-[11.5px] text-muted whitespace-nowrap" data-no-translate>
                  {new Date(h.at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted italic pt-1">
          <T>No hearings on the calendar. Add a hearing date to a matter to track it here.</T>
        </p>
      )}
    </div>
  );
}

function MiniStat({
  value,
  label: l,
  tone = 'forest',
}: {
  value: number;
  label: string;
  tone?: 'forest' | 'rose' | 'ink';
}) {
  const accent =
    tone === 'rose'
      ? 'text-rose-700 dark:text-rose-300'
      : tone === 'ink'
        ? 'text-muted'
        : 'text-accent-text';
  return (
    <div className="rounded-lg ring-1 ring-ink-100 dark:ring-forest-700/40 py-2.5">
      <p className={`text-2xl leading-none ${accent}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted mt-1 px-1">
        <T>{l}</T>
      </p>
    </div>
  );
}

function MoneyStat({ label: l, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
        <T>{l}</T>
      </p>
      <p
        className={`mt-1 font-mono tabular-nums text-xl font-semibold ${
          accent ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
