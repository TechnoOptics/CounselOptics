import Link from 'next/link';
import { adminGetCounts } from '@/lib/storage';
import { adminGetHqDashboardCounts } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';

/**
 * Advottic HQ landing dashboard. Shows the founder a one-screen
 * snapshot of both halves of the business: the consumer app (users,
 * subs, cases, feedback) and Counsel (firms, requests, invitations).
 */
export default async function HqDashboardPage() {
  const [legacy, hq] = await Promise.all([adminGetCounts(), adminGetHqDashboardCounts()]);

  return (
    <div className="space-y-8">
      <Section
        title="Consumer app"
        subtitle="Personal Advottic - the help-yourself toolkit for individuals."
        accent="text-forest-900 dark:text-cream-100"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total users" value={hq.consumer.users} href="/admin/users" />
          <Stat
            label="Active subscriptions"
            value={hq.consumer.activeSubs}
            tone={hq.consumer.activeSubs > 0 ? 'good' : 'neutral'}
          />
          <Stat
            label="Past-due / unpaid"
            value={hq.consumer.pastDueSubs}
            tone={hq.consumer.pastDueSubs > 0 ? 'warn' : 'neutral'}
          />
          <Stat label="Cases filed" value={legacy.cases} href="/admin/cases" />
        </div>
      </Section>

      <Section
        title="Advottic Counsel"
        subtitle="Organizational legal workspace for firms, in-house teams, and government counsel."
        accent="text-gold-700 dark:text-gold-metal"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active firms" value={hq.counsel.firms} href="/admin/firms" />
          <Stat
            label="Pending requests"
            value={hq.counsel.pendingRequests}
            href="/admin/counsel-requests"
            tone={hq.counsel.pendingRequests > 0 ? 'warn' : 'neutral'}
          />
          <Stat
            label="Scheduled calls"
            value={hq.counsel.scheduledRequests}
            href="/admin/counsel-requests"
          />
          <Stat
            label="Outstanding invitations"
            value={hq.counsel.pendingGrants}
            href="/admin/invitations"
          />
        </div>
      </Section>

      <Section
        title="Operations"
        subtitle="Cross-cutting signals that need attention."
        accent="text-ink-700 dark:text-cream-100/85"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Open feedback"
            value={hq.consumer.feedbackOpen}
            href="/admin/feedback"
            tone={hq.consumer.feedbackOpen > 0 ? 'warn' : 'neutral'}
          />
          <Stat
            label="Expired invitations"
            value={hq.counsel.expiredGrants}
            href="/admin/invitations"
            tone={hq.counsel.expiredGrants > 0 ? 'neutral' : 'neutral'}
          />
          <Stat label="Exhibits" value={legacy.exhibits} />
          <Stat label="Document reviews" value={legacy.reviews} />
        </div>
      </Section>

      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 italic">
        Numbers refresh on each page load. The cards link to the relevant management
        surface so you can drill in.
      </p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className={`eyebrow ${accent}`}>{title}</p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  href?: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const numberTone =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-ink-950 dark:text-cream-100';
  const inner = (
    <div className="card p-5 hover:bg-ink-50/40 dark:hover:bg-forest-800/30 transition-colors">
      <p className="eyebrow mb-1.5">{label}</p>
      <p
        className={`text-3xl font-semibold tracking-tight tabular-nums ${numberTone}`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
