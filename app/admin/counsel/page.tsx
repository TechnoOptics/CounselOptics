import Link from 'next/link';
import { adminGetHqDashboardCounts, adminListFirms, adminListGrants } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Counsel overview · Advottic HQ' } };

/**
 * Counsel perspective overview. The cockpit for organizational
 * customers - firms, in-house teams, government counsel. Watch
 * applications, dispatch outbound invitations, monitor billing and
 * activity, and surface anything that needs founder attention.
 */
export default async function HqCounselOverviewPage() {
  const [hq, firms, grants] = await Promise.all([
    adminGetHqDashboardCounts(),
    adminListFirms(),
    adminListGrants(),
  ]);

  const recentFirms = firms.slice(0, 5);
  const recentInvites = grants.filter((g) => g.kind === 'outbound').slice(0, 5);
  const billingTrouble = firms.filter(
    (f) => f.ownerSubscriptionStatus === 'past_due' || f.ownerSubscriptionStatus === 'unpaid',
  );

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow text-amber-300">Advottic Counsel</p>
        <h2 className="font-display text-2xl tracking-[-0.01em] text-cream-100">
          Counsel overview
        </h2>
        <p className="text-[13px] text-cream-100/65 mt-1 max-w-2xl">
          The cockpit for organizational customers. Approve or schedule new firm
          applications, send direct invitations, monitor billing health, and review
          how each workspace is being used.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active firms" value={hq.counsel.firms} href="/admin/firms" />
        <Stat
          label="Pending requests"
          value={hq.counsel.pendingRequests}
          tone={hq.counsel.pendingRequests > 0 ? 'warn' : 'neutral'}
          href="/admin/counsel-requests"
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
      </section>

      {billingTrouble.length > 0 && (
        <section className="card p-5 ring-1 ring-rose-700/40 bg-rose-950/30">
          <p className="eyebrow text-rose-300 mb-1.5">Billing attention required</p>
          <p className="text-[13px] text-cream-100/80 mb-3">
            {billingTrouble.length} firm{billingTrouble.length === 1 ? '' : 's'} with
            past-due or unpaid status. Reach out before the workspace is paused.
          </p>
          <ul className="space-y-2">
            {billingTrouble.slice(0, 3).map((f) => (
              <li
                key={f.id}
                className="flex items-baseline justify-between gap-3 text-[13px]"
              >
                <span className="font-medium text-cream-100">{f.name}</span>
                <span className="text-rose-200 text-[12px]">
                  {f.ownerSubscriptionStatus}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/admin/firms"
            className="text-[12px] text-rose-200 hover:text-rose-100 underline mt-3 inline-block"
          >
            Review all firms →
          </Link>
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow text-cream-100/70">Recent firms</p>
            <Link
              href="/admin/firms"
              className="text-[12px] text-cream-100/65 hover:text-cream-100 underline underline-offset-2"
            >
              See all
            </Link>
          </header>
          {recentFirms.length === 0 ? (
            <p className="text-sm text-cream-100/55">
              No firms yet. Approve a request or send an invitation to get started.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentFirms.map((f) => (
                <li key={f.id} className="card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-cream-100 truncate">{f.name}</p>
                      <p className="text-[11px] text-cream-100/55 mt-0.5">
                        {f.memberCount} member{f.memberCount === 1 ? '' : 's'} ·{' '}
                        {f.clientCount} client{f.clientCount === 1 ? '' : 's'} ·{' '}
                        {f.caseCount} case{f.caseCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="text-[11px] text-cream-100/45 font-mono tabular-nums">
                      {new Date(f.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow text-cream-100/70">Recent outbound invitations</p>
            <Link
              href="/admin/invitations"
              className="text-[12px] text-cream-100/65 hover:text-cream-100 underline underline-offset-2"
            >
              See all
            </Link>
          </header>
          {recentInvites.length === 0 ? (
            <p className="text-sm text-cream-100/55">
              No outbound invitations yet. Send one from the Invitations page to bring
              a firm onto Counsel directly.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentInvites.map((g) => (
                <li key={g.id} className="card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-cream-100 truncate">
                        {g.organizationName}
                      </p>
                      <p className="text-[11px] text-cream-100/55 mt-0.5">
                        {g.email}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] tracking-wider px-2 py-0.5 rounded ${
                        g.status === 'pending'
                          ? 'bg-amber-950/50 text-amber-200 ring-1 ring-amber-700/40'
                          : g.status === 'redeemed'
                            ? 'bg-emerald-950/50 text-emerald-200 ring-1 ring-emerald-700/40'
                            : 'bg-white/5 text-cream-100/55 ring-1 ring-white/10'
                      }`}
                    >
                      {g.status.toUpperCase()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <ActionCard
          title="Manage active firms"
          summary="Members, clients, cases, billing snapshot per firm."
          href="/admin/firms"
        />
        <ActionCard
          title="Triage applications"
          summary="Schedule, approve, or deny incoming requests."
          href="/admin/counsel-requests"
        />
        <ActionCard
          title="Send an invitation"
          summary="Reserve a Counsel workspace for a firm without an application."
          href="/admin/invitations"
        />
      </section>
    </div>
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
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : 'text-cream-100';
  const inner = (
    <div className="card p-5 hover:ring-amber-500/25 transition-colors">
      <p className="eyebrow text-cream-100/55 mb-1.5">{label}</p>
      <p className={`text-3xl font-semibold tracking-tight tabular-nums ${numberTone}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionCard({
  title,
  summary,
  href,
}: {
  title: string;
  summary: string;
  href: string;
}) {
  return (
    <Link href={href} className="card p-5 hover:ring-amber-500/30 transition-all block">
      <p className="font-semibold text-cream-100 text-[14px]">{title}</p>
      <p className="text-[12.5px] text-cream-100/65 mt-1.5 leading-relaxed">{summary}</p>
      <p className="text-[12px] text-amber-300 font-semibold mt-3">Open →</p>
    </Link>
  );
}
