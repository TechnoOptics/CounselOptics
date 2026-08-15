import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmMembers } from '@/lib/firm-storage';
import { firmCopy, firmVocabulary } from '@/lib/firm-vocabulary';
import { createServerSupabase } from '@/lib/supabase/server';
import { getOrCreateMatterChannelAction } from '@/lib/firm-actions';
import { CaseAssigneePicker, type AssigneeOption } from './assignee-picker';
import { CaseStatusPicker } from './status-picker';
import { listOpenTimer } from '@/lib/time-tracking';
import { listTrustTransactions } from '@/lib/trust-accounting-queries';
import { getFirmSurfaceSettings, DEFAULT_FIRM_SURFACE_SETTINGS } from '@/lib/firm-settings';
import { TimerWidget } from '@/components/TimerWidget';
import {
  FIRM_DOCUMENT_STATUS_LABEL,
  FIRM_DOCUMENT_STATUS_TONE,
  FIRM_TONE_COLOR,
  type FirmDocumentStatus,
  type FirmMessage,
} from '@/lib/firm-types';
import { SectionTitle } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  ActionBar,
  Chip,
  MonoRef,
  PanelCard,
  relativeTime,
} from '@/components/counsel/patterns';
import { DraftInvoiceButton } from './draft-invoice-button';
import { AddDeadlineForm } from './add-deadline-form';
import { CompleteDeadlineButton } from './complete-deadline-button';
import { MatterChatPanel } from './matter-chat-panel';
import { CaseInvitePanel } from './case-invite-panel';
import { LinkedProjectsPanel } from './linked-projects-panel';
import { MatterFacts } from './matter-facts';
import { NamingConventions } from './naming-conventions';
import { CaseMenu } from '@/components/counsel/CaseMenu';
import { EditMatterForm } from './edit-matter-form';
import { listCaseImages } from '@/lib/case-images-actions';
import { CaseImagesPanel } from './case-images-panel';
import { T } from '@/components/i18n/LocaleProvider';
import { listFirmApproaches } from '@/lib/firm-approach-actions';
import { ApproachBuilder } from './approach-builder';
import { EvidenceDashboard } from './evidence-dashboard';
import { SectionPanel } from '@/components/counsel/SectionPanel';
import { getCaseEvidenceAnalytics } from '@/lib/case-analytics';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getGuestCaseSummary } from '@/lib/counsel-guest';
import { CounselGuestWorkspace } from './counsel-guest-workspace';
import { logCaseActivity, listCaseActivity } from '@/lib/case-activity-log';
import { ensureMatterNumber } from '@/lib/matter-numbers';
import { displayMatterNumber } from '@/lib/ticket-numbers';
import { CaseActivityStream } from '@/components/counsel/CaseActivityStream';
import { caseFileIsOpen, getCaseFileState } from '@/lib/case-file';
import { CaseFilePanel } from './case-file-panel';
import { formatDate, formatDateNumeric, formatDateTimeNumeric } from '@/lib/format';

export const dynamic = 'force-dynamic';
// This matter page composes many surfaces (facts, evidence, analysis, billing,
// trust, legal review, approaches). On a heavy matter the default ~10s function
// budget was blown, returning a 504 (which read to users as "crashes / very
// slow", including the re-render after saving matter details). Raise the ceiling
// AND parallelize every read below into a single wave.
//
// 300s (the Vercel Pro ceiling) because the Server Actions invoked from this
// route include the heavy AI passes (approach re-run, legal review) that
// deep-read the whole matter. At 60s a large matter's re-run was being killed
// mid-flight, so the client saw a bare "Could not re-run." The digest is also
// bounded (see lib/firm-approach-actions.ts) so a typical run finishes with
// margin under this ceiling.
export const maxDuration = 300;

/**
 * Audit V5 CR-30: the counsel-side case detail used to show
 * "Cases · Advottic" in the browser tab for every matter, making
 * tab-switching across multiple open matters impossible. Reading
 * the matter title server-side and emitting it via the standard
 * "%s · Advottic" template turns each tab into a useful identifier.
 * Wrapped in try/catch so a transient DB failure can't 500 the tab
 * title - falls back to "Matter".
 */
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  try {
    const ctx = await getActiveFirmContext();
    if (!ctx) return { title: 'Matter' };
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('cases')
      .select('title, firm_id')
      .eq('id', params.id)
      .maybeSingle();
    if (!data || data.firm_id !== ctx.firm.id) {
      return { title: 'Matter · Not found' };
    }
    return {
      title: `${(data as { title: string }).title} · Matters`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: 'Matter' };
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  under_review: 'Under review',
  needs_evidence: 'Needs evidence',
  export_ready: 'Export ready',
  closed: 'Closed',
  archived: 'Archived',
};

