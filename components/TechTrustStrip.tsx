/**
 * Compliance + tech-stack trust strip. The existing `TrustBadges`
 * on the home page conveys soft-trust messaging ("private by
 * default", "yours to take with you"). This strip carries the
 * harder credentials a law-firm prospect or enterprise evaluator
 * scans for in the first 5 seconds:
 *
 *   - Real partner integrations (Anthropic, Stripe, Supabase,
 *     Vercel) - signals "this isn't a weekend project"
 *   - Concrete security primitives (AES-256, TLS 1.3, audit log)
 *   - Compliance posture (SOC 2 in progress, UETA / E-SIGN, HIPAA
 *     BAA on request) - the SOC 2 row is honest: "in progress"
 *     not "certified", because the cert isn't issued yet
 *
 * Mount on the home page just below the soft TrustBadges, and on
 * /pricing just above the firm tiers. Same component, same data,
 * one source of truth.
 *
 * Why no logos: image rights are murky for partner logos until
 * we have a co-marketing agreement. Wordmark text is always safe
 * (factual statement of fact, not a claim of endorsement).
 */

const PARTNERS = [
  { name: 'Anthropic Claude', sub: 'Bella runs on Claude, the leading reasoning model for legal tasks.' },
  { name: 'Stripe Connect', sub: 'Subscriptions, IOLTA marketplace fee splits, and PCI-compliant checkout.' },
  { name: 'Supabase', sub: 'Postgres + RLS for tenant isolation, real-time sync, encrypted storage.' },
  { name: 'Vercel', sub: 'Edge-cached delivery, automatic SSL, 99.99% uptime.' },
];

const SECURITY = [
  {
    label: 'Encryption',
    value: 'AES-256 at rest, TLS 1.3 in transit',
  },
  {
    label: 'Audit log',
    value: 'Every read, edit, and signature is timestamped',
  },
  {
    label: 'Tenant isolation',
    value: 'Postgres row-level security per firm and per matter',
  },
  {
    label: 'Compliance',
    value: 'SOC 2 Type II in progress · HIPAA BAA on request',
  },
  {
    label: 'E-signatures',
    value: 'UETA + E-SIGN Act compliant with audit trail',
  },
  {
    label: 'Data residency',
    value: 'United States by default · custom regions for Enterprise',
  },
];

export function TechTrustStrip() {
  return (
    <section
      aria-label="Security and partner trust signals"
      className="space-y-8 sm:space-y-10"
    >
      <div className="text-center space-y-2">
        <p className="eyebrow justify-center">Built on a foundation lawyers can defend</p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Real partners. Real security. Real audit trail.
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PARTNERS.map((p) => (
          <div
            key={p.name}
            className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 space-y-1.5"
          >
            <p className="font-display text-[15px] font-medium text-forest-900 dark:text-cream-100">
              {p.name}
            </p>
            <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
              {p.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 p-6 sm:p-8">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map((s) => (
            <div key={s.label} className="space-y-1">
              <dt className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                {s.label}
              </dt>
              <dd className="text-[13.5px] text-forest-900 dark:text-cream-100 leading-snug">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-[11.5px] text-center text-ink-500 dark:text-cream-100/55 max-w-2xl mx-auto leading-relaxed">
        Security details available on request: see{' '}
        <a
          href="/security"
          className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
        >
          /security
        </a>{' '}
        for the full posture, or email{' '}
        <a
          href="mailto:security@advottic.com"
          className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
        >
          security@advottic.com
        </a>{' '}
        to request our latest pen-test report and SOC 2 progress letter.
      </p>
    </section>
  );
}
