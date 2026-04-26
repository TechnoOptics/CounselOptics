import { adminAcknowledgeCrash, adminListCrashReports, adminListHealthChecks } from '@/lib/storage';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

const PROBE_LABEL: Record<string, string> = {
  auth: 'Auth',
  database: 'Database',
  email: 'Email (Resend)',
  stripe: 'Stripe',
  bella: 'Bella (Anthropic)',
};

async function ackCrashAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await adminAcknowledgeCrash(id);
  revalidatePath('/admin/health');
}

export default async function AdminHealthPage() {
  const [checks, crashes] = await Promise.all([
    adminListHealthChecks(48),
    adminListCrashReports({ includeAcknowledged: false, limit: 100 }),
  ]);

  // Latest run drives the green/red tile state.
  const latest = checks[0] ?? null;
  const probeNames = latest ? Object.keys(latest.probes) : Object.keys(PROBE_LABEL);
  const last24 = checks.slice(0, 24);

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow mb-2">System health</p>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
          Hourly probes
        </h2>
        {!latest ? (
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-3">
            No health checks recorded yet. The cron runs every hour; trigger one manually
            with <code className="font-mono">/api/cron/health</code>.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 mt-1">
              Last run {new Date(latest.ranAt).toLocaleString()}
              {typeof latest.durationMs === 'number' && ` (${latest.durationMs} ms)`}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <div className="card mt-4 p-4 ring-1 ring-rose-200">
                <p className="eyebrow text-rose-700 mb-2">Failure detail</p>
                <ul className="text-[13px] space-y-1.5 text-ink-700 dark:text-cream-100/80">
                  {latest.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-mono text-rose-700 dark:text-rose-300">
                        {f.probe}
                      </span>{' '}
                      - {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <p className="eyebrow mb-2">Crash reports</p>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
          Unacknowledged client errors
        </h2>
        {crashes.length === 0 ? (
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-3">
            Nothing waiting. Browser-side errors land here when they happen.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {crashes.map((c) => (
              <li key={c.id} className="card p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="text-[13px] font-medium text-ink-950 dark:text-cream-100 break-words">
                    {c.message}
                  </p>
                  <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                    {new Date(c.reportedAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-[11.5px] text-ink-500 dark:text-cream-100/55 space-x-3">
                  {c.url && <span>path: <code className="font-mono">{c.url}</code></span>}
                  {c.release && <span>release: <code className="font-mono">{c.release}</code></span>}
                  {c.userId && <span>user: <code className="font-mono">{c.userId.slice(0, 8)}</code></span>}
                </div>
                {c.stack && (
                  <details className="text-[11.5px] text-ink-600 dark:text-cream-100/65">
                    <summary className="cursor-pointer underline">Stack</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-ink-50 dark:bg-forest-800/40 rounded p-3 overflow-x-auto">
                      {c.stack}
                    </pre>
                  </details>
                )}
                <form action={ackCrashAction} className="pt-1">
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="btn-secondary text-[12px] px-3 py-1.5"
                  >
                    Acknowledge
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
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
      ? 'bg-forest-50 ring-forest-200 dark:bg-forest-900/40 dark:ring-forest-700/40'
      : status === 'fail'
        ? 'bg-rose-50 ring-rose-200 dark:bg-rose-900/40 dark:ring-rose-700/40'
        : 'bg-ink-50 ring-ink-200 dark:bg-forest-800/40 dark:ring-forest-700/40';
  const dotTone =
    status === 'pass'
      ? 'bg-forest-700 dark:bg-forest-400'
      : status === 'fail'
        ? 'bg-rose-600 dark:bg-rose-400'
        : 'bg-ink-300 dark:bg-cream-100/35';

  return (
    <div className={`card p-4 ring-1 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold tracking-tight text-ink-900 dark:text-cream-100">
          {name}
        </p>
        <span aria-hidden className={`h-2 w-2 rounded-full ${dotTone}`} />
      </div>
      <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 mt-1">
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
                  ? 'bg-forest-700/70 dark:bg-forest-400/70'
                  : h === 'fail'
                    ? 'bg-rose-600/70 dark:bg-rose-400/70'
                    : 'bg-ink-300/60 dark:bg-cream-100/15'
              }`}
              style={{ height: '100%' }}
            />
          ))}
      </div>
    </div>
  );
}
