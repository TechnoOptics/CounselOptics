import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmClients,
  listFirmInvitations,
  listFirmMembers,
  listFirmDocuments,
  listFirmSigningRequests,
  listMyFirms,
  listFirmCases,
} from '@/lib/firm-storage';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import { AskAdvottic } from '@/components/counsel/AskAdvottic';
import { DashboardCustomizer } from '@/components/counsel/DashboardCustomizer';
import {
  DashboardTileRenderer,
  type DashboardTileData,
} from '@/components/counsel/CounselDashboardTiles';
import { getCounselDashboardConfig } from '@/lib/counsel-dashboard';

export const dynamic = 'force-dynamic';

// Audit V5 CR-51: the counsel root used to inherit the consumer
// title template. Absolute title here bypasses the root template
// suffix so the firm portal tab reads cleanly.
export const metadata: Metadata = {
  title: { absolute: 'Dashboard · Advottic Counsel' },
  description:
    "Your firm cockpit: pick the tiles that matter to you, hide the rest.",
};

/**
 * /counsel - firm-side dashboard.
 *
 * Layout (top to bottom):
 *   1. Welcome banner ("Welcome to {firmName}") - always shown.
 *   2. Ask Advottic search bar - always shown.
 *   3. User-selected tiles - default is Action center + Assigned to
 *      me. The "Customize" button in the header lets the user pick
 *      any combination of tiles from the catalog in
 *      lib/counsel-dashboard.ts. Preferences persist in
 *      profiles.dashboard_preferences.
 *
 * If the signed-in user has no firms yet, redirect to the onboarding
 * wizard. The layout already handles the not-signed-in case.
 */
