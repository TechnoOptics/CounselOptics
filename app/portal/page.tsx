import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { LocaleTime } from '@/components/LocaleTime';
import { ExternalLink } from '@/components/ExternalLink';
import { parseDueBy } from '@/lib/portal-due';
import { loadPortalOpenRequests } from '@/lib/portal-open-requests';
import { SectionTitle, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  HelpTiles,
  UtilityTiles,
  type UtilityTile,
} from '@/components/portal/HelpTiles';
import {
  DocIcon,
  MagnifyIcon,
  SparkIcon,
  TemplateIcon,
} from '@/components/counsel/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · Hub' };

/**
 * The employee hub's home.
 *
 * The page answers one question, which is the question an employee
 * actually arrives with: who do I tell about this, and is the thing I
 * already told them about moving. So it opens with their name and one
 * true line about their own requests, gives them a way to find one, and
 * then offers four ways in.
 *
 * EVERY NUMBER ON THIS PAGE IS A REAL NUMBER. The tile counts, the rail
 * badges and the banner in the shell all come from
 * lib/portal-open-requests.ts, computed once per request, so they
 * cannot contradict each other in the same viewport. A tile's action
 * link changes with that count: it offers to START something when this
 * person has nothing open in that family, and to OPEN what they have
 * when they do, which is the only wording that is true in both states.
 */

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

  // The same read the shell used for its rail badges and its banner.
  // React's per-request memo means this is the same round trip, not a
  // second one, and the same numbers rather than a second opinion.
  const requests = await loadPortalOpenRequests(user.id, persona.firm.id);
  const { open, awaitingYou, dueSoon, overdue, byFamily } = requests;

  const admin = createAdminSupabase();
  let meetings: Array<{
    topic: string;
    provider: string;
    start_at: string;
    join_url: string;
    intake_id: string | null;
  }> = [];
  const ids = requests.rows.map((r) => r.id);
  if (admin && ids.length > 0) {
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

  // One honest line about where this person stands. It says what is
  // true and stops; it does not congratulate anybody.
  const stateLine =
    open.length === 0
      ? 'Nothing is open with your legal team right now.'
      : awaitingYou.length > 0
        ? `You have ${open.length} ${open.length === 1 ? 'request' : 'requests'} open with your legal team, and ${awaitingYou.length === 1 ? 'one is' : `${awaitingYou.length} are`} waiting on you.`
        : `You have ${open.length} ${open.length === 1 ? 'request' : 'requests'} open with your legal team.`;

  // The smaller row: everything an employee can do here that is not
  // filing a request. Each one is gated on the same entitlement the
  // rail gates its nav row on, so nothing appears that cannot be used.
  const utilities = [
    !externalView && {
      href: '/portal/forms',
      icon: <TemplateIcon />,
      label: 'Forms',
      line: 'Fill in and sign a document legal has published.',
    },
    !externalView && {
      href: '/portal/check',
      icon: <MagnifyIcon />,
      label: 'Check a document',
      line: 'Score a draft against your company policies.',
    },
    {
      href: '/portal/documents',
      icon: <DocIcon />,
      label: 'Documents',
      line: 'Every file on your requests, to read or download.',
    },
    canReview && {
      href: '/review-my-document',
      icon: <SparkIcon />,
      label: 'Advottic Review',
      line: 'Read a document back with the risky wording flagged.',
    },
  ].filter(Boolean) as UtilityTile[];

  const nothingAtAll =
    requests.rows.length === 0 && meetings.length === 0 && externalView;

  return (
    <div className="space-y-9 animate-fade-up">
      <header className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted">
          <span data-no-translate>{persona.firm.name}</span>
        </p>
        <h1 className="mt-1.5 break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl">
          Hello, <span data-no-translate>{firstName}</span>
        </h1>
        <p className="mt-2 text-sm text-muted">{stateLine}</p>
      </header>

      {!externalView && (
        <section className="card p-5">
          <label
            htmlFor="portal-request-search"
            className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-muted"
          >
            Find one of your requests
          </label>
          <form
            action="/portal/requests"
            method="GET"
            className="mt-2.5 flex flex-wrap items-center gap-2"
          >
            <input
              id="portal-request-search"
              name="q"
              type="search"
              autoComplete="off"
              className="input min-w-0 flex-1"
              placeholder="Northwind NDA, litigation hold, the vendor contract from March"
            />
            <button
              type="submit"
              className="btn font-semibold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-on)',
              }}
            >
              Search
            </button>
          </form>
          <p className="mt-2 text-[12px] text-muted">
            Searches the name, the type and the priority of every request you
            filed or were invited onto.
          </p>
        </section>
      )}

      {!externalView && canCreate && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle variant="display">Who can help you?</SectionTitle>
            <Link
              href="/portal/new"
              className="text-[12.5px] text-muted underline transition-colors hover:text-foreground"
            >
              Not sure? Start here
            </Link>
          </div>

          <HelpTiles openByFamily={byFamily} />
        </section>
      )}

      <UtilityTiles tiles={utilities} />

      {nothingAtAll ? (
        <EmptyState
          title="Nothing on your plate yet"
          sub="When legal shares a document or schedules something with you, it shows up here."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3">
            <SectionTitle>Needs your attention</SectionTitle>
            {awaitingYou.length === 0 ? (
              <p className="rounded-xl border border-edge bg-surface p-5 text-[13px] text-muted">
                Nothing waiting on you. Legal will ask you here when they need
                something.
              </p>
            ) : (
              <ul className="space-y-2">
                {awaitingYou.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/portal/${r.id}`}
                      className="block rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-edge-bright"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className="truncate font-semibold text-foreground"
                          data-no-translate
                        >
                          {String(
                            (r.intake_answers ?? {}).subject ?? '',
                          ).trim() ||
                            r.matter_type ||
                            r.client_name}
                        </p>
                        <StatusPill size="sm">Reply</StatusPill>
                      </div>
                      <p className="mt-1 text-[12px] text-muted">
                        <span data-no-translate>
                          {r.matter_type ?? 'Request'}
                        </span>
                        {' · legal responded'}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle>Coming up</SectionTitle>
            {meetings.length === 0 &&
            dueSoon.length === 0 &&
            overdue.length === 0 ? (
              <p className="rounded-xl border border-edge bg-surface p-5 text-[13px] text-muted">
                No deadlines or meetings on the horizon.
              </p>
            ) : (
              <ul className="space-y-2">
                {meetings.slice(0, 4).map((m, i) => (
                  <li
                    key={`m-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface p-4"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate font-semibold text-foreground"
                        data-no-translate
                      >
                        {m.topic}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {m.provider === 'microsoft' ? 'Teams' : 'Zoom'} ·{' '}
                        <LocaleTime iso={m.start_at} mode="datetime" />
                      </p>
                    </div>
                    <ExternalLink
                      href={m.join_url}
                      className="btn shrink-0 border border-edge text-[12px] text-accent-text"
                    >
                      Join
                    </ExternalLink>
                  </li>
                ))}
                {[...overdue, ...dueSoon].slice(0, 4).map((r) => {
                  const due = parseDueBy(r.intake_answers);
                  const late = due != null && due < Date.now();
                  return (
                    <li key={`d-${r.id}`}>
                      <Link
                        href={`/portal/${r.id}`}
                        className="block rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-edge-bright"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className="truncate font-semibold text-foreground"
                            data-no-translate
                          >
                            {String(
                              (r.intake_answers ?? {}).subject ?? '',
                            ).trim() ||
                              r.matter_type ||
                              r.client_name}
                          </p>
                          <StatusPill
                            size="sm"
                            color={
                              late ? PILL_COLORS.flagged : PILL_COLORS.waiting
                            }
                          >
                            {late ? 'Overdue' : 'Due'}
                          </StatusPill>
                        </div>
                        <p className="mt-1 text-[12px] text-muted">
                          <span data-no-translate>
                            {r.matter_type ?? 'Request'}
                          </span>
                          {due != null && (
                            <>
                              {' · due '}
                              <LocaleTime
                                iso={new Date(due).toISOString()}
                                mode="date"
                              />
                            </>
                          )}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
