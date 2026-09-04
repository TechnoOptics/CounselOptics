import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmCases,
  listFirmMembers,
} from '@/lib/firm-storage';
import { AdministrativeTools } from './administrative-tools';
import {
  readIntakeLegalFields,
  showsAdministrativeTools,
} from '@/lib/intake-legal-fields';
import { readContractDetails } from '@/lib/intake-contract-fields';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { createServerSupabase } from '@/lib/supabase/server';
import { ConflictCheckPanel } from './conflict-check-panel';
import { IntakeConversation } from '@/components/intake/IntakeConversation';
import { IntakeWorkPanel } from '@/components/intake/IntakeWorkPanel';
import { RecordSection } from '@/components/intake/RecordSection';
import { refFor } from '@/lib/intake-notify';
import { loadIntakeConversationAction } from '@/lib/intake-conversation';
import type { ThreadMessage } from '@/lib/intake-thread';
import {
  readRequestFolders,
  readIntakeFolder,
} from '@/lib/request-folders';
import { FolderPicker } from './folder-picker';
import { ScheduleMeetingPanel } from './schedule-meeting';
import { RequestActions } from './request-actions';
import { DecideRequest } from './decide-request';
import { AnalyzeAttachments } from './analyze-attachments';
import { StatusPill } from '@/components/counsel/StatusPill';
import { RequestSidebarFocus } from '@/components/counsel/SidebarFocus';
import { TicketManagement } from './ticket-management';
import {
  WORKFLOW_LABEL,
  workflowColor,
  workflowStateOf,
} from '@/lib/intake-workflow';
import { ActionBar, Chip, MonoRef, PanelCard, relativeTime } from '@/components/counsel/patterns';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';
import { T } from '@/components/i18n/LocaleProvider';
import { intakeChannel, intakeDeadline } from '@/lib/intake-detail';
import {
  readSignatureDirection,
  signatureDirectionLabel,
} from '@/lib/intake-signature-direction';
import { formatDate } from '@/lib/format';
import {
  loadTicketSigningActivity,
  loadRequesterOtherIntakes,
} from '@/lib/intake-context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake · Counsel' };

// The pill now says the WORKFLOW state, not the lifecycle status, and its
// colour comes from lib/intake-workflow.ts with the rest of that vocabulary.
//
// It used to hold a hex-per-status map of its own. Two status words on one
// screen would be two things to reconcile before doing any work, and the one
// the legal team manages by is the finer of the two: "awaiting external party"
// is actionable and "conflict check passed" is history. The lifecycle status
// has not gone anywhere, it is what the queue, the employee's portal and the
// partner API still read, and every write here keeps it in the right lane.

/** The decision panel's props, read out of the schema-less answers column. */
function readDecision(answers: Record<string, unknown>) {
  const d = answers.decision;
  if (!d || typeof d !== 'object') return null;
  const r = d as Record<string, unknown>;
  const outcome = String(r.outcome ?? '');
  if (!outcome) return null;
  return {
    outcome,
    reason: String(r.reason ?? ''),
    byName: String(r.byName ?? 'The legal team'),
    at: String(r.at ?? ''),
  };
}

