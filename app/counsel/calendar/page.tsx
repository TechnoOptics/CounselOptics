import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { MeetingScheduler } from './MeetingScheduler';
import { MeetingConnectors } from '@/components/counsel/MeetingConnectors';
import { ExternalLink } from '@/components/ExternalLink';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · Counsel' };

type AgendaItem = {
  at: number;
  kind: 'meeting' | 'deadline' | 'reminder';
  title: string;
  sub: string;
  href: string;
};

const KIND_TONE: Record<AgendaItem['kind'], string> = {
  meeting: 'bg-gold-500/15 text-gold-700 dark:text-gold-200 ring-gold-500/30',
  deadline:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  reminder:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
};

export default async function CounselCalendarPage({
  searchParams,
}: {
  // The OAuth callback redirects here with ?connected=microsoft (or
  // zoom) on success and ?integration_error=... on failure. We
  // hand both to the connectors panel for the toast.
  searchParams?: { connected?: string; integration_error?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const admin = createAdminSupabase();
  const firmId = ctx.firm.id;
  const now = Date.now();
  const horizon = new Date(now - 24 * 3600_000).toISOString();

  const items: AgendaItem[] = [];
  const connected: Array<'microsoft' | 'zoom'> = [];

  if (admin) {
    // Which meeting providers are actually connected (drives the
    // Teams/Zoom chooser in the scheduler).
    const { data: integ } = await admin
      .from('firm_integrations')
      .select('provider')
      .eq('firm_id', firmId)
      .is('revoked_at', null);
    for (const r of (integ ?? []) as Array<{ provider: string }>) {
      if (
        (r.provider === 'microsoft' || r.provider === 'zoom') &&
        !connected.includes(r.provider)
      ) {
        connected.push(r.provider);
      }
    }

    // Scheduled Teams/Zoom meetings.
    const { data: meetings } = await admin
      .from('firm_meetings')
      .select('id, intake_id, topic, provider, start_at, duration_min, join_url')
      .eq('firm_id', firmId)
      .gte('start_at', horizon)
      .order('start_at', { ascending: true })
      .limit(200);
    for (const m of (meetings ?? []) as Array<{
      id: string;
      intake_id: string | null;
      topic: string;
      provider: string;
      start_at: string;
      duration_min: number;
      join_url: string;
    }>) {
      items.push({
        at: Date.parse(m.start_at),
        kind: 'meeting',
        title: m.topic,
        sub: `${m.provider === 'microsoft' ? 'Teams' : 'Zoom'} · ${m.duration_min} min`,
        href: m.intake_id ? `/counsel/intake/${m.intake_id}` : m.join_url,
      });
    }

    // Case deadlines + hearings.
    const { data: deadlines } = await admin
      .from('case_deadlines')
      .select('id, case_id, kind, title, due_at')
      .eq('firm_id', firmId)
      .is('completed_at', null)
      .gte('due_at', horizon)
      .order('due_at', { ascending: true })
      .limit(200);
    for (const d of (deadlines ?? []) as Array<{
      case_id: string;
      kind: string;
      title: string;
      due_at: string;
    }>) {
      items.push({
        at: Date.parse(d.due_at),
        kind: 'deadline',
        title: d.title,
        sub: d.kind.replace(/_/g, ' '),
        href: `/counsel/cases/${d.case_id}`,
      });
    }

    // Request/contract reminders.
    const { data: reminders } = await admin
      .from('firm_matter_intakes')
      .select('id, client_name, intake_answers')
      .eq('firm_id', firmId)
      .not('intake_answers->>reminder_at', 'is', null)
      .limit(200);
    for (const r of (reminders ?? []) as Array<{
      id: string;
      client_name: string;
      intake_answers: Record<string, unknown> | null;
    }>) {
      const at = Date.parse(
        String((r.intake_answers ?? {}).reminder_at ?? ''),
      );
      if (Number.isNaN(at) || at < now - 24 * 3600_000) continue;
      items.push({
        at,
        kind: 'reminder',
        title: r.client_name,
        sub: 'Request / contract due',
        href: `/counsel/intake/${r.id}`,
      });
    }
  }

  items.sort((a, b) => a.at - b.at);

  // Group by calendar day.
  const groups = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const key = new Date(it.at).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · calendar</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Calendar
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Everything the legal team needs to be ready for: scheduled
          Teams/Zoom meetings, case deadlines and hearings, and
          request/contract reminders - one agenda.
        </p>
      </header>

      <MeetingScheduler firmId={firmId} connected={connected} />

      {items.length === 0 ? (
        <p className="card p-6 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          Nothing on the calendar yet. Use &ldquo;Schedule
          meeting&rdquo; above, or add a deadline on a case.
        </p>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, dayItems]) => (
            <section key={day} className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-500 dark:text-cream-100/70">
                {day}
              </p>
              <ul className="space-y-2">
                {dayItems.map((it, i) => {
                  // A meeting without a linked intake points straight at
                  // the provider's external join URL; everything else is
                  // an in-app route. External URLs must open via
                  // ExternalLink so they work inside the native WebView.
                  const isExternal = /^https?:\/\//i.test(it.href);
                  const inner = (
                    <>
                      <div className="min-w-0">
                        <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                          {it.title}
                        </p>
                        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                          {new Date(it.at).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          · {it.sub}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${KIND_TONE[it.kind]}`}
                      >
                        {it.kind}
                      </span>
                    </>
                  );
                  return (
                    <li
                      key={`${day}-${i}`}
                      className="card p-4 hover:shadow-card-hover transition-all"
                    >
                      {isExternal ? (
                        <ExternalLink
                          href={it.href}
                          className="flex items-center justify-between gap-3"
                        >
                          {inner}
                        </ExternalLink>
                      ) : (
                        <Link
                          href={it.href}
                          className="flex items-center justify-between gap-3"
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Calendar + meeting providers (Microsoft 365, Zoom). Lived on
          its own page at /counsel/meetings before W20; merged here so
          a firm has one calendar surface instead of two. Placed at
          the bottom because it's a setup surface - the active agenda
          deserves the top of the page. */}
      <MeetingConnectors
        firmId={firmId}
        connected={searchParams?.connected}
        integrationError={searchParams?.integration_error}
      />
    </div>
  );
}
