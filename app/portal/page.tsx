import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { LocaleTime } from '@/components/LocaleTime';
import { ExternalLink } from '@/components/ExternalLink';
import { parseDueBy, isDueCurrent } from '@/lib/portal-due';

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

  const stats = [
    { label: 'Open requests', value: active.length, tone: 'slate' as const },
    {
      label: 'Awaiting you',
      value: awaitingYou.length,
      tone: awaitingYou.length > 0 ? ('gold' as const) : ('slate' as const),
    },
    {
      label: 'Due soon',
      value: dueSoon.length,
      tone: dueSoon.length > 0 ? ('amber' as const) : ('slate' as const),
    },
    {
      label: 'Meetings',
      value: upcomingMeetings.length,
      tone: 'slate' as const,
    },
  ];

  const hasAnything =
    intakes.length > 0 || upcomingMeetings.length > 0;

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name} · Client hub</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.015em] text-cream-100">
          Welcome back, {firstName}.
        </h1>
        <p className="text-sm text-cream-100/65 mt-1.5 max-w-2xl leading-relaxed">
          {awaitingYou.length > 0
            ? `${awaitingYou.length} ${
                awaitingYou.length === 1 ? 'request needs' : 'requests need'
              } your reply. Here's everything that wants your attention.`
            : "You're all caught up. Here's where everything stands."}
        </p>
      </header>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`popup-panel p-4 ring-1 ${
              s.tone === 'gold'
                ? 'ring-gold-500/40'
                : s.tone === 'amber'
                  ? 'ring-amber-700/40'
                  : 'ring-forest-700/40'
            }`}
          >
            <p className="text-[11px] uppercase tracking-[0.16em] text-cream-100/60">
              {s.label}
            </p>
            <p
              className={`font-display text-3xl mt-1.5 ${
                s.tone === 'gold'
                  ? 'text-gold-300'
                  : s.tone === 'amber'
                    ? 'text-amber-300'
                    : 'text-cream-100'
              }`}
            >
              {s.value}
            </p>
          </div>
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
        <div className="popup-panel p-8 text-center space-y-3">
          <p className="font-display text-xl text-cream-100">
            Nothing on your plate yet
          </p>
          <p className="text-[13px] text-cream-100/60 max-w-md mx-auto leading-relaxed">
            When you file a request, message legal, or have a meeting
            scheduled, it shows up here so you never miss a thing.
          </p>
          {canCreate && (
            <Link
              href="/portal/new"
              className="inline-block btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold mt-1"
            >
              File your first request
            </Link>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Needs your attention */}
          <section className="space-y-3">
            <h2 className="font-display text-lg text-cream-100">
              Needs your attention
            </h2>
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
                        <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ring-gold-500/40 bg-gold-500/15 text-gold-200">
                          Reply
                        </span>
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
            <h2 className="font-display text-lg text-cream-100">
              Coming up
            </h2>
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
                        <span
                          className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${
                            due < now
                              ? 'ring-rose-700/40 bg-rose-950/30 text-rose-200'
                              : 'ring-amber-700/40 bg-amber-950/30 text-amber-200'
                          }`}
                        >
                          {due < now ? 'Overdue' : 'Due'}
                        </span>
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
