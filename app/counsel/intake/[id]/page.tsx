import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmMembers } from '@/lib/firm-storage';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { createServerSupabase } from '@/lib/supabase/server';
import { ConflictCheckPanel } from './conflict-check-panel';
import { IntakeConversation } from '@/components/intake/IntakeConversation';
import { IntakeWorkPanel } from '@/components/intake/IntakeWorkPanel';
import { RecordSection } from '@/components/intake/RecordSection';
import { ticketRef } from '@/lib/intake-conversation-types';
import { loadIntakeConversationAction } from '@/lib/intake-conversation';
import type { ThreadMessage } from '@/lib/intake-thread';
import {
  readRequestFolders,
  readIntakeFolder,
} from '@/lib/request-folders';
import { FolderPicker } from './folder-picker';
import { IntakeOwnerSelect } from './intake-owner-select';
import { ConvertToMatter } from './convert-to-matter';
import { DecideJump } from './decide-jump';
import { ScheduleMeetingPanel } from './schedule-meeting';
import { RequestActions } from './request-actions';
import { DecideRequest } from './decide-request';
import { AnalyzeStudio } from '@/app/counsel/analyze/analyze-studio';
import { StatusPill, PILL_COLORS, PILL_DEFAULT } from '@/components/counsel/StatusPill';
import { ActionBar, Chip, MonoRef, PanelCard, relativeTime } from '@/components/counsel/patterns';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';
import { T } from '@/components/i18n/LocaleProvider';
import { intakeChannel, intakeDeadline } from '@/lib/intake-detail';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake · Counsel' };

