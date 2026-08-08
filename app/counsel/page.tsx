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
import { tallyIntakeLanes } from '@/lib/intake-lanes';
import { PageHeader, EmptyState, StatCard } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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
 *   2. The metric strip - four headline counts, always shown. See the
 *      comment on it for which query produces each one.
 *   3. Ask Advottic search bar - always shown.
 *   4. User-selected tiles - default is Action center + Assigned to
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

  // Intake lanes come from lib/intake-lanes, the one definition the inbox
  // lanes and the Impact "Open requests" KPI also use. This block used to
  // hand-roll the map and tested for a status named `in_review` that the
  // schema has never allowed, so every conflict-cleared request landed in
  // "needs attention" and the dashboard reported 5 where the inbox showed 4.
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
  const tally = tallyIntakeLanes(intakes.map((i) => i.status));
  const lanes = {
    needsAttention: tally.attention,
    inReview: tally.review,
    accepted: tally.accepted,
    closed: tally.closed,
  };
  let newToday = 0;
  for (const i of intakes) {
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

  // Assigned to me: matters whose first-class assignee is the
  // signed-in attorney (cases.assigned_to), plus clients where they
  // are the primary attorney. Previously "my matters" was inferred
  // indirectly (firm_clients.primary_attorney_id -> the client's user
  // -> cases.user_id) because cases carried no assignee; the real
  // assigned_to column (migration 2026-07-07-case-assignee) makes this
  // a direct query. Left null-tolerant: a null result (e.g. before the
  // column exists on an older DB) yields an empty lane, never a throw.
  const myClients = clients.filter(
    (c) => c.primaryAttorneyId === user.id,
  );
  type CaseRowMin = {
    id: string;
    title: string;
    status: string;
  };
  const { data: assignedCaseRows } = await supabase
    .from('cases')
    .select('id, title, status')
    .eq('firm_id', ctx.firm.id)
    .eq('assigned_to', user.id)
    .order('updated_at', { ascending: false });
  const myCases = (assignedCaseRows ?? []) as CaseRowMin[];

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
      <PageHeader
        size="lg"
        eyebrow={<T>Counsel</T>}
        title={<><T>Welcome to</T> {ctx.firm.name}.</>}
        subtitle={
          <>
            <T>You&rsquo;re signed in as</T>{' '}
            {ctx.membership.displayName ??
              ctx.membership.email ??
              'a team member'}{' '}
            ({FIRM_ROLE_LABEL[ctx.membership.role].toLowerCase()}).{' '}
            <T>Pick the tiles that matter to you - hide the rest.</T>
          </>
        }
      />

      {/*
        The metric strip the dashboard pattern leads with. Four numbers
        only, and every one of them is the length of a set this page
        already read in full:

          Open matters      listFirmCases, filtered by openCaseStatuses
          Out for signature listFirmSigningRequests, status sent|partial
          Active clients    listFirmClients, status active
          Documents         listFirmDocuments

        The intake lane counts are deliberately NOT here, though the
        action-center tile below shows them: they are tallied from a
        firm_matter_intakes read capped at 200 rows, so on a busy firm
        the number would be a floor rather than a count. A headline
        metric has to be the whole set.
      */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={<T>Open matters</T>}
          value={openActiveCases.length}
          sub={
            <>
              {cases.length} <T>at the firm in total</T>
            </>
          }
          color="var(--accent-text)"
        />
        <StatCard
          // "Out for signature" wrapped to a second line at strip width
          // and dropped its number below the other three, which is the
          // one thing a row of metrics must not do.
          label={<T>Signatures out</T>}
          value={pendingSigning.length}
          sub={
            <>
              {signing.length} <T>signature requests sent</T>
            </>
          }
          // Amber only when something is actually waiting. A zero here
          // is the good state and must not be painted as a warning.
          color={pendingSigning.length > 0 ? 'var(--warn-text)' : undefined}
        />
        <StatCard
          label={<T>Active clients</T>}
          value={clientsActive.length}
          sub={
            <>
              {clients.length} <T>on the books</T>
            </>
          }
        />
        <StatCard
          label={<T>Documents</T>}
          value={documents.length}
          sub={<T>held for this firm</T>}
        />
      </section>

      {/* Ask Advottic - below the strip. */}
      <AskAdvottic />

      {/* Customize button - sits between the Ask bar (with its
          suggestion chips) and the tile grid, so the user reads
          welcome -> ask -> suggestions -> "what's on my board" -> tiles. */}
      <div className="flex justify-end">
        <DashboardCustomizer initialEnabled={enabled} isAdmin={isAdmin} />
      </div>

      {/* User-selected tiles. Empty state gives a hint about the
          customizer when the user has hidden everything. */}
      {enabled.length === 0 ? (
        <EmptyState
          title={<T>Your dashboard is empty</T>}
          sub={
            <>
              <T>Click</T>{' '}
              <strong><T>Customize dashboard</T></strong>{' '}
              <T>
                up top to add tiles - action center, assigned to me,
                cases, clients, meetings, and more.
              </T>
            </>
          }
        />
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
