import { adminListHealthChecks } from '@/lib/storage';
import { adminGetHqHealthExtras, adminGetLiveHealth } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System health - Advottic HQ' };

const PROBE_LABEL: Record<string, string> = {
  auth: 'Auth',
  database: 'Database',
  email: 'Email (Resend)',
  stripe: 'Stripe',
  bella: 'Bella (Anthropic)',
};

export default async function HqHealthPage() {
  const [live, checks, extras] = await Promise.all([
    adminGetLiveHealth(),
    adminListHealthChecks(48),
    adminGetHqHealthExtras(),
  ]);
  const latest = checks[0] ?? null;
  const probeNames = latest ? Object.keys(latest.probes) : Object.keys(PROBE_LABEL);
  const last24 = checks.slice(0, 24);

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Operations</p>
        <h2 className="font-display text-2xl text-gold-flow tracking-[-0.01em]">
          System health
        </h2>
        <p className="text-[13px] text-cream-100/70 mt-1">
          Real-time Supabase probe, hourly synthetic checks, security signals,
          and a live readout of who's using Advottic right now.
        </p>
      </header>

      <LiveStatusBanner live={live} />

      {/* Top row: posture metrics across the whole platform. */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UptimeTile uptime={extras.uptime} />
        <ActivityTile activity={extras.activity} />
        <GdprTile gdpr={extras.gdpr} />
        <SecurityTile security={extras.security} />
      </section>

      {/* Hourly probes, unchanged shape. */}
      <section className="space-y-3">
        <header>
          <p className="eyebrow text-cream-100/70">Hourly probes</p>
          <p className="text-[13px] text-cream-100/65 mt-0.5">
            Synthetic checks across the integrations Advottic relies on.
          </p>
        </header>
        {!latest ? (
          <p className="text-sm text-cream-100/70">
            No health checks recorded yet. The cron runs every hour; trigger one manually
            with <code className="font-mono">/api/cron/health</code>.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-cream-100/55">
              Last run {new Date(latest.ranAt).toLocaleString()}
              {typeof latest.durationMs === 'number' && ` (${latest.durationMs} ms)`}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {probeNames.map((p) => (
                <ProbeTile
                  key={p}
                  name={PROBE_LABEL[p] ?? p}
                  status={latest.probes[p as keyof typeof latest.probes] as string}
                  history={last24.map((c) => c.probes[p as keyof typeof c.probes] as string)}
                />
              ))}
            </div>
            {latest.failures.length > 0 && (
              <div className="card p-4 ring-1 ring-rose-700/40">
                <p className="eyebrow text-rose-300 mb-2">Failure detail</p>
                <ul className="text-[13px] space-y-1.5 text-cream-100/85">
                  {latest.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-mono text-rose-300">{f.probe}</span> - {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// =====================================================================
// Top-row health metric tiles
// =====================================================================

function UptimeTile({
  uptime,
}: {
  uptime: { passedRuns: number; totalRuns: number; ratio: number };
}) {
  const pct = (uptime.ratio * 100).toFixed(1);
  const tone =
    uptime.totalRuns === 0
      ? 'text-cream-100/55'
      : uptime.ratio >= 0.99
        ? 'text-emerald-300'
        : uptime.ratio >= 0.95
          ? 'text-amber-300'
          : 'text-rose-300';
  return (
    <Tile label="24h uptime" sub={`${uptime.passedRuns}/${uptime.totalRuns} probe runs all-pass`}>
      <p className={`font-display text-4xl font-medium tabular-nums ${tone}`}>
        {uptime.totalRuns === 0 ? '—' : `${pct}%`}
      </p>
    </Tile>
  );
}

function ActivityTile({
  activity,
}: {
  activity: {
    totalAccounts: number;
    onlineNow: number;
    activeToday: number;
    activeWeek: number;
  };
}) {
  const ratio =
    activity.totalAccounts > 0 ? activity.onlineNow / activity.totalAccounts : 0;
  // Three concentric ring fills: online (gold), active today, active week
  const total = Math.max(activity.totalAccounts, 1);
  const onlineDeg = (activity.onlineNow / total) * 360;
  const todayDeg = (activity.activeToday / total) * 360;
  const weekDeg = (activity.activeWeek / total) * 360;
  return (
    <Tile
      label="User activity"
      sub={`${activity.activeToday.toLocaleString()} signed in today · ${activity.activeWeek.toLocaleString()} this week`}
    >
      <div className="flex items-center gap-3 mt-1">
        <div
          className="relative h-16 w-16 rounded-full"
          style={{
            background: `conic-gradient(rgba(255,255,255,0.07) 0 ${weekDeg}deg, transparent ${weekDeg}deg 360deg)`,
          }}
        >
          <div
            className="absolute inset-1 rounded-full"
            style={{
              background: `conic-gradient(rgba(213,187,126,0.45) 0 ${todayDeg}deg, transparent ${todayDeg}deg 360deg)`,
            }}
          />
          <div
            className="absolute inset-2 rounded-full"
            style={{
              background: `conic-gradient(rgba(213,187,126,0.95) 0 ${onlineDeg}deg, transparent ${onlineDeg}deg 360deg)`,
            }}
          />
          <div className="absolute inset-3 rounded-full bg-[#0d1015] flex items-center justify-center">
            <span className="text-[11px] font-semibold text-cream-100 tabular-nums">
              {activity.onlineNow.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="text-[11px] text-cream-100/65 leading-snug">
          <p>
            <span className="text-cream-100 font-semibold tabular-nums">
              {activity.onlineNow.toLocaleString()}
            </span>{' '}
            online now
          </p>
          <p>
            of{' '}
            <span className="text-cream-100/85 tabular-nums">
              {activity.totalAccounts.toLocaleString()}
            </span>{' '}
            accounts
          </p>
          <p className="text-cream-100/45 mt-0.5">
            {(ratio * 100).toFixed(1)}% online
          </p>
        </div>
      </div>
    </Tile>
  );
}

function GdprTile({
  gdpr,
}: {
  gdpr: { consented: number; total: number; rate: number };
}) {
  const pct = (gdpr.rate * 100).toFixed(1);
  const tone =
    gdpr.rate >= 0.95
      ? 'text-emerald-300'
      : gdpr.rate >= 0.8
        ? 'text-amber-300'
        : 'text-rose-300';
  return (
    <Tile
      label="GDPR acceptance"
      sub={`${gdpr.consented.toLocaleString()} of ${gdpr.total.toLocaleString()} accounts have accepted`}
    >
      <p className={`font-display text-4xl font-medium tabular-nums ${tone}`}>
        {gdpr.total === 0 ? '—' : `${pct}%`}
      </p>
    </Tile>
  );
}

function SecurityTile({
  security,
}: {
  security: {
    openEvents: number;
    last24hCount: number;
    last24hHigh: number;
    last24hCritical: number;
  };
}) {
  const danger = security.last24hCritical > 0 || security.last24hHigh > 0;
  const tone = danger
    ? 'text-rose-300'
    : security.last24hCount > 0
      ? 'text-amber-300'
      : 'text-emerald-300';
  return (
    <Tile
      label="Security events (24h)"
      sub={
        security.last24hCount === 0
          ? 'No suspicious activity detected'
          : `${security.last24hHigh} high · ${security.last24hCritical} critical · ${security.openEvents} open`
      }
    >
      <p className={`font-display text-4xl font-medium tabular-nums ${tone}`}>
        {security.last24hCount.toLocaleString()}
      </p>
    </Tile>
  );
}

function Tile({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <p className="eyebrow text-cream-100/55 mb-2">{label}</p>
      {children}
      <p className="text-[11.5px] text-cream-100/55 mt-2 leading-snug">{sub}</p>
    </div>
  );
}

function LiveStatusBanner({ live }: { live: Awaited<ReturnType<typeof adminGetLiveHealth>> }) {
  const failed = live.probes.filter((p) => p.status === 'fail');
  const tone = live.ok
    ? 'ring-emerald-700/40 bg-emerald-950/30'
    : 'ring-rose-700/40 bg-rose-950/30';
  const dot = live.ok ? 'bg-emerald-400' : 'bg-rose-400';
  const ageHours =
    live.cronSnapshotAgeMs !== null
      ? Math.floor(live.cronSnapshotAgeMs / (60 * 60 * 1000))
      : null;
  return (
    <section className={`card p-5 ring-1 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot} animate-pulse`} aria-hidden />
          <p className="font-display text-lg text-cream-100">
            {live.ok
              ? 'Supabase reachable right now'
              : 'Supabase unreachable right now'}
          </p>
        </div>
        <p className="text-[11px] text-cream-100/55 font-mono tabular-nums">
          live probe · {live.totalLatencyMs} ms
        </p>
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {live.probes.map((p) => (
          <li
            key={p.name}
            className="flex items-baseline justify-between gap-2 text-[12px]"
          >
            <span className="text-cream-100/85 capitalize">{p.name}</span>
            <span
              className={
                p.status === 'pass'
                  ? 'text-emerald-300 font-mono tabular-nums'
                  : 'text-rose-300 font-mono tabular-nums'
              }
            >
              {p.status === 'pass' ? `${p.latencyMs}ms · pass` : 'fail'}
            </span>
          </li>
        ))}
      </ul>
      {failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-rose-200">
          {failed.map((p) => (
            <li key={p.name}>
              <span className="font-mono">{p.name}</span> — {p.error ?? 'unknown error'}
            </li>
          ))}
        </ul>
      )}
      {live.cronSnapshotStale && (
        <p className="mt-3 text-[12px] text-amber-200 bg-amber-950/40 ring-1 ring-amber-700/40 rounded-md px-3 py-2">
          <strong>Hourly probe snapshot is stale</strong>
          {ageHours !== null && ` (last cron run ${ageHours}h ago)`}. The
          Vercel Cron at <code className="font-mono">/api/cron/health</code> may
          not be firing - check <code className="font-mono">CRON_SECRET</code> and
          your Vercel plan's cron quota. The live probe above is unaffected.
        </p>
      )}
    </section>
  );
}

function ProbeTile({
  name,
  status,
  history,
}: {
  name: string;
  status: string;
  history: string[];
}) {
  const tone =
    status === 'pass'
      ? 'ring-emerald-700/40 bg-emerald-950/30'
      : status === 'fail'
        ? 'ring-rose-700/40 bg-rose-950/30'
        : 'ring-white/10 bg-white/5';
  const dotTone =
    status === 'pass'
      ? 'bg-emerald-400'
      : status === 'fail'
        ? 'bg-rose-400'
        : 'bg-cream-100/40';

  return (
    <div className={`card p-4 ring-1 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold tracking-tight text-cream-100">
          {name}
        </p>
        <span aria-hidden className={`h-2 w-2 rounded-full ${dotTone}`} />
      </div>
      <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-cream-100/55 mt-1">
        {status}
      </p>
      <div className="mt-3 flex gap-0.5 h-3 items-end" aria-label="Last 24 runs">
        {history
          .slice()
          .reverse()
          .map((h, i) => (
            <span
              key={i}
              className={`flex-1 rounded-sm ${
                h === 'pass'
                  ? 'bg-emerald-500/70'
                  : h === 'fail'
                    ? 'bg-rose-500/70'
                    : 'bg-cream-100/15'
              }`}
              style={{ height: '100%' }}
            />
          ))}
      </div>
    </div>
  );
}
