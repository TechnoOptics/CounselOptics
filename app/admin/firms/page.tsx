import Link from 'next/link';
import { LocaleTime } from '@/components/LocaleTime';
import { adminListFirms } from '@/lib/hq-storage';
import { listTrialFirms } from '@/lib/firm-trials';
import { FIRM_TYPE_LABEL } from '@/lib/firm-types';
import { SubdomainToggle } from './subdomain-toggle';
import { BrandingEditor } from './branding-editor';
import { ImpersonateOwnerButton } from './impersonate-owner-button';
import { TrialConsole, type TrialFirmView } from './trial-controls';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Active firms · Advottic HQ' } };

const DAY_MS = 86_400_000;

export default async function HqFirmsPage() {
  const [firms, trialFirms] = await Promise.all([
    adminListFirms(),
    listTrialFirms(),
  ]);
  const activeBilling = firms.filter(
    (f) => f.ownerSubscriptionStatus === 'active' || f.ownerSubscriptionStatus === 'trialing',
  ).length;
  const pastDue = firms.filter(
    (f) => f.ownerSubscriptionStatus === 'past_due' || f.ownerSubscriptionStatus === 'unpaid',
  ).length;

  // One clock for one render, and the remaining days are counted here rather
  // than in the browser so both renders agree on what day it is. A client-side
  // count would differ from the server's whenever the two straddle midnight,
  // which is a hydration mismatch on the one figure the view is scanned for.
  const now = Date.now();
  const trialRows: TrialFirmView[] = trialFirms.map((f) => {
    const endMs = f.trialEndsAt ? new Date(f.trialEndsAt).getTime() : null;
    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      trialEndsAt: f.trialEndsAt,
      suspendedAt: f.suspendedAt,
      seatLimit: f.seatLimit,
      memberCount: f.memberCount,
      state: f.state,
      daysRemaining:
        endMs === null || Number.isNaN(endMs)
          ? null
          : Math.ceil((endMs - now) / DAY_MS),
    };
  });

  // Everything the trials list does not already hold. An organization with no
  // trial and no suspension has nothing to show in that table, so this is
  // where the "start a trial" control finds it.
  const onTheClock = new Set(trialRows.map((r) => r.id));
  const startable = firms
    .filter((f) => !onTheClock.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, slug: f.slug }));
  const closedCount = trialRows.filter((r) => r.state === 'export_only').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          {firms.length} firm{firms.length === 1 ? '' : 's'} on Counsel
          {' · '}
          <span className="text-emerald-700 dark:text-emerald-300">{activeBilling} active</span>
          {pastDue > 0 && (
            <>
              {' · '}
              <span className="text-rose-700 dark:text-rose-300">{pastDue} past due</span>
            </>
          )}
        </p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          Billing snapshot reflects each firm owner's subscription. Per-firm billing arrives in
          a later phase.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-cream-100/70">
            Trials and access
          </h2>
          <p className="text-[12px] text-cream-100/55">
            {trialRows.length} on a clock
            {closedCount > 0 && ` · ${closedCount} export only`}
          </p>
        </div>
        <TrialConsole rows={trialRows} startable={startable} />
      </section>

      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-cream-100/70">
        All organizations
      </h2>

      {firms.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-600 dark:text-cream-100/70">
          No firms have been created yet. Outbound invitations and approved requests will land
          here once redeemed.
        </div>
      ) : (
        <div
          className="card overflow-x-auto overflow-y-hidden"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-ink-50 dark:bg-forest-900/50 border-b border-ink-200 dark:border-forest-700/40">
              <tr className="text-left">
                <Th>Firm</Th>
                <Th>Type</Th>
                <Th>Owner</Th>
                <Th>Plan</Th>
                <Th>Billing</Th>
                <Th>Members</Th>
                <Th>Clients</Th>
                <Th>Cases</Th>
                <Th>Subdomain</Th>
                <Th>Last activity</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
              {firms.map((f) => (
                <tr key={f.id} className="hover:bg-ink-50/40 dark:hover:bg-forest-800/30">
                  <Td>
                    <div className="flex items-center gap-2 relative">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: f.accentColor }}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-ink-950 dark:text-cream-100">
                          {f.name}
                        </div>
                        <div className="text-xs text-ink-500 dark:text-cream-100/55 font-mono">
                          /{f.slug}
                        </div>
                      </div>
                      <BrandingEditor
                        firmId={f.id}
                        firmName={f.name}
                        slug={f.slug}
                        logoUrl={f.logoUrl}
                        accentColor={f.accentColor}
                      />
                    </div>
                  </Td>
                  <Td className="text-xs text-ink-700 dark:text-cream-100/70">
                    {FIRM_TYPE_LABEL[f.firmType]}
                  </Td>
                  <Td>
                    <div className="text-ink-800 dark:text-cream-100/85 text-[13px]">
                      {f.ownerName ?? <span className="text-ink-400">-</span>}
                    </div>
                    {f.ownerEmail && (
                      <a
                        href={`mailto:${f.ownerEmail}`}
                        className="text-xs text-ink-500 dark:text-cream-100/55 hover:underline"
                      >
                        {f.ownerEmail}
                      </a>
                    )}
                    <div className="mt-1">
                      <ImpersonateOwnerButton
                        ownerUserId={f.ownerUserId}
                        firmName={f.name}
                        ownerEmail={f.ownerEmail}
                      />
                    </div>
                  </Td>
                  <Td className="text-xs">
                    {f.ownerPlan ? (
                      <span
                        className={`badge ${
                          f.ownerPlan === 'pro'
                            ? 'bg-gold-500 text-forest-950'
                            : f.ownerPlan === 'standard'
                              ? 'bg-forest-900 text-cream-200 dark:bg-white/15 dark:text-cream-100'
                              : 'bg-ink-100 text-ink-800 dark:bg-white/10 dark:text-cream-100/85'
                        }`}
                      >
                        {f.ownerPlan}
                      </span>
                    ) : (
                      <span className="text-ink-400">free</span>
                    )}
                  </Td>
                  <Td>
                    <BillingBadge status={f.ownerSubscriptionStatus} />
                  </Td>
                  <Td className="tabular-nums">{f.memberCount}</Td>
                  <Td className="tabular-nums">{f.clientCount}</Td>
                  <Td className="tabular-nums">{f.caseCount}</Td>
                  <Td>
                    <SubdomainToggle
                      firmId={f.id}
                      slug={f.slug}
                      enabled={f.subdomainEnabled}
                    />
                  </Td>
                  <Td className="text-xs text-ink-600 dark:text-cream-100/70">
                    {f.lastActivityAt ? (
                      <LocaleTime iso={f.lastActivityAt} mode="date" />
                    ) : (
                      <span className="text-ink-400">-</span>
                    )}
                  </Td>
                  <Td className="text-xs text-ink-600 dark:text-cream-100/70">
                    <LocaleTime iso={f.createdAt} mode="date" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-500 dark:text-cream-100/55">
        Need to bring on a new organization?{' '}
        <Link href="/admin/invitations" className="underline hover:text-ink-800 dark:hover:text-cream-100">
          Send an invitation
        </Link>{' '}
        or review pending{' '}
        <Link
          href="/admin/counsel-requests"
          className="underline hover:text-ink-800 dark:hover:text-cream-100"
        >
          access requests
        </Link>
        .
      </p>
    </div>
  );
}

function BillingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-400 text-xs">-</span>;
  const tone =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
      : status === 'trialing'
        ? 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-100'
        : status === 'past_due' || status === 'unpaid'
          ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
          : status === 'canceled' || status === 'inactive'
            ? 'bg-ink-100 text-ink-700 dark:bg-forest-800/40 dark:text-cream-100/70'
            : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-100';
  return <span className={`badge text-[10px] tracking-wider ${tone}`}>{status}</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
