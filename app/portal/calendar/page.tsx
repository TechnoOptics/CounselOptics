import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { LocaleTime } from '@/components/LocaleTime';
import { ExternalLink } from '@/components/ExternalLink';
import { parseDueBy, isDueCurrent } from '@/lib/portal-due';
import { visibleIntakeIds } from '@/lib/portal-scope';
import { PageHeader, EmptyState } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · Hub' };

export default async function HubCalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/calendar');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // The calendar is for in-house staff; external parties get a simpler hub.
  if (persona.external === true || !persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const admin = createAdminSupabase();
  type Item = { at: number; title: string; sub: string; href?: string; kind: 'meeting' | 'due' };
  const items: Item[] = [];
  if (admin) {
    // Yours and the ones you were invited onto - see lib/portal-scope.ts.
    const visible = await visibleIntakeIds(admin, user.id, persona.firm.id);
    const { data: intakes } = visible.length
      ? await admin
          .from('firm_matter_intakes')
          .select('id, client_name, matter_type, status, intake_answers')
          .eq('firm_id', persona.firm.id)
          .in('id', visible)
          .limit(100)
      : { data: [] };
    const rows = (intakes ?? []) as Array<{
      id: string;
      client_name: string;
      matter_type: string | null;
      status: string;
      intake_answers: Record<string, unknown> | null;
    }>;
    const now = Date.now();
    for (const r of rows) {
      if (r.status === 'rejected') continue;
      const due = parseDueBy(r.intake_answers);
      if (due !== null && isDueCurrent(due, now)) {
        items.push({
          at: due,
          kind: 'due',
          title: r.client_name,
          sub: `${r.matter_type ?? 'Request'} · due`,
          href: `/portal/${r.id}`,
        });
      }
    }
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const { data: mtg } = await admin
        .from('firm_meetings')
        .select('topic, provider, start_at, join_url')
        .eq('firm_id', persona.firm.id)
        .in('intake_id', ids)
        .gte('start_at', new Date(now - 3600_000).toISOString())
        .order('start_at', { ascending: true })
        .limit(30);
      for (const m of (mtg ?? []) as Array<{
        topic: string;
        provider: string;
        start_at: string;
        join_url: string;
      }>) {
        items.push({
          at: Date.parse(m.start_at),
          kind: 'meeting',
          title: m.topic,
          sub: `${m.provider === 'microsoft' ? 'Teams' : 'Zoom'} meeting`,
          href: m.join_url,
        });
      }
    }
  }
  items.sort((a, b) => a.at - b.at);

  return (
    <div className="space-y-7 animate-fade-up">
      <PageHeader
        eyebrow={persona.firm.name}
        title="Calendar"
        subtitle="Your meetings with legal and anything coming due, in one place."
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing scheduled yet"
          sub="When legal sets up a meeting or a due date on one of your requests, it shows here."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="popup-panel p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-cream-100 truncate">
                  {it.title}
                </p>
                <p className="text-[12px] text-cream-100/55 mt-0.5">
                  {it.sub} · <LocaleTime iso={new Date(it.at).toISOString()} mode="datetime" />
                </p>
              </div>
              {it.href &&
                (it.kind === 'meeting' ? (
                  <ExternalLink
                    href={it.href}
                    className="shrink-0 btn text-[12px] ring-1 ring-gold-500/40 text-gold-200 hover:bg-gold-500/10"
                  >
                    Join
                  </ExternalLink>
                ) : (
                  <a
                    href={it.href}
                    className="shrink-0 btn text-[12px] text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5"
                  >
                    Open
                  </a>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