/** The picker's options, in the order a matter tends to move through them. */
const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function fmtHours(seconds: number) {
  return `${(seconds / 3600).toFixed(2)} h`;
}

export default async function CounselCaseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) {
    // No firm context: this may be a case-scoped co-counsel GUEST. Render the
    // co-counsel case WORKSPACE (case tools scoped to this matter: dashboard,
    // approaches, timeline/evidence, export) if they have access; otherwise the
    // counsel layout has already scoped them, so just send them home. The
    // firm-internal money ops, team/invite panels and other matters are never
    // constructed on this path.
    const guestView = await getGuestCaseSummary(params.id);
    if (guestView) {
      // The guest WORKSPACE is the litigation workspace: approaches, evidence,
      // timeline, export. On a matter the firm is handling as a request there
      // is nothing in it, and every action it offers already refuses through
      // the five shared gates - so without this the co-counsel would get a
      // full set of tools that all answer "the case file is not open".
      //
      // This is the fail-closed branch rather than the expected one: a guest
      // exists because the firm deliberately invited outside counsel onto the
      // matter, which is in practice an act of building a case.
      if (!(await caseFileIsOpen(params.id))) {
        return (
          <div className="animate-fade-up p-6">
            <p className="text-[13px] leading-relaxed text-muted">
              <T>
                The case file is not open on this matter. The firm handling it
                can open it, and the case tools return when they do.
              </T>
            </p>
          </div>
        );
      }
      const gFirmId = guestView.guest.firmId;
      const admin = createAdminSupabase();
      const [gApproachesRes, gAnalytics, gCaseRow, gImagesRow, gDisplayName] = await Promise.all([
        gFirmId
          ? listFirmApproaches(gFirmId, params.id).catch(() => ({ ok: false as const }))
          : Promise.resolve({ ok: false as const }),
        (async () => {
          if (!admin) return null;
          return getCaseEvidenceAnalytics(admin, params.id).catch(() => null);
        })(),
        // Extra matter facts for the party dossier (portrait + full record).
        (async () => {
          if (!admin) return null;
          const { data } = await admin
            .from('cases')
            .select('subject_type, subject_profile, posture, hearing_notes')
            .eq('id', params.id)
            .maybeSingle();
          return data as
            | { subject_type: string | null; subject_profile: Record<string, string> | null; posture: string | null; hearing_notes: string | null }
            | null;
        })(),
        (async () => {
          if (!admin) return [] as { id: string; storage_path: string }[];
          const { data } = await admin
            .from('case_images')
            .select('id, storage_path')
            .eq('case_id', params.id)
            .eq('kind', 'party');
          return (data ?? []) as { id: string; storage_path: string }[];
        })(),
        // Fresh display name from the profile row. The guest's JWT full_name can
        // be stale (it carries whatever was on the token at last refresh, e.g. a
        // shouty all-caps surname), so read the current profiles.display_name and
        // prefer it for the greeting.
        (async () => {
          if (!admin) return null;
          const { data } = await admin
            .from('profiles')
            .select('display_name')
            .eq('id', guestView.guest.userId)
            .maybeSingle();
          return (data as { display_name: string | null } | null)?.display_name ?? null;
        })(),
      ]);
      const gApproaches =
        'approaches' in gApproachesRes ? (gApproachesRes.approaches ?? []) : [];
      const gPartyImages = gImagesRow.map((i) => ({ id: i.id, storagePath: i.storage_path }));
      // Record the visit for the firm's activity stream. Throttled so a reload
      // or quick back-and-forth doesn't spam the feed - one "viewed the matter"
      // entry per ~15 min reads as a session/login.
      void logCaseActivity({ caseId: params.id, action: 'view_matter', throttleMinutes: 15 });
      return (
        <CounselGuestWorkspace
          kase={guestView.case}
          firmId={gFirmId}
          caseId={params.id}
          approaches={gApproaches}
          analytics={gAnalytics}
          subjectType={gCaseRow?.subject_type ?? null}
          subjectProfile={gCaseRow?.subject_profile ?? null}
          posture={gCaseRow?.posture ?? null}
          hearingNotes={gCaseRow?.hearing_notes ?? null}
          partyImages={gPartyImages}
          firstName={(() => {
            // First name only, cleaned. Prefer the fresh profiles.display_name
            // (gDisplayName) over the JWT full_name, which can be stale and carry
            // a shouty all-caps surname or trailing punctuation ("MUCHAI,"). Take
            // the FIRST name token and title-case it, so the greeting shows
            // "Abel", never "Muchai" or "MUCHAI,,".
            const raw =
              (gDisplayName ?? '').trim() ||
              (guestView.guest.displayName ?? '').trim() ||
              (guestView.guest.email ?? '').split('@')[0] ||
              '';
            const tok = raw.match(/[\p{L}\p{M}'’-]+/u)?.[0] ?? '';
            return tok ? tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase() : null;
          })()}
        />
      );
    }
    redirect('/counsel');
  }
  const supabase = createServerSupabase();

  // Pull case (RLS gates). The consumer-side `/cases/[id]` route
  // also works for firm members; this page adds firm-specific
  // panels (time, deadlines, invoicing, trust).
  const { data: caseRow } = await supabase
    .from('cases')
    .select(
      'id, title, subject_name, subject_type, subject_profile, case_type, posture, status, jurisdiction_country, jurisdiction_state, jurisdiction_city, hearing_at, hearing_location, hearing_notes, description, firm_id, created_at, updated_at, text_normalizations',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) notFound();
  const c = caseRow as {
    id: string;
    title: string;
    subject_name: string;
    subject_type: string | null;
    subject_profile: Record<string, string> | null;
    case_type: string;
    posture: string;
    status: string;
    jurisdiction_country: string | null;
    jurisdiction_state: string | null;
    jurisdiction_city: string | null;
    hearing_at: string | null;
    hearing_location: string | null;
    hearing_notes: string | null;
    description: string | null;
    firm_id: string | null;
    created_at: string;
    updated_at: string;
    text_normalizations: unknown;
  };
  if (c.firm_id !== ctx.firm.id) notFound();

  // Single parallel wave: none of these depend on each other, so fetching
  // them together (instead of sequential await blocks) is what keeps the
  // render inside the function budget. Each is independently .catch-guarded so
  // one slow/failed read degrades its own panel rather than the whole page.
  // The activity stream is firm-leadership-only (owner/admin) - the case owner's
  // window into who's been on the matter. Skip the read for other members.
  const canSeeActivity = ['owner', 'admin'].includes(ctx.membership.role);
  const [
    caseImagesRes,
    approachesRes,
    surface,
    openTimer,
    members,
    assigneeRes,
    caseAnalytics,
    activityEvents,
    matterNumber,
    caseFile,
  ] = await Promise.all([
    listCaseImages(ctx.firm.id, params.id).catch(() => ({ ok: false as const })),
    listFirmApproaches(ctx.firm.id, params.id).catch(() => ({ ok: false as const })),
    getFirmSurfaceSettings(ctx.firm.id).catch(() => DEFAULT_FIRM_SURFACE_SETTINGS),
    listOpenTimer(ctx.firm.id).catch(() => null),
    listFirmMembers(ctx.firm.id).catch(() => []),
    supabase.from('cases').select('assigned_to').eq('id', params.id).maybeSingle(),
    (async () => {
      const admin = createAdminSupabase();
      if (!admin) return null;
      return getCaseEvidenceAnalytics(admin, params.id).catch(() => null);
    })(),
    canSeeActivity
      ? listCaseActivity(ctx.firm.id, params.id, 60).catch(() => [])
      : Promise.resolve([]),
    // The firm's own reference for this matter, allocated here if the matter
    // does not have one yet. In this wave rather than before it because a
    // matter that already has its number costs one read, and because a
    // reference is not worth delaying the page for: on any failure this is
    // null and the breadcrumb shows the shortened id it always showed. The
    // authorization for the write is inside ensureMatterNumber, on the shared
    // lib/firm-authz.ts axis. See lib/matter-numbers.ts for why the write is
    // on this path at all rather than at creation.
    ensureMatterNumber(ctx.firm.id, params.id).catch(() => null),
    // Is this matter a court case, or a request? In the wave because it costs
    // one read and decides four of the sections below. It fails CLOSED on its
    // own (lib/case-file.ts), which is why there is no .catch here: a catch
    // that swallowed the failure into `undefined` would make the page render
    // the workbench on a read it could not perform.
    getCaseFileState(params.id),
  ]);
  const showTimeBilling = !surface.hideTimeBilling;
  /*
   * The gate the owner asked for.
   *
   *   "Please only use this screen if there is a court case, or the firm has
   *    selected build a case. This is not how normal employee requests should
   *    appear. This is only the court case view."
   *
   * Simple is the DETAIL pattern of docs/PARITY-PAGE-RULES.md, which this page
   * already mostly was: breadcrumb with the mono reference, title, meta chips,
   * an action bar in its own bordered card, two columns of cards, an aside.
   * What comes off it in simple mode is the four things that made it a fifth
   * page shape - the case menu, the dashboard metric strip the parity rules say
   * nothing may compete with, the second dashboard nested in a collapsible
   * tile, and the AI console.
   *
   * Litigation mode stays a workbench, on purpose. A firm that opens a case
   * file has asked for one. What changes is that a routine request no longer
   * gets it by default.
   */
  const litigation = caseFile.mode === 'litigation';
  const caseImages = (caseImagesRes?.ok && caseImagesRes.images) ? caseImagesRes.images : [];
  const approaches =
    ('approaches' in approachesRes ? approachesRes.approaches : null) ?? [];
  const currentAssigneeId =
    (assigneeRes.data as { assigned_to: string | null } | null)?.assigned_to ??
    null;
  const assigneeOptions: AssigneeOption[] = members.map((m) => ({
    userId: m.userId,
    label: m.displayName ?? m.email ?? 'Member',
  }));

  const [
    { data: timeRaw },
    { data: unbilledRaw },
    { data: deadlinesRaw },
    { data: invoicesRaw },
    { data: signingRaw },
    { data: docsRaw },
    trustEntries,
  ] = await Promise.all([
    supabase
      .from('firm_time_entries')
      .select('id, description, started_at, ended_at, duration_seconds, billable, rate_cents, invoice_id, source')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('started_at', { ascending: false })
      .limit(50),
    // The Unbilled figure and the "Draft for $X" button must state the
    // amount the invoice will ACTUALLY be for, so this query is separate
    // from the display list above (capped at 50 rows) and unbounded, and
    // its filters mirror buildDraftInvoiceAction's selection exactly:
    // billable, ended, positive duration, not yet on an invoice.
    supabase
      .from('firm_time_entries')
      .select('duration_seconds, rate_cents')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .eq('billable', true)
      .is('invoice_id', null)
      .not('ended_at', 'is', null)
      .gt('duration_seconds', 0)
      .order('id', { ascending: true }),
    supabase
      .from('case_deadlines')
      .select('id, kind, title, due_at, completed_at')
      .eq('case_id', params.id)
      .order('due_at', { ascending: true }),
    supabase
      .from('firm_invoices')
      .select('id, number, status, total_cents, created_at, sent_at, paid_at, stripe_payment_link')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('firm_signing_requests')
      .select('id, status, created_at, document_id')
      .eq('firm_id', ctx.firm.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('firm_documents')
      .select('id, name, status, status_updated_at, due_at')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('uploaded_at', { ascending: false })
      .limit(20),
    listTrustTransactions(ctx.firm.id, { caseId: params.id }),
  ]);

  const time = (timeRaw ?? []) as Array<{
    id: string;
    description: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    billable: boolean;
    rate_cents: number | null;
    invoice_id: string | null;
    source: string;
  }>;
  const deadlines = (deadlinesRaw ?? []) as Array<{
    id: string;
    kind: string;
    title: string;
    due_at: string;
    completed_at: string | null;
  }>;
  const invoices = (invoicesRaw ?? []) as Array<{
    id: string;
    number: string;
    status: string;
    total_cents: number;
    created_at: string;
    sent_at: string | null;
    paid_at: string | null;
    stripe_payment_link: string | null;
  }>;
  const signing = (signingRaw ?? []) as Array<{
    id: string;
    status: string;
    created_at: string;
    document_id: string;
  }>;
  const docs = (docsRaw ?? []) as Array<{
    id: string;
    name: string;
    status: FirmDocumentStatus;
    status_updated_at: string;
    due_at: string | null;
  }>;

  const totalSeconds = time.reduce(
    (s, e) => s + (e.duration_seconds ?? 0),
    0,
  );
  const billableSeconds = time
    .filter((e) => e.billable && e.duration_seconds)
    .reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
  const unbilledCents = (
    (unbilledRaw ?? []) as Array<{
      duration_seconds: number | null;
      rate_cents: number | null;
    }>
  ).reduce(
    (s, e) =>
      s + Math.round((e.rate_cents ?? 0) * ((e.duration_seconds ?? 0) / 3600)),
    0,
  );
  // The matter's deadline state, which the action bar reports. Both
  // readings come from the same `deadlines` array the aside renders, so
  // the bar cannot say "nothing due" over a list that shows otherwise.
  const nowMs = Date.now();
  const openDeadlines = deadlines.filter((d) => !d.completed_at);
  const overdueCount = openDeadlines.filter(
    (d) => Date.parse(d.due_at) < nowMs,
  ).length;
  const nextDeadline = openDeadlines
    .filter((d) => Date.parse(d.due_at) >= nowMs)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0];

  const trustBalance = trustEntries.reduce((s, t) => {
    const positive =
      t.kind === 'deposit' || t.kind === 'refund' || t.kind === 'interest';
    return s + (positive ? t.amountCents : -t.amountCents);
  }, 0);

  return (
    <div className="space-y-6 animate-fade-up">
      {/* The case menu is four court surfaces (Case Timeline, Evidence
          Center, Case approach, Export). A matter being handled as a request
          has none of them, and each target refuses on its own server side as
          well - see lib/case-file.ts. */}
      {litigation && (
        <CaseMenu
          caseId={params.id}
          approaches={approaches.map((a) => ({ id: a.id, title: a.title }))}
        />
      )}

      {/* Breadcrumb. The mono element is the firm's own reference for
          this matter, which is what they quote on the phone and in a
          filing. A matter the allocator has not reached falls back to the
          shortened id, which is what this showed before references
          existed. The full id is the title attribute either way, because
          it is still what the URL is keyed on. */}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/cases"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Matters</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={params.id}>
          {displayMatterNumber({ matterNumber, id: params.id })}
        </MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {c.title}
        </h1>
        {/* Meta chip row: the fixed facts as quiet chips, then plain
            provenance underneath. The status is NOT here. It was a pill on
            this row and a select in the action bar fifty pixels below, the
            same word twice, one of them the control that sets it. The one
            that can be acted on is the one that stays. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {c.case_type && (
            <Chip>
              <span data-no-translate>{c.case_type}</span>
            </Chip>
          )}
          {c.posture && (
            <Chip className="capitalize">
              <span data-no-translate>{c.posture}</span>
            </Chip>
          )}
          {c.jurisdiction_state && (
            <Chip>
              <span data-no-translate>{c.jurisdiction_state}</span>
            </Chip>
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          <T>opened</T> {relativeTime(c.created_at)}
          {c.updated_at && (
            <>
              {' · '}
              <T>updated</T> {relativeTime(c.updated_at)}
            </>
          )}
        </p>
      </header>

      {/* Action bar: the controls that change the matter, in their own
          bordered card, with its deadline state on the right. No button
          here duplicates the case menu above; the two controls are the
          two things this page can actually change in place. */}
      <ActionBar
        trailing={
          overdueCount > 0 ? (
            <p className="text-[12.5px] font-semibold text-danger-text">
              {overdueCount}{' '}
              {overdueCount === 1 ? (
                <T>deadline past due</T>
              ) : (
                <T>deadlines past due</T>
              )}
            </p>
          ) : nextDeadline ? (
            <p className="text-[12.5px] text-muted">
              <T>Next deadline</T> {relativeTime(nextDeadline.due_at)}
            </p>
          ) : undefined
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
          <CaseStatusPicker
            caseId={params.id}
            options={STATUS_OPTIONS}
            current={c.status}
          />
          <CaseAssigneePicker
            caseId={params.id}
            members={assigneeOptions}
            currentAssigneeId={currentAssigneeId}
          />
          {showTimeBilling && (
            <TimerWidget
              firmId={ctx.firm.id}
              initial={openTimer}
              caseId={params.id}
              caseTitle={c.title}
            />
          )}
        </div>
      </ActionBar>

      {/* Two columns. The main column is the work: who the party is, the
          evidence, the argument, the room, the money. The aside is the
          matter's dated records, deadlines and documents, which are
          short rows that read better in a narrow column and are what
          somebody scans while reading the main one. */}
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <div className="min-w-0 space-y-8 lg:col-span-2">

      {/* Party dossier at the top: the subject's portrait + full record leads
          the matter, standing in for the old plain "Subject" line. Its inline
          "Edit details" editor (with the case-images panel) travels with it. */}
      <MatterFacts
        firmId={ctx.firm.id}
        caseId={params.id}
        posture={c.posture}
        caseType={c.case_type}
        subjectName={c.subject_name}
        subjectType={c.subject_type}
        subjectProfile={c.subject_profile}
        partyImages={caseImages
          .filter((i) => i.kind === 'party')
          .map((i) => ({ id: i.id, storagePath: i.storagePath }))}
        jurisdictionCountry={c.jurisdiction_country}
        jurisdictionState={c.jurisdiction_state}
        jurisdictionCity={c.jurisdiction_city}
        description={c.description}
        hearingAt={c.hearing_at}
        hearingLocation={c.hearing_location}
        hearingNotes={c.hearing_notes}
      />

      {/* Any wording this matter rewrites in generated text and exports, shown
          before a document is produced rather than only inside it. */}
      <NamingConventions rules={c.text_normalizations} />

      <div className="-mt-3">
        <EditMatterForm
          firmId={ctx.firm.id}
          caseId={params.id}
          initial={{
            title: c.title,
            subject: c.subject_name,
            subjectType: (c.subject_type as 'person' | 'business' | 'entity' | 'state' | 'matter') ?? 'person',
            caseType: c.case_type,
            posture: (c.posture as 'claimant' | 'defendant') ?? 'claimant',
            country: c.jurisdiction_country ?? 'US',
            state: c.jurisdiction_state ?? '',
            city: c.jurisdiction_city ?? '',
            description: c.description ?? '',
            profile: (c.subject_profile ?? {}) as Record<string, string>,
            hearingAt: c.hearing_at ? c.hearing_at.slice(0, 16) : '',
            hearingLocation: c.hearing_location ?? '',
            hearingNotes: c.hearing_notes ?? '',
          }}
        >
          {/* Party portraits + case-context images live inside the Edit
              details editor (moved out of a standalone panel). */}
          <CaseImagesPanel
            firmId={ctx.firm.id}
            caseId={params.id}
            initial={caseImages}
            featuredImageId={(c.subject_profile as { featuredImageId?: string } | null)?.featuredImageId ?? null}
          />
        </EditMatterForm>
      </div>

      {/* Top stats (Time & Billing) - hidden when the firm turns the surface
          off, and hidden on a matter handled as a request.
          docs/PARITY-PAGE-RULES.md:32 says nothing on a page may compete with
          a metric strip, which is exactly what this one was doing to the
          matter's own content. The four figures are not lost in simple mode:
          they read as one quiet line inside the sections that own them, which
          is where the DETAIL pattern wants them. No server-side refusal is
          owed for this one and none is claimed - it is a sum over
          firm_time_entries and the trust ledger, rows the sections further
          down this same page already list. */}
      {showTimeBilling && litigation && (
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Time logged" value={fmtHours(totalSeconds)} />
        <Stat label="Billable hours" value={fmtHours(billableSeconds)} />
        <Stat
          label="Unbilled"
          value={fmtCents(unbilledCents)}
          tone={unbilledCents > 0 ? 'amber' : 'neutral'}
        />
        <Stat
          label="Trust balance"
          value={fmtCents(trustBalance)}
          tone={trustBalance < 0 ? 'rose' : 'neutral'}
        />
      </section>
      )}


      {/* Evidence dashboard - a live, at-a-glance analytics read over the
          matter's evidence set (counts, processing status, relevance, folders,
          document types, temporal span, extracted entities). This is a
          read-only overview of evidence the firm can already see via the
          Evidence tab; it consumes no AI, so it is NOT gated on the AI-build
          subscription tier (resolveTimelineAccess). The whole page already
          requires firm context to load, so any viewer here is a firm member -
          we just need the aggregate to be present. The component self-hides
          when nothing has been uploaded yet. Server-rendered from the
          admin-scoped aggregate, so it is always current on load. */}
      {litigation && caseAnalytics ? (
        <SectionPanel
          title="Evidence analytics"
          blurb="Volume, coverage, relevance, and the year-by-year read of the evidence."
          meta={`${caseAnalytics.total} item${caseAnalytics.total === 1 ? '' : 's'}`}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        >
          <EvidenceDashboard analytics={caseAnalytics} caseId={params.id} />
        </SectionPanel>
      ) : null}


      {/* Case approach: the lawyer's theory in, a structured argument with
          cited exhibits + supporting timeline out. Rendered UNCONDITIONALLY (it
          shows its own "add credits" state when AI is off) so the "Case
          approach" tab's #case-approaches anchor always has a target. */}
      {litigation && (
        <div id="case-approaches" className="scroll-mt-24 border-t border-ink-100 dark:border-forest-700/40 pt-8">
          <ApproachBuilder firmId={ctx.firm.id} caseId={params.id} initial={approaches} />
        </div>
      )}

      {/* Matter room - idempotent: getOrCreate ensures one channel
          per case_id (the unique index on firm_channels.case_id
          guarantees we never duplicate). Auto-membership adds every
          firm member to the channel so the room is populated even
          before anyone explicitly joins. */}
      <MatterChatSection
        firmId={ctx.firm.id}
        caseId={params.id}
        caseTitle={c.title}
        currentUserId={ctx.membership.userId}
      />

      {/* People on this matter - firm invites client/co-counsel/contributor/viewer */}
      <CaseInvitePanel
        copy={firmCopy(ctx.firm.firmType)}
        caseId={params.id}
        firmId={ctx.firm.id}
        canManage={['owner', 'admin', 'attorney'].includes(ctx.membership.role)}
        canProvisionGuests={['owner', 'admin'].includes(ctx.membership.role)}
      />

      {/* Activity stream: firm-leadership-only view of who's been on the
          matter (guest logins, section opens, comments, downloads). */}
      {canSeeActivity && (
        <CaseActivityStream
          events={activityEvents}
          vocab={firmVocabulary(ctx.firm.firmType)}
        />
      )}

      {showTimeBilling && (
       <>
      {/* Time entries */}
      <section className="space-y-3">
        <SectionTitle
          variant="display"
          action={
            unbilledCents > 0 ? (
              <DraftInvoiceButton
                firmId={ctx.firm.id}
                caseId={params.id}
                caseTitle={c.title}
                unbilledCents={unbilledCents}
              />
            ) : undefined
          }
        >
          <T>Time on this matter</T>
        </SectionTitle>
        {/* The figures the metric strip carried, on the section that owns
            them, when there is no strip. One quiet line rather than three
            cards: a DETAIL page states a number, a DASHBOARD displays it. */}
        {!litigation && (
          <p className="text-[12.5px] text-muted">
            <T>Time logged</T>{' '}
            <span className="font-mono tabular-nums text-foreground" data-no-translate>
              {fmtHours(totalSeconds)}
            </span>
            {' · '}
            <T>billable</T>{' '}
            <span className="font-mono tabular-nums text-foreground" data-no-translate>
              {fmtHours(billableSeconds)}
            </span>
            {' · '}
            <T>unbilled</T>{' '}
            <span
              className={`font-mono tabular-nums ${unbilledCents > 0 ? 'text-amber-600 dark:text-amber-300/85' : 'text-foreground'}`}
              data-no-translate
            >
              {fmtCents(unbilledCents)}
            </span>
          </p>
        )}
        {time.length === 0 ? (
          <p className="card p-4 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            <T>No time entries yet. Start the timer in the action bar above.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {time.slice(0, 20).map((e) => (
              <li
                key={e.id}
                className="card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-forest-900 dark:text-cream-100 truncate">
                    {e.description ?? <T>Time entry</T>}
                  </p>
                  <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums mt-0.5">
                    {formatDateTimeNumeric(e.started_at)}
                    {e.invoice_id && <T> · invoiced</T>}
                    {!e.billable && <T> · non-billable</T>}
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold text-[13px]">
                  {e.duration_seconds
                    ? fmtHours(e.duration_seconds)
                    : <T>running</T>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invoices */}
      {invoices.length > 0 && (
        <section className="space-y-3">
          <SectionTitle variant="display"><T>Invoices</T></SectionTitle>
          <ul className="space-y-2">
            {invoices.map((i) => (
              <li
                key={i.id}
                className="card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
                    {i.number}
                  </p>
                  <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 font-mono">
                    {i.status} · {formatDateNumeric(i.created_at)}
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold text-[13px]">
                  {fmtCents(i.total_cents)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Trust ledger snippet */}
      {trustEntries.length > 0 && (
        <section className="space-y-3">
          <SectionTitle variant="display">
            <T>Trust ledger (this matter)</T>
          </SectionTitle>
          {/* The strip's fourth figure, on the ledger it is a total of. */}
          {!litigation && (
            <p className="text-[12.5px] text-muted">
              <T>Balance</T>{' '}
              <span
                className={`font-mono tabular-nums ${trustBalance < 0 ? 'text-rose-600 dark:text-rose-300/85' : 'text-foreground'}`}
                data-no-translate
              >
                {fmtCents(trustBalance)}
              </span>
            </p>
          )}
          <ul className="space-y-1.5">
            {trustEntries.slice(0, 10).map((t) => (
              <li
                key={t.id}
                className="card p-3 flex items-center justify-between text-[13px]"
              >
                <span className="truncate">
                  <span className="font-mono text-[10.5px] text-ink-500 dark:text-cream-100/55 mr-2">
                    {t.kind.replace(/_/g, ' ')}
                  </span>
                  {t.description ?? t.clientLabel}
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums font-semibold ${
                    t.kind === 'deposit' ||
                    t.kind === 'refund' ||
                    t.kind === 'interest'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {fmtCents(t.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
       </>
      )}

      {/* Project binders bound to this matter (renders nothing when none) */}
      <LinkedProjectsPanel firmId={ctx.firm.id} caseId={params.id} />

      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
        {/* First in the aside, in BOTH modes. It is the one control that
            changes what the rest of the page is, and on a simple matter it is
            the only way to the case tools at all. */}
        <CaseFilePanel
          firmId={ctx.firm.id}
          caseId={params.id}
          open={litigation}
          source={caseFile.source}
          storable={caseFile.storable}
          canManage={['owner', 'admin', 'attorney'].includes(ctx.membership.role)}
        />

        <PanelCard
          title={<T>Deadlines</T>}
          bodyClassName="p-3 space-y-2"
        >
          {deadlines.length === 0 ? (
            <p className="px-1 py-2 text-[13px] italic text-muted">
              <T>No deadlines on this matter yet.</T>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {deadlines.map((d) => {
                const overdue = !d.completed_at && Date.parse(d.due_at) < nowMs;
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[13px] font-semibold ${
                          d.completed_at
                            ? 'text-muted line-through'
                            : 'text-foreground'
                        }`}
                        data-no-translate
                      >
                        {d.title}
                      </p>
                      <p
                        className={`mt-0.5 font-mono text-[11.5px] tabular-nums ${
                          overdue ? 'font-semibold text-danger-text' : 'text-muted'
                        }`}
                      >
                        <span data-no-translate>
                          {d.kind.replace(/_/g, ' ')}
                        </span>{' '}
                        ·{' '}
                        {overdue ? <T>past due</T> : <T>due</T>}{' '}
                        {formatDate(d.due_at)}
                      </p>
                    </div>
                    {!d.completed_at && (
                      <CompleteDeadlineButton deadlineId={d.id} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <AddDeadlineForm
            caseId={params.id}
            firmId={ctx.firm.id}
            jurisdictionState={c.jurisdiction_state ?? null}
          />
        </PanelCard>

        <PanelCard
          title={<T>Documents</T>}
          action={
            <Link
              href="/counsel/documents"
              className="text-[12px] text-accent-text hover:underline"
            >
              <T>Open Documents</T>
            </Link>
          }
          bodyClassName="p-3"
        >
          {docs.length > 0 ? (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2"
                >
                  <Link
                    href={`/counsel/documents/${d.id}`}
                    className="min-w-0 flex-1 truncate text-[13px] text-foreground"
                    data-no-translate
                  >
                    {d.name}
                  </Link>
                  <StatusPill
                    size="sm"
                    dot
                    color={
                      FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[d.status]] ??
                      FIRM_TONE_COLOR.gray
                    }
                  >
                    {FIRM_DOCUMENT_STATUS_LABEL[d.status] ?? d.status}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">
              <T>No documents yet. Draft a letter or upload one from</T>{' '}
              <Link href="/counsel/documents" className="underline">
                <T>Documents</T>
              </Link>
              .
            </p>
          )}
        </PanelCard>

        {/* Evidence Center used to lead this card. It is a tile in the case
            menu at the top of the page, on screen at the same time and never
            hidden, so this was a second door to the same room. Projects and
            Draft a letter stay: neither has anywhere else to be reached from
            when the matter has no linked project. */}
        <PanelCard title={<T>Elsewhere on this matter</T>} bodyClassName="p-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/counsel/projects?caseId=${params.id}`}
              className="rounded-md border border-edge px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-surface-2"
            >
              <T>Projects</T>
            </Link>
            <Link
              href={`/counsel/letters?caseId=${params.id}`}
              className="rounded-md border border-edge px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-surface-2"
            >
              <T>Draft a letter</T>
            </Link>
          </div>
        </PanelCard>
      </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  // Calm by default: the numbers read neutral. Only two muted accents remain,
  // each reserved for a state that actually warrants attention - amber for
  // unbilled work, rose for a negative trust balance. No green on firm surfaces.
  tone?: 'neutral' | 'amber' | 'rose';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-300/85'
      : tone === 'rose'
        ? 'text-rose-600 dark:text-rose-300/85'
        : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2"><T>{label}</T></p>
      <p className={`text-2xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Server-rendered matter-chat section. Wraps the client MatterChatPanel
 * with the data it needs:
 *   - getOrCreateMatterChannelAction guarantees a channel exists (idempotent)
 *   - initial messages backfill so the panel mounts populated
 *   - author lookup map so messages render real names, not UUIDs
 *
 * Wrapped in a separate async component so the case detail page can
 * render the rest of its UI while the chat backfill resolves.
 */
async function MatterChatSection({
  firmId,
  caseId,
  caseTitle,
  currentUserId,
}: {
  firmId: string;
  caseId: string;
  caseTitle: string;
  currentUserId: string;
}) {
  const channelRes = await getOrCreateMatterChannelAction(firmId, caseId, caseTitle).catch(() => null);
  if (!channelRes?.ok || !channelRes.channelId) {
    return (
      <section className="card p-5">
        <p className="eyebrow text-[10px] mb-1"><T>Matter room</T></p>
        <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          <T>Could not prepare the matter chat. Reload the page or contact support.</T>
        </p>
      </section>
    );
  }
  const channelId = channelRes.channelId;

  // Hydrate the most recent ~80 messages + author display names so the
  // chat panel mounts with real history. The Realtime subscription
  // picks up everything after; this just primes the pump.
  const supabase = createServerSupabase();
  const [{ data: messageRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('firm_messages')
      .select('id, channel_id, user_id, body, attachments, created_at, edited_at, deleted_at')
      .eq('channel_id', channelId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(80),
    supabase
      .from('firm_members')
      .select('user_id, display_name, email')
      .eq('firm_id', firmId),
  ]);
  const initialMessages: FirmMessage[] = (messageRows ?? []).map(
    (r: Record<string, unknown>) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      userId: r.user_id as string,
      body: r.body as string,
      attachments: (r.attachments as FirmMessage['attachments']) ?? [],
      createdAt: r.created_at as string,
      editedAt: (r.edited_at as string | null) ?? null,
      deletedAt: (r.deleted_at as string | null) ?? null,
    }),
  );
  const authors = (memberRows ?? []).map((r: Record<string, unknown>) => ({
    userId: r.user_id as string,
    displayName: (r.display_name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
  }));

  return (
    <MatterChatPanel
      channelId={channelId}
      initialMessages={initialMessages}
      authors={authors}
      currentUserId={currentUserId}
    />
  );
}
