import type { Metadata } from 'next';
import Link from 'next/link';
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
import { createAdminSupabase } from '@/lib/supabase/admin';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import { AskAdvottic } from '@/components/counsel/AskAdvottic';
import { DashboardCustomizer } from '@/components/counsel/DashboardCustomizer';
import {
  CounselMetricBoard,
  DashboardTileRenderer,
  type DashboardTileData,
} from '@/components/counsel/CounselDashboardTiles';
import { getCounselDashboardConfig } from '@/lib/counsel-dashboard';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { AGING_DAYS } from '@/lib/approval-queue';
import type { MatterRow } from '@/lib/matter-list';
import {
  buildCounselMetricBands,
  clientsHref,
  matterCountFor,
} from '@/lib/counsel-metrics';
import { intakeLaneFilter, type IntakeLane } from '@/lib/intake-lanes';
import { PageHeader, EmptyState, StatCard } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

/**
 * A headline metric, wrapped so the whole card opens the list behind it.
 *
 * StatCard takes no href on purpose (see the note on it in
 * components/counsel/ui.tsx), so the link goes around it. `rounded-xl`
 * matches the card's own radius so the focus ring traces the card rather
 * than a rectangle around it, and the ring is on the link because that is
 * the element that takes focus.
 */
function StripLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
    >
      {children}
    </Link>
  );
}

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
 * The dashboard shape from docs/PARITY-PAGE-RULES.md: a strip of metric
 * cards across the top, then a grid of cards, with nothing competing
 * with the strip.
 *
 * Layout (top to bottom):
 *   1. Welcome header ("Welcome to {firmName}"), carrying the
 *      "Customize dashboard" button as its top-right action.
 *   2. The metric strip - four headline counts, always shown. See the
 *      comment on it for which query produces each one.
 *   3. Ask Advottic search bar - always shown.
 *   4. User-selected tiles - default is Action center + Assigned to
 *      me. The "Customize" button lets the user pick any combination
 *      of tiles from the catalog in lib/counsel-dashboard.ts.
 *      Preferences persist in profiles.dashboard_preferences.
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
    surfaces,
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
    // Whether this firm shows time, billing and trust at all. Two board
    // figures open /counsel/billing, and that page redirects to /counsel
    // when the toggle is on, so under it the figures are not shown rather
    // than shown as a dead click.
    getFirmSurfaceSettings(ctx.firm.id, ctx.firm),
  ]);

  // What this kind of legal team calls things. One lookup, at the top, rather
  // than a type check at each tile that needs a noun.
  const vocab = firmVocabulary(surfaces.firmType);

  const enabled = getCounselDashboardConfig(profileRow?.dashboard_preferences);
  const isAdmin =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';

  // ---- Matters -------------------------------------------------------
  //
  // Every matter figure on this page - the headline count and the three on
  // the board - is produced by lib/counsel-metrics.ts, which runs the
  // CASELOAD PAGE'S OWN `parseMatterListParams` + `filterMatters` over the
  // query string the tile links at. That is what makes a tile's number and
  // its destination agree by construction rather than by promise.
  //
  // It used to be a set of four "active" statuses written here, and that set
  // left `draft` out while /counsel/cases counts a draft as live, so a firm
  // with one draft matter read one number on this page and a bigger one on
  // the page the tile opened.
  //
  // Only the four fields the filters actually read are mapped from a real
  // value. The text fields exist because MatterRow has them, and
  // filterMatters never looks at them here: the search, matter and ref
  // predicates are all guarded on a non-empty needle, and none of these
  // queries carries one.
  const matterRows: MatterRow[] = cases.map((c) => ({
    id: c.id,
    matterNumber: null,
    title: '',
    subjectName: '',
    caseType: '',
    status: c.status,
    statusLabel: '',
    statusColor: '',
    assignedTo: c.assignedTo ?? null,
    assigneeLabel: null,
    hearingAt: c.hearingAt ?? null,
    updatedAt: c.updatedAt,
  }));
  const openMatters = matterCountFor(matterRows, '', user.id);

  const pendingSigning = signing.filter(
    (s) => s.status === 'sent' || s.status === 'partial',
  );
  const clientsActive = clients.filter((c) => c.status === 'active');

  // Intake lanes come from lib/intake-lanes, the one definition the inbox
  // lanes and the Impact "Open requests" KPI also use. This block used to
  // hand-roll the map and tested for a status named `in_review` that the
  // schema has never allowed, so every conflict-cleared request landed in
  // "needs attention" and the dashboard reported 5 where the inbox showed 4.
  //
  // Every lane figure below is a COUNT, so every one of them is its own
  // `count: 'exact'` query. They used to be tallied in JS over a read
  // capped at 200 rows, which turned each lane into a floor the moment a
  // firm passed its 200th request, and the action center then added those
  // floors together and called the result "N things need a human". The
  // shape here is the one app/counsel/billing already uses for
  // Outstanding: the rows you draw and the total you state are two
  // different queries, because only one of them can be bounded.
  //
  // The lane split is still lib/intake-lanes.ts and nothing else. See
  // intakeLaneFilter for why "needs attention" is the complement of the
  // other three rather than a list of its own.
  const intakeCount = (lane: IntakeLane) => {
    const filter = intakeLaneFilter(lane);
    const q = supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firm.id);
    return filter.op === 'in'
      ? q.in('status', filter.statuses)
      : q.or(`status.is.null,status.not.in.(${filter.statuses.join(',')})`);
  };
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [
    attentionRes,
    reviewRes,
    acceptedRes,
    closedRes,
    newTodayRes,
    recentRes,
  ] = await Promise.all([
    intakeCount('attention'),
    intakeCount('review'),
    intakeCount('accepted'),
    intakeCount('closed'),
    supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firm.id)
      .gte('created_at', sinceIso),
    // The one intake read that is meant to be bounded, because it is a
    // list of the five most recent and not a total of anything.
    supabase
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, created_at, intake_answers')
      .eq('firm_id', ctx.firm.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);
  const lanes = {
    needsAttention: attentionRes.count ?? 0,
    inReview: reviewRes.count ?? 0,
    accepted: acceptedRes.count ?? 0,
    closed: closedRes.count ?? 0,
  };
  const newToday = newTodayRes.count ?? 0;
  const recentNew = ((recentRes.data ?? []) as Array<{
    id: string;
    client_name: string | null;
    matter_type: string | null;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  }>).map((i) => ({
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
  //
  // A count, over the whole set. listFirmSigningRequests is unbounded, so
  // this is the real number. It used to be handed down as an array sliced
  // to ten whose rows nothing rendered, and the action center read that
  // array's LENGTH: an attorney with fifteen chase-ups was told about ten
  // of them, and ten is what went into "N things need a human".
  const mineAwaitingCount = signing.filter(
    (s) =>
      s.requestedBy === user.id &&
      (s.status === 'sent' || s.status === 'partial'),
  ).length;

  // Upcoming meetings (next 14 days, top 5).
  //
  // Read with the SERVICE-ROLE client, not the user-scoped one above.
  // firm_meetings has RLS enabled and no policies at all, so a user-scoped
  // select on it comes back empty for every caller and every firm, and an
  // empty result is indistinguishable from a firm with nothing booked. This
  // tile therefore said "Nothing on the calendar" and offered to connect
  // Microsoft 365 while /counsel/calendar, which already reads the table
  // through the admin client, showed the same firm its meetings.
  //
  // Service-role is the table's design, not a workaround: every other reader
  // of firm_meetings (the calendar page, /portal, /portal/calendar, both
  // Bella loaders) goes through it, and every writer does too.
  //
  // Authorization for this read is `ctx`, resolved above by
  // getActiveFirmContext() (falling back to listMyFirms()[0]), both of which
  // return a firm ONLY after reading the caller's own firm_members row
  // through the user-scoped client. ctx.firm.id is therefore a firm this
  // caller belongs to; it never comes from the request. A second membership
  // query here would be a third read of the row we just read.
  const horizon = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const upperMeetings = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const admin = createAdminSupabase();
  const { data: meetingRows } = admin
    ? await admin
        .from('firm_meetings')
        .select('id, topic, provider, start_at, join_url')
        .eq('firm_id', ctx.firm.id)
        .gte('start_at', horizon)
        .lte('start_at', upperMeetings)
        .order('start_at', { ascending: true })
        .limit(5)
    : { data: null };
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

  // ---- The metric board ----------------------------------------------
  //
  // Everything below is a COUNT of a whole set. Nothing here is a
  // `.slice().length` and nothing is the length of a capped read: the three
  // list helpers it counts over (listFirmSigningRequests, listFirmDocuments,
  // listFirmClients) carry no `.limit()`, and the two figures that cannot be
  // taken from a list this page already holds are `count: 'exact'` queries.
  //
  // Each figure's predicate is the predicate of the page it opens, restated
  // here because those pages keep theirs as module-local functions. The
  // restatements are pinned to those files' source text by
  // tests/counsel-dashboard-drilldown.test.ts, so a change on either side
  // goes red rather than quietly making two screens disagree.

  // Approvals. firm_template_submissions is read through the SERVICE-ROLE
  // client for the same reason /counsel/forms/approvals reads it that way:
  // the queue is a firm-wide surface and its RLS is not written for a
  // firm-wide reader. Authorization for the read is `ctx`, resolved at the
  // top of this function from the caller's own firm_members row through the
  // user-scoped client, so ctx.firm.id is a firm this caller belongs to and
  // never comes from the request.
  const agingBefore = new Date(
    Date.now() - AGING_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [approvalsWaitingRes, approvalsAgingRes] = admin
    ? await Promise.all([
        admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', ctx.firm.id)
          .eq('status', 'pending'),
        admin
          .from('firm_template_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', ctx.firm.id)
          .eq('status', 'pending')
          .lte('submitted_at', agingBefore),
      ])
    : [{ count: null }, { count: null }];

  // Signing. The two views /counsel/signing offers for work in flight.
  const signingOut = pendingSigning.length;
  const signingAttention = signing.filter(
    (s) => s.status === 'rejected' || s.status === 'changes_requested',
  ).length;

  // Documents. `overdue` and `unfiled` as /counsel/documents reads them:
  // past due and not resolved, and not attached to a matter.
  const nowMs = Date.now();
  const documentsOverdue = documents.filter(
    (d) =>
      Boolean(d.dueAt) &&
      new Date(d.dueAt as string).getTime() < nowMs &&
      !d.status.startsWith('signed_') &&
      d.status !== 'canceled',
  ).length;
  const documentsUnfiled = documents.filter((d) => d.caseId == null).length;

  // Money. Both figures are sums over EVERY row, which is how
  // /counsel/billing computes the same two, and both are skipped entirely
  // when the firm has time and billing hidden, because that page redirects.
  //
  // /counsel/time's own Unbilled stat is taken over its 200 most recent
  // entries and is therefore a floor, so the tile opens billing rather than
  // time: billing is the surface whose figure this one can equal.
  let money: { outstandingCents: number; unbilledCents: number } | null = null;
  if (!surfaces.hideTimeBilling) {
    const [invoiceRes, unbilledRes] = await Promise.all([
      supabase
        .from('firm_invoices')
        .select('status, total_cents')
        .eq('firm_id', ctx.firm.id),
      supabase
        .from('firm_time_entries')
        .select('duration_seconds, rate_cents')
        .eq('firm_id', ctx.firm.id)
        .eq('billable', true)
        .is('invoice_id', null)
        .not('ended_at', 'is', null)
        .gt('duration_seconds', 0),
    ]);
    const invoiceRows = (invoiceRes.data ?? []) as Array<{
      status: string | null;
      total_cents: number | null;
    }>;
    const unbilledRows = (unbilledRes.data ?? []) as Array<{
      duration_seconds: number;
      rate_cents: number | null;
    }>;
    money = {
      outstandingCents: invoiceRows
        .filter((i) => i.status === 'sent')
        .reduce((sum, i) => sum + (i.total_cents ?? 0), 0),
      unbilledCents: unbilledRows.reduce(
        (sum, e) =>
          sum + Math.round((e.rate_cents ?? 0) * (e.duration_seconds / 3600)),
        0,
      ),
    };
  }

  const metricBands = buildCounselMetricBands({
    matters: matterRows,
    meId: user.id,
    approvals: {
      waiting: approvalsWaitingRes.count ?? 0,
      aging: approvalsAgingRes.count ?? 0,
    },
    signing: { out: signingOut, attention: signingAttention },
    documents: { overdue: documentsOverdue, unfiled: documentsUnfiled },
    people: {
      invitationsPending: invitations.length,
      clientsInvited: clients.filter((c) => c.status === 'invited').length,
    },
    money,
  });

  const data: DashboardTileData = {
    firmId: ctx.firm.id,
    firmName: ctx.firm.name,
    userId: user.id,
    userDisplayName:
      ctx.membership.displayName ?? ctx.membership.email ?? 'there',
    isAdmin,
    counts: {
      // The same figure the strip states, so the Cases tile and the strip
      // cannot say two different things about one word.
      casesOpen: openMatters,
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
    // The tile draws five of each and says how many more there are, so
    // it gets five of each and the totals. It used to get ten of each
    // and count them, which made both the "(N)" beside each column and
    // the "N things in your name" headline stop at ten and twenty.
    assigned: {
      cases: myCases.slice(0, 5).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      })),
      casesTotal: myCases.length,
      clients: myClients.slice(0, 5).map((c) => ({
        id: c.id,
        displayName: c.displayName ?? c.email ?? 'Unnamed client',
        status: c.status,
      })),
      clientsTotal: myClients.length,
    },
    signing: { mineAwaitingCount },
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
        // Top right, which is where every other counsel page puts its
        // actions and where this one's own copy has always said this
        // button was. It used to sit in a right-aligned row of its own
        // between the Ask bar and the tiles, so the dashboard pattern's
        // "a strip of metric cards, then a grid of cards" was
        // interrupted twice, and the empty state told the reader to
        // click something "up top" that was directly above it.
        action={
          <DashboardCustomizer initialEnabled={enabled} isAdmin={isAdmin} />
        }
      />

      {/*
        The metric strip the dashboard pattern leads with. Four numbers
        only. Every one of them is a count over a set this page read in
        full, and every one of them now OPENS the list that holds it:

          Open matters      matterCountFor over listFirmCases  -> /counsel/cases
          Signatures out    listFirmSigningRequests, sent|partial
                                                        -> /counsel/signing?view=out
          Active clients    listFirmClients, status active -> /counsel/clients?view=active
          Documents         listFirmDocuments             -> /counsel/documents

        Each destination shows the same set the number counts. "Open
        matters" is the one that had to move to get there: it was a set of
        four statuses written on this page, and /counsel/cases calls a
        draft matter live, so the two disagreed for any firm with a draft.
        It is now the caseload page's own default view, counted by the
        caseload page's own filter. Active clients is the one place a link
        is conditional, because /counsel/clients drops a view no client is
        in; see clientsHref.

        The intake lane counts are exact now, so the cap that used to
        keep them off this strip is gone. They still stay off it, for a
        different and smaller reason: the action center card below is a
        row of open work items headed by their sum, and "N requests need
        attention" is its first row. A fifth metric here would be the
        same number twice on one screen, and the dashboard pattern asks
        that nothing compete with the strip.
      */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StripLink href="/counsel/cases">
          <StatCard
            label={<T>Open matters</T>}
            value={openMatters}
            sub={
              <>
                {cases.length} <T>at the firm in total</T>
              </>
            }
            color="var(--accent-text)"
          />
        </StripLink>
        <StripLink href="/counsel/signing?view=out">
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
        </StripLink>
        <StripLink href={clientsHref(clientsActive.length, 'active')}>
          <StatCard
            // "Clients" is the wrong word for an in-house team, which is the
            // owner's complaint verbatim: it has no clients, and the people it
            // helps are employees. The noun comes off the vocabulary map keyed
            // by the firm's type rather than off a ternary here, so the tile
            // and the rail can never disagree about what these people are
            // called.
            label={<T>{vocab.clients}</T>}
            value={clientsActive.length}
            sub={
              <>
                {clients.length} <T>on the books</T>
              </>
            }
          />
        </StripLink>
        <StripLink href="/counsel/documents">
          <StatCard
            label={<T>Documents</T>}
            value={documents.length}
            sub={<T>held for this firm</T>}
          />
        </StripLink>
      </section>

      {/*
        The board: the rest of the operational picture, banded by whose
        move each figure is. See CounselMetricBoard for why the bands say
        that rather than naming a filing category, and lib/counsel-metrics
        for why each figure's number and its destination cannot disagree.
      */}
      <CounselMetricBoard bands={metricBands} />

      {/* Ask Advottic - below the strip. */}
      <AskAdvottic />

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
