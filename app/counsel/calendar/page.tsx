import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { MeetingScheduler } from './MeetingScheduler';
import { MeetingConnectors } from '@/components/counsel/MeetingConnectors';
import { CalendarBoard, type BoardEvent } from './calendar-board';
import {
  fetchMicrosoftCalendarEvents,
  isCalendarSyncConfigured,
} from '@/lib/calendar-sync';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · Counsel' };

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
  // Widen the window vs. the old agenda so month navigation has data
  // on both sides: ~45 days back, ~120 days forward.
  const windowStart = now - 45 * 24 * 3600_000;
  const windowEnd = now + 120 * 24 * 3600_000;
  const horizon = new Date(windowStart).toISOString();

  const items: BoardEvent[] = [];
  const connected: Array<'microsoft' | 'zoom'> = [];
  const isExternal = (href: string) => /^https?:\/\//i.test(href);

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
      const mHref = m.intake_id
        ? `/counsel/intake/${m.intake_id}`
        : m.join_url;
      items.push({
        at: Date.parse(m.start_at),
        kind: 'meeting',
        title: m.topic,
        sub: `${m.provider === 'microsoft' ? 'Teams' : 'Zoom'} · ${m.duration_min} min`,
        href: mHref,
        external: isExternal(mHref),
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
        external: false,
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
        external: false,
      });
    }
  }

  // Pull the connected Microsoft 365 (Outlook) calendar in. Best-effort:
  // returns [] when Microsoft isn't configured or connected, so the
  // calendar still renders the in-app items.
  const syncOn = isCalendarSyncConfigured();
  const hasMicrosoft = connected.includes('microsoft');
  if (syncOn && hasMicrosoft) {
    const synced = await fetchMicrosoftCalendarEvents(
      firmId,
      windowStart,
      windowEnd,
    );
    for (const s of synced) {
      items.push({
        at: s.at,
        endAt: s.endAt,
        kind: 'synced',
        title: s.title,
        sub: s.location || 'Outlook',
        href: s.joinUrl || '#',
        external: Boolean(s.joinUrl),
      });
    }
  }

  items.sort((a, b) => a.at - b.at);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · calendar</T>}
        title={<T>Calendar</T>}
        subtitle={
          <>
            <T>
              One calendar for everything the legal team needs to be ready for:
              scheduled Teams/Zoom meetings, case deadlines and hearings,
              request/contract reminders
            </T>
            {hasMicrosoft ? <T>, and your connected Outlook events</T> : ''}
            <T>. Switch between month and agenda views.</T>
          </>
        }
      />

      <MeetingScheduler firmId={firmId} connected={connected} />

      <CalendarBoard events={items} hasSync={syncOn && hasMicrosoft} />

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
