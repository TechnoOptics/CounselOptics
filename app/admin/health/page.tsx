import { adminListHealthChecks } from '@/lib/storage';

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
  const checks = await adminListHealthChecks(48);
  const latest = checks[0] ?? null;
  const probeNames = latest ? Object.keys(latest.probes) : Object.keys(PROBE_LABEL);
  const last24 = checks.slice(0, 24);

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Operations</p>
        <h2 className="font-display text-2xl text-cream-100 tracking-[-0.01em]">
          System health
        </h2>
        <p className="text-[13px] text-cream-100/65 mt-1">
          Hourly synthetic probes across the integrations Advottic relies on.
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
    </div>
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
