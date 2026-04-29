import Link from 'next/link';
import { adminGetHqDashboardCounts } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Advottic HQ' };

/**
 * HQ landing - the premium executive dashboard. Just two hero
 * numbers (Users / Businesses), a one-line system-health pill, a
 * compact crash-reports button, and a "pick your side" choice
 * between Consumer and Counsel administration. Drilling into either
 * side opens its own tailored overview at /admin/consumer or
 * /admin/counsel.
 */
export default async function HqLandingPage() {
  const counts = await adminGetHqDashboardCounts();
  const healthGood = counts.ops.healthStatus === 'pass';
  const healthFail = counts.ops.healthStatus === 'fail';

  return (
    <div className="space-y-10 animate-fade-up">
      <section className="grid gap-4 sm:grid-cols-2">
        <HeroStat
          label="Personal users"
          value={counts.consumer.users}
          subline="People using Advottic for their own legal matters"
          accent="cool"
        />
        <HeroStat
          label="Businesses on Counsel"
          value={counts.counsel.firms}
          subline="Firms, in-house teams, and government counsel"
          accent="warm"
        />
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <HealthPill
          status={counts.ops.healthStatus}
          failureCount={counts.ops.healthFailureCount}
          lastRun={counts.ops.healthLastRun}
        />
        <CrashButton count={counts.ops.crashOpen} />
        {(counts.consumer.pastDueSubs > 0 || counts.counsel.expiredGrants > 0) && (
          <span className="text-[12px] text-amber-300/85 px-3 py-1.5 rounded-md bg-amber-950/40 ring-1 ring-amber-700/40">
            {counts.consumer.pastDueSubs > 0 &&
              `${counts.consumer.pastDueSubs} subscription${counts.consumer.pastDueSubs === 1 ? '' : 's'} past due`}
            {counts.consumer.pastDueSubs > 0 && counts.counsel.expiredGrants > 0 && ' · '}
            {counts.counsel.expiredGrants > 0 &&
              `${counts.counsel.expiredGrants} expired invitation${counts.counsel.expiredGrants === 1 ? '' : 's'}`}
          </span>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <p className="eyebrow text-cream-100/70">Choose what to administrate</p>
          <h2 className="font-display text-xl text-cream-100 mt-0.5">
            Where would you like to focus?
          </h2>
          <p className="text-[13px] text-cream-100/60 mt-1 max-w-2xl">
            HQ tailors itself to one side at a time. Pick the lens you need now;
            you can always switch from the top header.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PerspectiveCard
            title="Consumer"
            tag="Personal Advottic"
            summary="Help individuals using Advottic for their own legal matters. Search users, support open feedback, watch subscription health, and review case activity."
            href="/admin/consumer"
            ctaLabel="Administer consumer"
            highlights={[
              { label: 'Total users', value: counts.consumer.users },
              { label: 'Active subscriptions', value: counts.consumer.activeSubs },
              { label: 'Open feedback', value: counts.consumer.feedbackOpen },
            ]}
            accent="cool"
          />
          <PerspectiveCard
            title="Counsel"
            tag="Organizational workspace"
            summary="Support firms and in-house teams on Advottic Counsel. Review applications, dispatch outbound invitations, monitor billing, and triage feature requests."
            href="/admin/counsel"
            ctaLabel="Administer counsel"
            highlights={[
              { label: 'Active firms', value: counts.counsel.firms },
              { label: 'Pending requests', value: counts.counsel.pendingRequests },
              { label: 'Outstanding invites', value: counts.counsel.pendingGrants },
            ]}
            accent="warm"
          />
        </div>
      </section>

      {(healthFail || !healthGood) && (
        <p className="text-[11px] text-cream-100/50 italic">
          {healthFail
            ? 'One or more synthetic probes are failing. Open System health to investigate.'
            : 'No synthetic probes have run yet. The hourly cron writes to system_health.'}
        </p>
      )}
    </div>
  );
}

function HeroStat({
  label,
  value,
  subline,
  accent,
}: {
  label: string;
  value: number;
  subline: string;
  accent: 'cool' | 'warm';
}) {
  const ring =
    accent === 'cool'
      ? 'ring-sky-700/30 hover:ring-sky-500/40'
      : 'ring-amber-700/30 hover:ring-amber-500/40';
  const number =
    accent === 'cool' ? 'text-sky-200' : 'text-amber-200';
  return (
    <div
      className={`card p-7 ring-1 ${ring} transition-colors`}
    >
      <p className="eyebrow text-cream-100/65">{label}</p>
      <p
        className={`mt-3 font-display text-6xl font-medium tracking-[-0.03em] tabular-nums ${number}`}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-[13px] text-cream-100/60 mt-2">{subline}</p>
    </div>
  );
}

function HealthPill({
  status,
  failureCount,
  lastRun,
}: {
  status: 'pass' | 'fail' | 'unknown';
  failureCount: number;
  lastRun: string | null;
}) {
  const tone =
    status === 'pass'
      ? 'bg-emerald-950/40 ring-emerald-700/40 text-emerald-200'
      : status === 'fail'
        ? 'bg-rose-950/40 ring-rose-700/40 text-rose-200'
        : 'bg-white/5 ring-white/10 text-cream-100/70';
  const dot =
    status === 'pass'
      ? 'bg-emerald-400'
      : status === 'fail'
        ? 'bg-rose-400'
        : 'bg-cream-100/40';
  const label =
    status === 'pass'
      ? 'All systems pass'
      : status === 'fail'
        ? `${failureCount} probe${failureCount === 1 ? '' : 's'} failing`
        : 'No probes yet';
  return (
    <Link
      href="/admin/health"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 text-[12.5px] transition-colors ${tone}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span>{label}</span>
      {lastRun && status !== 'unknown' && (
        <span className="text-cream-100/50 font-mono text-[11px]">
          · last run {timeAgo(lastRun)}
        </span>
      )}
    </Link>
  );
}

function CrashButton({ count }: { count: number }) {
  const tone =
    count === 0
      ? 'bg-white/5 ring-white/10 text-cream-100/55 hover:text-cream-100/80'
      : 'bg-rose-950/40 ring-rose-700/40 text-rose-200 hover:text-rose-100';
  return (
    <Link
      href="/admin/crashes"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 text-[12.5px] transition-colors ${tone}`}
    >
      <span aria-hidden>{count === 0 ? '○' : '●'}</span>
      <span>
        {count === 0
          ? 'No crash reports'
          : `Crash reports (${count.toLocaleString()})`}
      </span>
    </Link>
  );
}

function PerspectiveCard({
  title,
  tag,
  summary,
  href,
  ctaLabel,
  highlights,
  accent,
}: {
  title: string;
  tag: string;
  summary: string;
  href: string;
  ctaLabel: string;
  highlights: { label: string; value: number }[];
  accent: 'cool' | 'warm';
}) {
  const ring =
    accent === 'cool' ? 'hover:ring-sky-500/40' : 'hover:ring-amber-500/40';
  const tagColor =
    accent === 'cool' ? 'text-sky-300' : 'text-amber-300';
  return (
    <Link
      href={href}
      className={`card p-6 ring-1 ring-white/5 transition-all hover:translate-y-[-1px] ${ring} block`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className={`eyebrow ${tagColor}`}>{tag}</p>
          <h3 className="font-display text-2xl text-cream-100 mt-0.5">{title}</h3>
        </div>
        <span className="text-cream-100/55 text-sm" aria-hidden>
          →
        </span>
      </div>
      <p className="text-[13px] text-cream-100/65 mt-3 leading-relaxed">{summary}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
        {highlights.map((h) => (
          <div key={h.label}>
            <dd className="font-display text-2xl font-medium text-cream-100 tabular-nums">
              {h.value.toLocaleString()}
            </dd>
            <dt className="text-[11px] uppercase tracking-wider text-cream-100/55 mt-1">
              {h.label}
            </dt>
          </div>
        ))}
      </dl>
      <p
        className={`mt-5 inline-flex items-center gap-1 text-[13px] font-semibold ${
          accent === 'cool' ? 'text-sky-300' : 'text-amber-300'
        }`}
      >
        {ctaLabel} <span aria-hidden>→</span>
      </p>
    </Link>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