export default async function CounselDashboard() {
  const myFirms = await listMyFirms();
  if (myFirms.length === 0) redirect('/counsel/onboarding');
  const ctx = (await getActiveFirmContext()) ?? myFirms[0];
  if (!ctx) redirect('/counsel/onboarding');

  const user = await getCurrentUser();
  // Layout already redirects when there's no user, so this is just
  // a type narrowing rail.
  if (!user) redirect('/sign-in?next=/counsel');

  const supabase = createServerSupabase();
  const [
    clients,
    invitations,
    members,
    documents,
    signing,
    cases,
    profileRow,
  ] = await Promise.all([
    listFirmClients(ctx.firm.id),
    listFirmInvitations(ctx.firm.id),
    listFirmMembers(ctx.firm.id),
    listFirmDocuments(ctx.firm.id),
    listFirmSigningRequests(ctx.firm.id),
    listFirmCases(ctx.firm.id),
    supabase
      .from('profiles')
      .select('dashboard_preferences')
      .eq('id', user.id)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  const enabled = getCounselDashboardConfig(profileRow?.dashboard_preferences);
  const isAdmin =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';

  // Counts (mirror the old fixed grid).
  const openCaseStatuses = new Set([
    'open',
    'under_review',
    'needs_evidence',
    'export_ready',
  ]);
  const openActiveCases = cases.filter((c) => openCaseStatuses.has(c.status));
  const pendingSigning = signing.filter(
    (s) => s.status === 'sent' || s.status === 'partial',
  );
  const clientsActive = clients.filter((c) => c.status === 'active');

  // Intake lanes. Match the laneOf logic in IntakeInbox: "engaged" /
  // "accepted" -> Accepted, "rejected" -> Closed, "in_review" -> In
  // review, everything else -> Needs attention.
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const { data: intakeRows } = await supabase
    .from('firm_matter_intakes')
    .select(
      'id, client_name, matter_type, status, created_at, intake_answers',
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(200);
  type IntakeRow = {
    id: string;
    client_name: string | null;
    matter_type: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  };
  const intakes = (intakeRows ?? []) as IntakeRow[];
  const lanes = { needsAttention: 0, inReview: 0, accepted: 0, closed: 0 };
  let newToday = 0;
  for (const i of intakes) {
    if (i.status === 'engaged' || i.status === 'accepted') {
      lanes.accepted += 1;
    } else if (i.status === 'rejected') {
      lanes.closed += 1;
    } else if (i.status === 'in_review') {
      lanes.inReview += 1;
    } else {
      lanes.needsAttention += 1;
    }
    if (new Date(i.created_at).getTime() >= sinceMs) newToday += 1;
  }
  const recentNew = intakes.slice(0, 5).map((i) => ({
    id: i.id,
    clientName: i.client_name ?? 'Unnamed matter',
    matterType: i.matter_type,
    createdAt: i.created_at,
    isInternal:
      String((i.intake_answers ?? {}).submitted_by ?? '').trim().length > 0,
  }));

  // Assigned to me: clients where primary attorney == me, plus
  // cases linked to those clients via cases.client_id. The cases
  // table doesn't carry an explicit assignee, so client linkage is
  // the source of truth for "your work" - which matches how the
  // rest of the workspace already attributes matters.
  const myClients = clients.filter(
    (c) => c.primaryAttorneyId === user.id,
  );
  const myClientUserIds = new Set(myClients.map((c) => c.userId));
  // cases.user_id is the case owner (the consumer / client user
  // who started the case). Linking back to firm_clients.userId
  // gives us "this case belongs to my client."
  type CaseRowMin = {
    id: string;
    title: string;
    status: string;
    user_id: string | null;
  };
  const { data: caseRowsForClients } = await supabase
    .from('cases')
    .select('id, title, status, user_id')
    .eq('firm_id', ctx.firm.id);
  const myCases = ((caseRowsForClients ?? []) as CaseRowMin[]).filter(
    (c) => c.user_id && myClientUserIds.has(c.user_id),
  );

  // Signing requests the current user created that are still out.
  const mySigningOpen = signing.filter(
    (s) =>
      s.requestedBy === user.id &&
      (s.status === 'sent' || s.status === 'partial'),
  );
  const docById = new Map(documents.map((d) => [d.id, d.name] as const));
  const mineAwaiting = mySigningOpen.slice(0, 10).map((s) => ({
    id: s.id,
    documentTitle: docById.get(s.documentId) ?? null,
    createdAt: s.createdAt,
  }));

  // Upcoming meetings (next 14 days, top 5).
  const horizon = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const upperMeetings = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: meetingRows } = await supabase
    .from('firm_meetings')
    .select('id, topic, provider, start_at, join_url')
    .eq('firm_id', ctx.firm.id)
    .gte('start_at', horizon)
    .lte('start_at', upperMeetings)
    .order('start_at', { ascending: true })
    .limit(5);
  const meetings = ((meetingRows ?? []) as Array<{
    id: string;
    topic: string;
    provider: string;
    start_at: string;
    join_url: string | null;
  }>).map((m) => ({
    id: m.id,
    topic: m.topic,
    provider: m.provider,
    startAt: m.start_at,
    joinUrl: m.join_url,
  }));

  // Deadlines (open, due next 30 days, top 5).
  const upperDeadlines = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: dlRows } = await supabase
    .from('case_deadlines')
    .select('id, title, kind, due_at')
    .eq('firm_id', ctx.firm.id)
    .is('completed_at', null)
    .gte('due_at', horizon)
    .lte('due_at', upperDeadlines)
    .order('due_at', { ascending: true })
    .limit(5);
  const deadlines = ((dlRows ?? []) as Array<{
    id: string;
    title: string;
    kind: string;
    due_at: string;
  }>).map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    dueAt: d.due_at,
  }));

  const recentUploads = documents.slice(0, 5).map((d) => ({
    id: d.id,
    title: d.name,
    uploadedAt: d.uploadedAt,
  }));

  const data: DashboardTileData = {
    firmId: ctx.firm.id,
    firmName: ctx.firm.name,
    accent: ctx.firm.accentColor,
    userId: user.id,
    userDisplayName:
      ctx.membership.displayName ?? ctx.membership.email ?? 'there',
    isAdmin,
    counts: {
      casesOpen: openActiveCases.length,
      casesTotal: cases.length,
      clients: clients.length,
      clientsActive: clientsActive.length,
      members: members.length,
      invitations: invitations.length,
      documents: documents.length,
      signingPending: pendingSigning.length,
    },
    intake: {
      needsAttention: lanes.needsAttention,
      inReview: lanes.inReview,
      accepted: lanes.accepted,
      closed: lanes.closed,
      newToday,
      recentNew,
    },
    assigned: {
      cases: myCases.slice(0, 10).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      })),
      clients: myClients.slice(0, 10).map((c) => ({
        id: c.id,
        displayName: c.displayName ?? c.email ?? 'Unnamed client',
        status: c.status,
      })),
    },
    signing: { mineAwaiting },
    meetings,
    deadlines,
    recentUploads,
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Welcome - always at the top. */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="eyebrow mb-2">Counsel</p>
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Welcome to {ctx.firm.name}.
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-2xl leading-relaxed">
            You&rsquo;re signed in as{' '}
            {ctx.membership.displayName ??
              ctx.membership.email ??
              'a team member'}{' '}
            ({FIRM_ROLE_LABEL[ctx.membership.role].toLowerCase()}). Pick
            the tiles that matter to you - hide the rest.
          </p>
        </div>
        <DashboardCustomizer initialEnabled={enabled} isAdmin={isAdmin} />
      </header>

      {/* Ask Advottic - immediately below the welcome. */}
      <AskAdvottic />

      {/* User-selected tiles. Empty state gives a hint about the
          customizer when the user has hidden everything. */}
      {enabled.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-[13px] text-cream-100/65 leading-relaxed">
            Your dashboard is empty. Click{' '}
            <strong>Customize dashboard</strong> up top to add tiles -
            action center, assigned to me, cases, clients, meetings,
            and more.
          </p>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {enabled.map((id) => (
            <DashboardTileRenderer key={id} id={id} data={data} />
          ))}
        </section>
      )}
    </div>
  );
}