// One hex per status; StatusPill derives the fill and the border from
// it. An unlisted status falls back to gold rather than to silence.
//
// `converted`, `rejected` and `closed` were all missing, so a request the
// team had taken on and one it had turned down both wore the gold fallback,
// which reads as the accent rather than as a state. The two decided statuses
// share `quiet` because that is the grey lib/portal-status.ts already paints
// "Closed" with, so the employee's chip and the firm's chip agree.
const STATUS_COLOR: Record<string, string> = {
  in_progress: PILL_COLORS.neutral,
  conflict_check_passed: PILL_COLORS.good,
  conflict_check_flagged: PILL_COLORS.flagged,
  engaged: PILL_COLORS.good,
  converted: PILL_COLORS.good,
  rejected: PILL_COLORS.quiet,
  closed: PILL_COLORS.quiet,
};

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
    created_by: string | null;
    created_at: string;
  };
  if (intake.firm_id !== ctx.firm.id) notFound();

  const statusColor = STATUS_COLOR[intake.status] ?? PILL_DEFAULT;

  // In-house metadata captured by the typed intake form. Stored in the
  // schema-less intake_answers JSON column so it renders without a
  // migration. Only the fields that were actually filled are shown.
  const ans = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const requestFolders = readRequestFolders(ctx.firm.metadata);
  const currentFolder = readIntakeFolder(intake.intake_answers);
  const meta: Array<{ label: string; value: string }> = (
    [
      ['Request type', 'request_type'],
      ['Submitted by', 'submitted_by'],
      ['Priority', 'priority'],
      ['Confidentiality', 'confidentiality'],
      ['Due by', 'due_by'],
      ['Expiry', 'expiry'],
    ] as const
  )
    .map(([label, key]) => ({ label, value: String(ans[key] ?? '').trim() }))
    .filter((m) => m.value.length > 0);
  // An in-house employee request (filed from /portal) carries a
  // submitted_by. Outside-client matters do not.
  const submittedBy = String(ans.submitted_by ?? '').trim();
  const isEmployeeReq = submittedBy.length > 0;
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

  const ref = String((ans.partner as Record<string, unknown> | undefined)?.externalId ?? '').trim()
    || ticketRef(intake.id);
  const priority = String(ans.priority ?? '').trim();
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

  return (
    <div className="space-y-6 animate-fade-up">
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
          <StatusPill dot color={statusColor}>
            {intake.status.replace(/_/g, ' ')}
          </StatusPill>
          {priority && (
            <Chip>
              <span data-no-translate>{priority}</span>
            </Chip>
          )}
          {isEmployeeReq && (
            <Chip tone="accent">
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
            <DecideJump decided={decision != null} />
            <ConvertToMatter
              firmId={ctx.firm.id}
              intakeId={intake.id}
              caseId={caseId}
            />
          </>
        }
      >
        {conv.ok && (
          <IntakeOwnerSelect
            intakeId={intake.id}
            assignee={conv.assignee}
            people={conv.mentionables}
          />
        )}
        <FolderPicker
          firmId={ctx.firm.id}
          intakeId={intake.id}
          current={currentFolder}
          folders={requestFolders}
        />
      </ActionBar>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-6">
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
            </RecordSection>

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

            <RecordSection id="conflict" title="Conflict check">
              <ConflictCheckPanel
                firmId={ctx.firm.id}
                intakeId={intake.id}
                status={intake.status}
                results={intake.conflict_results}
                notes={intake.conflict_check_notes}
              />
            </RecordSection>

            {/* The other end of the fork the action bar's primary starts.
                The bar's secondary opens this, because declining writes a
                reason the requester reads and the reason is required. */}
            <RecordSection id="decide" title="Decline or close">
              <DecideRequest
                firmId={ctx.firm.id}
                intakeId={intake.id}
                decision={decision}
              />
            </RecordSection>

            {conv.ok && (
              <RecordSection
                id="documents"
                title="Documents"
                count={conv.documents.length}
              >
                <IntakeWorkPanel
                  intakeId={intake.id}
                  canManage
                  embedded
                  sections={['documents', 'requests']}
                  assignee={conv.assignee}
                  participants={conv.participants}
                  people={conv.mentionables}
                  documents={conv.documents}
                  uploadRequests={conv.uploadRequests}
                />
              </RecordSection>
            )}

            <RecordSection
              id="next"
              title="Reminders and signatures"
              defaultOpen={false}
            >
              <RequestActions
                firmId={ctx.firm.id}
                intakeId={intake.id}
                currentReminder={String(ans.reminder_at ?? '')}
              />
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

            <RecordSection id="analyze" title="Analyze" defaultOpen={false}>
              <p className="mb-2 text-[12px] text-muted">
                <T>Run an AI breakdown of what the submitted document means, how the law
                applies, its bias, and the risky clauses.</T>
              </p>
              <AnalyzeStudio
                embedded
                initialText={String(intake.matter_summary ?? '')}
              />
            </RecordSection>
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

        {/* The aside is the people and the matter. The reference product
            puts a device and its installed software here; counsel does not
            track either, and a column of borrowed telemetry would be worse
            than a shorter column. */}
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
                <dd
                  data-no-translate
                  className="break-words text-[13px] text-foreground"
                >
                  {intake.client_email ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <T>Phone</T>
                </dt>
                <dd data-no-translate className="text-[13px] text-foreground">
                  {intake.client_phone ?? '—'}
                </dd>
              </div>
            </dl>
          </PanelCard>

          {/* The arrow appears only once there is a record to open. There
              is no client route to point the card above at, so it has no
              arrow at all rather than a decorative one. */}
          <PanelCard
            title={<T>Matter</T>}
            action={
              caseId ? (
                <Link
                  href={`/counsel/cases/${caseId}`}
                  className="text-[12px] text-accent-text hover:underline"
                >
                  <T>Open the matter &rarr;</T>
                </Link>
              ) : undefined
            }
          >
            <dl className="space-y-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <T>Type</T>
                </dt>
                <dd className="text-[13px] text-foreground">
                  {intake.matter_type ? (
                    <span data-no-translate>{intake.matter_type}</span>
                  ) : (
                    <T>Not set</T>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <T>Jurisdiction</T>
                </dt>
                <dd className="text-[13px] text-foreground">
                  {intake.jurisdiction_state ? (
                    <span data-no-translate>{intake.jurisdiction_state}</span>
                  ) : (
                    <T>Not set</T>
                  )}
                </dd>
              </div>
            </dl>
          </PanelCard>

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
                  <dd data-no-translate className="text-[13px] text-foreground">
                    {intake.opposing_parties?.join(', ') || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    <T>Related parties</T>
                  </dt>
                  <dd data-no-translate className="text-[13px] text-foreground">
                    {intake.related_parties?.join(', ') || '—'}
                  </dd>
                </div>
              </dl>
            </PanelCard>
          )}

          {meta.length > 0 && (
            <PanelCard title={<T>Request details</T>}>
              <dl className="space-y-2">
                {meta.map((m) => (
                  <div key={m.label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                      <T>{m.label}</T>
                    </dt>
                    <dd data-no-translate className="text-[13px] text-foreground">
                      {m.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </PanelCard>
          )}
        </aside>
      </div>
    </div>
  );
}
