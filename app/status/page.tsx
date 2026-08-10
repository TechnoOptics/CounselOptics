import { ExternalLink } from '@/components/ExternalLink';
import { adminGetLiveHealth } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = {
  title: 'Status',
  description:
    'Live operational status for Advottic. Probes Supabase, Stripe, Resend, and Anthropic in real time on every page load.',
  alternates: { canonical: '/status' },
};

/**
 * Public status page. Mirrors the live probe HQ uses on
 * /admin/health, but rendered for any visitor (including
 * unauthenticated). The page intentionally does NOT expose
 * detailed error messages on failures - just status + latency -
 * because anyone on the internet can see this.
 *
 * status.advottic.com points here via a CNAME / Vercel domain
 * alias once we register the subdomain. The same content lives
 * at advottic.com/status as a fallback.
 */
export default async function StatusPage() {
  const live = await adminGetLiveHealth().catch(() => null);

  const overall = live?.ok ? 'green' : live ? 'red' : 'unknown';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-10">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-3 w-3">
            <span
              className={`animate-ping absolute inset-0 rounded-full opacity-75 ${
                overall === 'green'
                  ? 'bg-emerald-400'
                  : overall === 'red'
                    ? 'bg-rose-400'
                    : 'bg-cream-100/40'
              }`}
              style={{ animationDuration: overall === 'green' ? '2.5s' : '0.8s' }}
            />
            <span
              className={`relative inline-flex rounded-full h-3 w-3 ${
                overall === 'green'
                  ? 'bg-emerald-400'
                  : overall === 'red'
                    ? 'bg-rose-400'
                    : 'bg-cream-100/40'
              }`}
            />
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em]">
            {overall === 'green'
              ? 'All systems operational'
              : overall === 'red'
                ? 'Some systems are degraded'
                : 'Unable to probe right now'}
          </h1>
        </div>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Live readout. Each component is probed when this page loads, with
          an additional daily synthetic check. Incidents are posted on the
          banner above and on{' '}
          <ExternalLink
            href="https://twitter.com/advottic"
            className="underline"
          >
            @advottic
          </ExternalLink>
          .
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Components
        </h2>
        <ul className="space-y-2">
          {(live?.probes ?? PLACEHOLDER_PROBES).map((p) => (
            <li
              key={p.name}
              className="card p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    p.status === 'pass'
                      ? 'bg-emerald-400'
                      : p.status === 'fail'
                        ? 'bg-rose-400'
                        : 'bg-cream-100/40'
                  }`}
                  aria-hidden
                />
                <p className="font-semibold text-forest-900 dark:text-cream-100 capitalize">
                  {DISPLAY_NAME[p.name] ?? p.name}
                </p>
              </div>
              <p className="text-[12px] font-mono tabular-nums text-ink-500 dark:text-cream-100/55">
                {p.status === 'pass'
                  ? `${p.latencyMs} ms`
                  : p.status === 'fail'
                    ? 'degraded'
                    : 'unknown'}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Subscribing to incidents
        </h2>
        <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          For business-critical issues affecting your firm, email{' '}
          <a href="mailto:incidents@advottic.com" className="underline">
            incidents@advottic.com
          </a>{' '}
          with your firm name and a brief description; we triage 24/7. For
          everyone else, follow the @advottic Twitter / X for live status
          updates during incidents.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          What we measure
        </h2>
        <ul className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed space-y-2 list-disc pl-5">
          <li>
            <strong>Database (Supabase):</strong> a probe row read + write on
            every page load.
          </li>
          <li>
            <strong>Auth:</strong> Supabase Auth admin endpoint reachable.
          </li>
          <li>
            <strong>Email (Resend):</strong> daily synthetic message sent and
            received in the test mailbox.
          </li>
          <li>
            <strong>Stripe:</strong> daily probe of the customer + invoice
            APIs.
          </li>
          <li>
            <strong>Bella (Anthropic):</strong> daily prompt + completion
            round-trip.
          </li>
        </ul>
      </section>

      <p className="text-[11px] text-ink-500 dark:text-cream-100/70 font-mono">
        Last probed {live ? new Date().toISOString() : 'never'} ·{' '}
        {live ? `${live.totalLatencyMs} ms total` : ''}
      </p>
    </div>
  );
}

const DISPLAY_NAME: Record<string, string> = {
  database: 'Database',
  auth: 'Authentication',
  email: 'Email delivery',
  stripe: 'Payments',
  bella: 'Bella AI',
};

// Used when the live probe failed entirely (eg. service role missing
// in the deploy env). Lets the page still render without a 500.
const PLACEHOLDER_PROBES = [
  { name: 'database', status: 'unknown', latencyMs: 0 },
  { name: 'auth', status: 'unknown', latencyMs: 0 },
  { name: 'email', status: 'unknown', latencyMs: 0 },
  { name: 'stripe', status: 'unknown', latencyMs: 0 },
  { name: 'bella', status: 'unknown', latencyMs: 0 },
] as const;
