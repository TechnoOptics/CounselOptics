import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { LocaleTime } from '@/components/LocaleTime';
import { ExternalLink } from '@/components/ExternalLink';
import { parseDueBy, isDueCurrent } from '@/lib/portal-due';
import { PageHeader, SectionTitle, StatCard, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · Hub' };

type IntakeRow = {
  id: string;
  client_name: string;
  matter_type: string | null;
  status: string;
  created_at: string;
  intake_answers: Record<string, unknown> | null;
};

const ACTIVE = (s: string) => s !== 'rejected';

export default async function PortalDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const firstName = (persona.employee.displayName || persona.employee.email || 'there')
    .split(/[\s@.]/)[0]
    .replace(/^./, (c) => c.toUpperCase());
  const canCreate = persona.entitlements.includes('requests.create');
  // External parties (can't file requests, or previewing as vendor) get a
  // simple hub: no AI review, no request-filing. Only status + documents.
  const externalView = persona.external === true || !canCreate;
  const canReview = persona.entitlements.includes('review') && !externalView;

  const admin = createAdminSupabase();
  let intakes: IntakeRow[] = [];
  let meetings: Array<{
    topic: string;
    provider: string;
    start_at: string;
    join_url: string;
    intake_id: string | null;
  }> = [];
  if (admin) {
    const { data } = await admin
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at, intake_answers')
      .eq('firm_id', persona.firm.id)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    intakes = (data ?? []) as IntakeRow[];

    const ids = intakes.map((i) => i.id);
    if (ids.length > 0) {
      const { data: mtg } = await admin
        .from('firm_meetings')
        .select('topic, provider, start_at, join_url, intake_id')
        .eq('firm_id', persona.firm.id)
        .in('intake_id', ids)
        .gte('start_at', new Date(Date.now() - 3600_000).toISOString())
        .order('start_at', { ascending: true })
        .limit(10);
      meetings = (mtg ?? []) as typeof meetings;
    }
  }

  const now = Date.now();
  const lastRole = (r: IntakeRow): string | null => {
    const t = (r.intake_answers ?? {}).thread;
    if (!Array.isArray(t) || t.length === 0) return null;
    const last = t[t.length - 1] as { role?: string };
    return last?.role ?? null;
  };
  const active = intakes.filter((r) => ACTIVE(r.status));
  const awaitingYou = active.filter((r) => lastRole(r) === 'legal');
  const dueSoon = active
    .map((r) => ({ r, due: parseDueBy(r.intake_answers) }))
    .filter(
      (x): x is { r: IntakeRow; due: number } =>
        x.due !== null && isDueCurrent(x.due, now),
    )
    .sort((a, b) => a.due - b.due);
  const upcomingMeetings = meetings.filter(
    (m) => Date.parse(m.start_at) >= now - 3600_000,
  );

  // A stat is coloured only when its number is asking for something.
  // At zero every tile reads neutral, so the ones that are not zero are
  // the ones the eye lands on.
  const stats = [
    { label: 'Open requests', value: active.length },
    {
      label: 'Awaiting you',
      value: awaitingYou.length,
      color: awaitingYou.length > 0 ? PILL_COLORS.gold : undefined,
    },
    {
      label: 'Due soon',
      value: dueSoon.length,
      color: dueSoon.length > 0 ? PILL_COLORS.waiting : undefined,
    },
    { label: 'Meetings', value: upcomingMeetings.length },
  ];

  const hasAnything =
    intakes.length > 0 || upcomingMeetings.length > 0;

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        size="lg"
        eyebrow={`${persona.firm.name} · Client hub`}
        title={`Welcome back, ${firstName}.`}
        subtitle={
          awaitingYou.length > 0
            ? `${awaitingYou.length} ${
                awaitingYou.length === 1 ? 'request needs' : 'requests need'
              } your reply. Here's everything that wants your attention.`
            : "You're all caught up. Here's where everything stands."
        }
      />

      {/* Stat tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            color={s.color}
          />
        ))}
      </section>

      {/* Quick actions */}
      <section className="flex flex-wrap gap-3">
        {canCreate && (
          <Link
            href="/portal/new"
            className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold"
          >
            New request
          </Link>
        )}
        <Link
          href="/portal/requests"
          className="btn ring-1 ring-forest-700/40 text-cream-100/85 hover:text-cream-100 hover:bg-cream-100/5"
        >
          View all requests
        </Link>
        {canReview && (
          <Link
            href="/review-my-document"
            className="btn ring-1 ring-forest-700/40 text-cream-100/85 hover:text-cream-100 hover:bg-cream-100/5"
          >
            Run Advottic Review
          </Link>
        )}
      </section>

      {!hasAnything ? (
        <EmptyState
          title="Nothing on your plate yet"
          sub="When you file a request, message legal, or have a meeting scheduled, it shows up here so you never miss a thing."
          action={
            canCreate ? (
              <Link
                href="/portal/new"
                className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold"
              >
                File your first request
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Needs your attention */}
          <section className="space-y-3">
            <SectionTitle>Needs your attention</SectionTitle>
            {awaitingYou.length === 0 ? (
              <p className="popup-panel p-5 text-[13px] text-cream-100/55 italic">
                Nothing waiting on you. Legal will ping you here when
                they need something.
              </p>
            ) : (
              <ul className="space-y-2">
                {awaitingYou.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/portal/${r.id}`}
                      className="block popup-panel p-4 hover:bg-cream-100/[0.03] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-cream-100 truncate">
                          {r.client_name}
                        </p>
                        <StatusPill size="sm">Reply</StatusPill>
                      </div>
                      <p className="text-[12px] text-cream-100/55 mt-1">
                        {r.matter_type ?? 'Request'} · legal responded
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Coming up */}
          <section className="space-y-3">
            <SectionTitle>Coming up</SectionTitle>
            {upcomingMeetings.length === 0 && dueSoon.length === 0 ? (
              <p className="popup-panel p-5 text-[13px] text-cream-100/55 italic">
                No deadlines or meetings on the horizon.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcomingMeetings.slice(0, 4).map((m, i) => (
                  <li
                    key={`m-${i}`}
                    className="popup-panel p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-cream-100 truncate">
                        {m.topic}
                      </p>
                      <p className="text-[12px] text-cream-100/55 mt-0.5">
                        {m.provider === 'microsoft' ? 'Teams' : 'Zoom'} ·{' '}
                        <LocaleTime iso={m.start_at} mode="datetime" />
                      </p>
                    </div>
                    <ExternalLink
                      href={m.join_url}
                      className="shrink-0 btn text-[12px] ring-1 ring-gold-500/40 text-gold-200 hover:bg-gold-500/10"
                    >
                      Join
                    </ExternalLink>
                  </li>
                ))}
                {dueSoon.slice(0, 4).map(({ r, due }) => (
                  <li key={`d-${r.id}`}>
                    <Link
                      href={`/portal/${r.id}`}
                      className="block popup-panel p-4 hover:bg-cream-100/[0.03] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-cream-100 truncate">
                          {r.client_name}
                        </p>
                        <StatusPill
                          size="sm"
                          color={
                            due < now ? PILL_COLORS.flagged : PILL_COLORS.waiting
                          }
                        >
                          {due < now ? 'Overdue' : 'Due'}
                        </StatusPill>
                      </div>
                      <p className="text-[12px] text-cream-100/55 mt-1">
                        {r.matter_type ?? 'Request'} · due{' '}
                        <LocaleTime
                          iso={new Date(due).toISOString()}
                          mode="date"
                        />
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