export default async function IntakeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  // The aside heads the requester's details. For an in-house team the person
  // who filed the request is an employee, not a client.
  const vocab = firmVocabulary(ctx.firm.firmType);
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_matter_intakes')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const intake = data as {
    id: string;
    firm_id: string;
    client_name: string;
    client_email: string | null;
    client_phone: string | null;
    matter_type: string | null;
    matter_summary: string | null;
    jurisdiction_state: string | null;
    opposing_parties: string[];
    related_parties: string[];
    status: string;
    conflict_check_notes: string | null;
    conflict_results: Array<{
      source: string;
      matchedParty: string;
      matchedAgainst: string;
      severity: string;
    }> | null;
    intake_answers: Record<string, unknown> | null;
    // The firm allocated reference; null on requests filed before
    // 20260817_request_number.sql. See refFor in lib/intake-notify.ts.
    request_number: string | null;
    created_by: string | null;
    created_at: string;
    // Added by supabase/migrations/20260816_intake_workflow_state.sql. Until
    // that is applied these read as undefined, which workflowStateOf and the
    // date fields all treat as "nobody has set one", so the page renders.
    workflow_state?: string | null;
    follow_up_on?: string | null;
    due_on?: string | null;
  };
  if (intake.firm_id !== ctx.firm.id) notFound();

  const workflow = workflowStateOf(intake.workflow_state, intake.status);

  // In-house metadata captured by the typed intake form. Stored in the
  // schema-less intake_answers JSON column so it renders without a
  // migration. Only the fields that were actually filled are shown.
  const ans = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const requestFolders = readRequestFolders(ctx.firm.metadata);
  const currentFolder = readIntakeFolder(intake.intake_answers);
  //
  // These used to be two panels in the right rail, Matter (Type,
  // Jurisdiction) and Request details. Both are gone at the owner's request
  // and the facts came here, to the record in the left column.
  //
  // Submitted by, Priority and Due by are NOT in this list: the header
  // already carries the first two as chips and the action bar carries the
  // deadline, and docs/DESIGN.md calls a control drawn twice two controls
  // that can disagree. The rest had no other home on this screen at all.
  const recordFacts: Array<{ label: string; value: string }> = [
    { label: 'Type', value: (intake.matter_type ?? '').trim() },
    { label: 'Jurisdiction', value: (intake.jurisdiction_state ?? '').trim() },
    ...(
      [
        ['Request type', 'request_type'],
        ['Confidentiality', 'confidentiality'],
        ['Expiry', 'expiry'],
      ] as const
    ).map(([label, key]) => ({ label, value: String(ans[key] ?? '').trim() })),
  ].filter((f) => f.value.length > 0);
  // An in-house employee request (filed from /portal) carries a
  // submitted_by. Outside-client matters do not.
  const submittedBy = String(ans.submitted_by ?? '').trim();
  const isEmployeeReq = submittedBy.length > 0;
  // The contract family's shared fields, filed by the employee. Empty on
  // every other request type. See lib/intake-contract-fields.ts.
  const contractDetails = readContractDetails(ans.contract);
  const thread: ThreadMessage[] = Array.isArray(ans.thread)
    ? (ans.thread as ThreadMessage[])
    : [];

  // Answers to the firm-configured partner-app intake questions (labels
  // are stored with the answers, so renaming a question later can't
  // mislabel historical requests).
  const questionAnswers = (Array.isArray(ans.questionAnswers) ? ans.questionAnswers : [])
    .map((qa) => {
      const q = (qa ?? {}) as Record<string, unknown>;
      return {
        id: String(q.id ?? ''),
        label: String(q.label ?? '').trim(),
        value: String(q.value ?? '').trim(),
      };
    })
    .filter((q) => q.label && q.value);

  // @mention pool: every legal-team member + the requester.
  const members = await listFirmMembers(ctx.firm.id).catch(() => []);
  const mDedupe = new Map<string, string>();
  for (const mem of members) {
    if (mem.userId) {
      mDedupe.set(
        mem.userId,
        mem.displayName || mem.email || 'Member',
      );
    }
  }
  if (intake.created_by && isEmployeeReq) {
    mDedupe.set(intake.created_by, submittedBy || 'Requester');
  }
  const mentionables = [...mDedupe].map(([id, name]) => ({ id, name }));

  // The live conversation, the people on it, and its documents.
  const conv = await loadIntakeConversationAction(intake.id);

  // Context for the rail. Both go through `supabase`, the RLS-enforced user
  // client, deliberately: the live policies are the access control, and
  // lib/intake-context.ts explains why the signed-documents lookup must
  // start at firm_documents rather than at firm_signing_requests.
  const [signing, requesterHistory] = await Promise.all([
    loadTicketSigningActivity(supabase, intake.id),
    loadRequesterOtherIntakes(supabase, intake),
  ]);

  // refFor, not a hand-rolled copy of it. This line WAS that copy, and it had
  // already drifted: it knew about the partner id and the derived reference but
  // could never have known about an allocated number, so this page would have
  // called a request something the notification about it did not.
  const ref = refFor(intake);
  const priority = String(ans.priority ?? '').trim();
  // Null on every ticket filed before the signature question existed, and on
  // any value that is not one of the two words. See
  // lib/intake-signature-direction.ts.
  const directionLabel = signatureDirectionLabel(ans.signature_direction);
  // What this request IS, not who filed it. Partner tickets carry their own
  // subject; everything else falls back to the matter type.
  const ticketTitle =
    String(ans.subject ?? '').trim() ||
    (intake.matter_type ?? '').trim() ||
    intake.client_name;
  const requester = intake.client_name;
  const caseId = (intake as { case_id?: string | null }).case_id ?? null;
  const channel = intakeChannel(ans);
  const deadline = intakeDeadline(ans, Date.now());
  const opened = relativeTime(intake.created_at);
  const decision = readDecision(ans);

  // The legal team's own fields, in the rail. Real columns, never
  // intake_answers: lib/intake-legal-fields.ts says why. Absent until the
  // migration is applied, and read as unset rather than failing, because this
  // page selects `*`. The matter list is fetched only when the block shows.
  const showAdmin = showsAdministrativeTools(intake.matter_type);
  const legalFields = readIntakeLegalFields(intake);
  const matters = showAdmin
    ? (await listFirmCases(ctx.firm.id)).map((c) => ({ id: c.id, title: c.title }))
    : [];

  /**
   * THE ATTACHMENT GATE. The conflict check and the analysis are offered only
   * when this request carries a document, because an in-house team asked for a
   * ticket they answer, not a matter they open, and neither control earns its
   * space on a request that is only a question.
   *
   * Gated on the attachments the analysis can actually READ, which is the
   * subset backed by a `firm_documents` row (origin 'chat'). Files recorded on
   * `intake_answers.attachments` (origin 'filed') are not `firm_documents`
   * rows, so the route cannot resolve or authorize them by id. Counting them
   * here would show a control that then refuses, which is worse than not
   * showing it. On production data today neither kind exists on any request,
   * so both sections are hidden everywhere: that is the instruction, not a
   * defect.
   */
  const analyzableAttachments = conv.ok
    ? conv.documents.filter((d) => d.origin === 'chat')
    : [];
  const hasAttachments = analyzableAttachments.length > 0;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* The rail collapses on entry so the ticket gets the width, and the
          prior state is restored on the way out. The way back in is the Menu
          tab (a button, so Tab and Enter reach it) or, on a mouse, resting the
          pointer at the left edge of the window. */}
      <RequestSidebarFocus />

      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/inbox"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Requests</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={intake.id}>{ref}</MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {ticketTitle}
        </h1>
        {/* Meta row: the live state as a pill, the fixed facts as quiet
            chips, then the provenance as a plain sentence on the SAME line.
            On its own line it read as a caption on the title; beside the
            pills it reads as what it is, the last and quietest fact in a
            row that gets quieter left to right. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <StatusPill dot color={workflowColor(workflow)}>
            <T>{WORKFLOW_LABEL[workflow]}</T>
          </StatusPill>
          {priority && (
            <Chip>
              <span data-no-translate>{priority}</span>
            </Chip>
          )}
          {/* Which way a signature runs on this ticket, when it runs at all.
              It changes what the legal team is looking at: on an inbound one
              the counterparty wrote the document, so the attachment is the
              request rather than a supporting file. Neutral, like the rest of
              this row - the accent is spent on the action bar's primary. */}
          {directionLabel && (
            <Chip>
              <T>{directionLabel}</T>
            </Chip>
          )}
          {/* Neutral, not accent. The accent is spent once on this screen and
              it is spent on the action bar's primary, which is the thing the
              screen exists to do. A gold chip beside a gold button is two
              claims and the reader obeys neither. */}
          {isEmployeeReq && (
            <Chip>
              <T>In-house</T> · <span data-no-translate>{submittedBy}</span>
            </Chip>
          )}
          {/* Age and channel, as a sentence rather than as two more chips:
              neither is a state anyone acts on, and a row of five badges
              stops reading as a hierarchy. */}
          <span className="text-[12px] text-muted">
            <T>opened</T>{' '}
            {opened ? <span data-no-translate>{opened}</span> : <T>recently</T>}{' '}
            <T>via</T>{' '}
            {channel === 'partner' ? (
              <T>the partner app</T>
            ) : channel === 'portal' ? (
              <T>the employee portal</T>
            ) : (
              <T>the firm workspace</T>
            )}
          </span>
        </div>
      </header>

      {/* THE ACTION BAR. Every control that changes this record, in one
          bordered strip: the inline selects, then the deadline, then the
          secondary and the primary.

          Where these were before, because it is the point of the change:
          the owner select was three sections down inside People, the folder
          select was in a sticky highlights row above the record, taking the
          matter on was the first card of "Matter & next steps", and
          declining it was the second. Four places, none of them next to
          each other, for the four things this screen exists to do. */}
      <ActionBar
        trailing={
          <>
            {deadline && (
              <p
                className={`text-[12.5px] ${
                  deadline.breached
                    ? 'font-semibold text-danger-text'
                    : 'text-muted'
                }`}
              >
                {deadline.kind === 'due' ? (
                  deadline.breached ? (
                    <T>Due date passed</T>
                  ) : (
                    <T>Due</T>
                  )
                ) : deadline.breached ? (
                  <T>Reminder passed</T>
                ) : (
                  <T>Reminder</T>
                )}{' '}
                <span data-no-translate>{formatDate(new Date(deadline.at))}</span>
              </p>
            )}
            {/* Taking the request on as a matter used to be the bar's
                primary. It is gone deliberately: an in-house team answers
                requests, it does not open matters from them.

                THE LINK TO A MATTER A REQUEST PRODUCED BEFORE THAT CHANGE IS
                THE ONE THING THAT MUST NOT GO. It used to be the action on
                the Matter panel in the rail, and the owner asked for that
                panel to go. Two production requests were genuinely converted
                while the write path existed, and this link is the only screen
                in the product that points at their cases, so it moves here
                rather than leaving with the panel it happened to live in.
                Drawn only when case_id is set, so it is never an arrow to
                nothing. */}
            {caseId && (
              <Link
                href={`/counsel/cases/${caseId}`}
                className="whitespace-nowrap text-[12.5px] text-muted transition-colors hover:text-foreground hover:underline"
              >
                <T>Open the matter &rarr;</T>
              </Link>
            )}
            <DecideRequest
              firmId={ctx.firm.id}
              intakeId={intake.id}
              decision={decision}
            />
          </>
        }
      >
        {/* The owner select used to sit here. It is now one field of the
            management block below, with the rest of the fields the team runs
            this ticket by, rather than being the one of them that lives
            somewhere else. It is not in both places: a control drawn twice is
            two controls that can disagree about what they show. */}
        <FolderPicker
          firmId={ctx.firm.id}
          intakeId={intake.id}
          current={currentFolder}
          folders={requestFolders}
        />
      </ActionBar>

      {/* ONE RULE SPLITS THESE TWO COLUMNS. What the EMPLOYEE wrote is on the
          left. What the FIRM does about it is on the right.

          So the left is now the matter, the intake questions, the documents
          they attached and the conversation, and nothing else. The conflict
          check, the decision, the analysis, Analyze and scheduling a meeting
          were all in that column and are all operations rather than anything
          the employee said, so they have moved.

          The rail is wider than it was (380 rather than 340) because it now
          carries controls rather than only readouts, and because the nav rail
          collapsing on this route gave the page the width to spend. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <TicketManagement
            firmId={ctx.firm.id}
            intakeId={intake.id}
            state={workflow}
            assignee={conv.ok ? conv.assignee : null}
            people={conv.ok ? conv.mentionables : []}
            priority={priority}
            followUpOn={intake.follow_up_on ?? ''}
            dueOn={intake.due_on ?? ''}
            reminderAt={String(ans.reminder_at ?? '')}
          />

          {/* The record, as one card of collapsible sections. The sections
              keep their per-reader collapsed state; the card is what stops
              nine of them reading as nine separate documents. */}
          <div className="card overflow-hidden">
            {/* Lead with the matter itself: what was actually asked for,
                before any of the metadata about it. */}
            <RecordSection id="matter" title="The matter">
              {intake.matter_summary ? (
                <p
                  data-no-translate
                  className="max-w-[70ch] whitespace-pre-wrap text-[14.5px] leading-relaxed text-foreground"
                >
                  {intake.matter_summary}
                </p>
              ) : (
                <p className="text-[13px] text-muted">
                  <T>No summary was provided with this request.</T>
                </p>
              )}
              {/* The fixed facts about the request, under the words the
                  employee actually wrote. These were two panels in the right
                  rail, Matter and Request details, until the owner asked for
                  the rail to carry neither. They are here rather than gone
                  because Jurisdiction and Confidentiality render nowhere else
                  on this screen and Type only reaches the title when nothing
                  supplied a subject. Only the ones that were filled are drawn,
                  so this is never a heading over nothing. */}
              {recordFacts.length > 0 && (
                <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-edge pt-4 sm:grid-cols-2">
                  {recordFacts.map((f) => (
                    <div key={f.label}>
                      <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                        <T>{f.label}</T>
                      </dt>
                      <dd data-no-translate className="text-[13.5px] text-foreground">
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </RecordSection>

            {/* What the employee filed about the agreement itself. Shared
                with the employee's page: these are their own words, so they
                belong in this column and in the jsonb. */}
            {contractDetails.length > 0 && (
              <RecordSection
                id="contract"
                title="Contract details"
                count={contractDetails.length}
              >
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {contractDetails.map((f) => (
                    <div key={f.label}>
                      <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                        <T>{f.label}</T>
                      </dt>
                      <dd data-no-translate className="text-[13.5px] text-foreground">
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </RecordSection>
            )}

            {questionAnswers.length > 0 && (
              <RecordSection
                id="questions"
                title="Intake questions"
                count={questionAnswers.length}
              >
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {questionAnswers.map((q) => (
                    <div key={q.id}>
                      <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                        {q.label}
                      </dt>
                      <dd className="text-[13.5px] text-foreground">{q.value}</dd>
                    </div>
                  ))}
                </dl>
              </RecordSection>
            )}

            {conv.ok && (
              <RecordSection
                id="documents"
                title="Documents"
                count={conv.documents.length}
              >
                {/* `signing` is what puts "Send for signature" beside each
                    document that is a real firm_documents row, so the team
                    never leaves the ticket to send one. The employee's copy of
                    this panel in app/portal/[id]/page.tsx passes nothing, so
                    the control does not exist there. */}
                <IntakeWorkPanel
                  intakeId={intake.id}
                  canManage
                  embedded
                  signing={{
                    firmId: ctx.firm.id,
                    // The direction the person filing chose, carried straight
                    // through. A ticket that is not a signature question at
                    // all reads null here and falls back to outbound, which
                    // is what sending one of its documents has always meant.
                    direction: readSignatureDirection(ans.signature_direction) ?? 'outbound',
                  }}
                  sections={['documents', 'requests']}
                  assignee={conv.assignee}
                  participants={conv.participants}
                  people={conv.mentionables}
                  documents={conv.documents}
                  uploadRequests={conv.uploadRequests}
                />
              </RecordSection>
            )}

          </div>

          {conv.ok && (
            <IntakeConversation
              intakeId={intake.id}
              viewerRole="legal"
              viewerUserId={conv.userId}
              canPost={conv.canPost}
              canUseInternal={conv.canUseInternal}
              initialMessages={conv.messages}
              mentionables={conv.mentionables}
              emptyHint="No messages yet. Reply here and the requester is notified straight away."
            />
          )}
        </div>

        {/* The aside is what the firm knows about this request and what the
            firm does about it, in that order: the people and the matter
            first, because they are read, then the operations, because they
            are acted on and a reader who wanted them came looking.

            The operations are ONE card of collapsible sections rather than
            five more panels. RecordSection is what the record itself uses and
            it keeps each section's state per reader, so a team that never
            runs a conflict check on employee requests collapses it once. Five
            separate cards would have been five headers and a rail nobody
            reaches the bottom of. */}
        <aside className="space-y-4">
          <PanelCard title={<T>{vocab.client}</T>}>
            <p
              data-no-translate
              className="text-[14px] font-semibold text-foreground"
            >
              {requester}
            </p>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <T>Email</T>
                </dt>
                <dd className="break-words text-[13px] text-foreground">
                  {intake.client_email ? (
                    <span data-no-translate>{intake.client_email}</span>
                  ) : (
                    <T>Not set</T>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <T>Phone</T>
                </dt>
                <dd className="text-[13px] text-foreground">
                  {intake.client_phone ? (
                    <span data-no-translate>{intake.client_phone}</span>
                  ) : (
                    <T>Not set</T>
                  )}
                </dd>
              </div>
            </dl>
          </PanelCard>

          {/* The Matter panel stood here, and the Request details panel at
              the foot of this rail. Both are gone at the owner's request.
              Their facts are not: they moved into "The matter" on the record
              in the left column, which is where the service desk he works
              from puts them too. The link to an already-converted case moved
              to the action bar. */}

          {conv.ok && (
            <PanelCard title={<T>People</T>}>
              <IntakeWorkPanel
                intakeId={intake.id}
                canManage
                embedded
                showOwner={false}
                sections={['people']}
                assignee={conv.assignee}
                participants={conv.participants}
                people={conv.mentionables}
                documents={conv.documents}
                uploadRequests={conv.uploadRequests}
              />
            </PanelCard>
          )}

          {(intake.opposing_parties?.length > 0 ||
            intake.related_parties?.length > 0) && (
            <PanelCard title={<T>Parties</T>}>
              <dl className="space-y-2">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    <T>Other parties</T>
                  </dt>
                  <dd className="text-[13px] text-foreground">
                    {intake.opposing_parties?.length ? (
                      <span data-no-translate>
                        {intake.opposing_parties.join(', ')}
                      </span>
                    ) : (
                      <T>None</T>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    <T>Related parties</T>
                  </dt>
                  <dd className="text-[13px] text-foreground">
                    {intake.related_parties?.length ? (
                      <span data-no-translate>
                        {intake.related_parties.join(', ')}
                      </span>
                    ) : (
                      <T>None</T>
                    )}
                  </dd>
                </div>
              </dl>
            </PanelCard>
          )}

          {/* Signing on this ticket's own documents. Rendered only when
              there is some: a header over "None" would imply the firm had
              looked and found nothing, when the ordinary case is that
              nothing was ever sent.

              TITLED "Signing", NOT "Signed documents", which is what it
              said until it was rendered and looked at. The list contains
              documents that are signed, documents that were sent and are
              still waiting, and documents with a request that has not gone
              out, so a heading promising signatures was describing a third
              of its own rows. */}
          {signing.length > 0 && (
            <PanelCard title={<T>Signing</T>}>
              <ul className="space-y-2.5">
                {signing.map((d) => (
                  <li key={d.documentId}>
                    <span
                      data-no-translate
                      className="block truncate text-[13px] text-foreground"
                      title={d.name}
                    >
                      {d.name}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted">
                      {d.completedAt ? (
                        <>
                          <T>Signed</T>{' '}
                          <span data-no-translate>
                            {formatDate(new Date(d.completedAt))}
                          </span>
                        </>
                      ) : d.sentAt ? (
                        <>
                          <T>Sent</T>{' '}
                          <span data-no-translate>
                            {formatDate(new Date(d.sentAt))}
                          </span>
                          {' · '}
                          <T>not signed yet</T>
                        </>
                      ) : (
                        <T>Not sent yet</T>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelCard>
          )}

          {/* What else this person has brought the legal team. Firm members
              can already list every intake in the firm; this saves the
              search on the screen where the question comes up. */}
          {requesterHistory.length > 0 && (
            <PanelCard
              title={<T>Their other requests</T>}
              action={
                <Link
                  href="/counsel/intake"
                  className="text-[12px] text-muted hover:text-foreground hover:underline"
                >
                  <T>See all</T>
                </Link>
              }
            >
              <ul className="space-y-2.5">
                {requesterHistory.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/counsel/intake/${r.id}`}
                      className="group block"
                    >
                      <span
                        data-no-translate
                        className="block truncate text-[13px] text-foreground group-hover:underline"
                      >
                        {r.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-muted">
                        <span data-no-translate>
                          {r.status.replace(/_/g, ' ')}
                        </span>
                        {' · '}
                        {relativeTime(r.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </PanelCard>
          )}

          {/* THE LEGAL TEAM'S OWN FIELDS. In the rail because they are what
              the firm records about the request, not what the employee said,
              and on the legal side only: the employee's page never selects
              these columns. tests/employee-payload-scope.test.ts holds that. */}
          {showAdmin && (
            <AdministrativeTools
              firmId={ctx.firm.id}
              intakeId={intake.id}
              fields={legalFields}
              matters={matters}
              closeNotes={decision?.reason || null}
            />
          )}

          {/* WHAT THE FIRM DOES ABOUT THIS REQUEST. Every one of these was in
              the main column, among the employee's own words, which is what
              this change is for. */}
          <div className="card overflow-hidden">
            <div className="border-b border-edge px-4 py-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                <T>Legal team actions</T>
              </h2>
            </div>

            {hasAttachments && (
              <RecordSection id="conflict" title="Conflict check">
                <ConflictCheckPanel
                  firmId={ctx.firm.id}
                  intakeId={intake.id}
                  status={intake.status}
                  results={intake.conflict_results}
                  notes={intake.conflict_check_notes}
                />
              </RecordSection>
            )}

            {/* Declining or closing out stood here as a standing section,
                reached by a button in the action bar that only scrolled to
                it. It is now the modal that button raises, so the way in and
                the reason it asks for are one thing. See decide-request.tsx. */}

            {ans.review != null &&
              typeof ans.review === 'object' &&
              'grade' in (ans.review as object) && (
                <RecordSection
                  id="review"
                  title="Advottic Review"
                  defaultOpen={false}
                >
                  <ReviewScorecard
                    data={ans.review as DocScorecard}
                    audience="legal"
                  />
                </RecordSection>
              )}

            {/* The studio that used to sit here seeded a textarea with the
                request summary, so the copy said "the submitted document"
                while the thing analysed was whatever the box held. It now
                reads the attachments and only the attachments. */}
            {hasAttachments && (
              <RecordSection id="analyze" title="Analyze" defaultOpen={false}>
                <AnalyzeAttachments
                  intakeId={intake.id}
                  documentNames={analyzableAttachments.map((d) => d.name)}
                />
              </RecordSection>
            )}

            <RecordSection id="signing" title="Send for signature" defaultOpen={false}>
              <RequestActions />
            </RecordSection>

            <RecordSection
              id="meeting"
              title="Schedule a meeting"
              defaultOpen={false}
            >
              <ScheduleMeetingPanel
                firmId={ctx.firm.id}
                intakeId={intake.id}
                defaultTitle={`Advottic: ${ticketTitle}`}
              />
            </RecordSection>
          </div>

        </aside>
      </div>
    </div>
  );
}
