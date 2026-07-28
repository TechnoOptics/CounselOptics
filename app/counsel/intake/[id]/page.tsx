import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmMembers } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { ConflictCheckPanel } from './conflict-check-panel';
import { IntakeConversation } from '@/components/intake/IntakeConversation';
import { IntakeWorkPanel } from '@/components/intake/IntakeWorkPanel';
import { WorkspaceShell } from '@/components/intake/WorkspaceShell';
import { RecordSection } from '@/components/intake/RecordSection';
import { SectionJump } from '@/components/intake/SectionJump';
import { ticketRef } from '@/lib/intake-conversation-types';
import { loadIntakeConversationAction } from '@/lib/intake-conversation';
import type { ThreadMessage } from '@/lib/intake-thread';
import {
  readRequestFolders,
  readIntakeFolder,
} from '@/lib/request-folders';
import { FolderPicker } from './folder-picker';
import { ScheduleMeetingPanel } from './schedule-meeting';
import { RequestActions } from './request-actions';
import { AnalyzeStudio } from '@/app/counsel/analyze/analyze-studio';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake · Counsel' };

const STATUS_TONE: Record<string, string> = {
  in_progress:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  conflict_check_passed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  conflict_check_flagged:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  engaged:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
};

export default async function IntakeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
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

  const tone = STATUS_TONE[intake.status] ?? STATUS_TONE.in_progress;

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
  // What this request IS, not who filed it — partner tickets carry their own
  // subject; everything else falls back to the matter type.
  const ticketTitle =
    String(ans.subject ?? '').trim() ||
    (intake.matter_type ?? '').trim() ||
    intake.client_name;
  const requester = intake.client_name;
  const dueBy = String(ans.due_by ?? '').trim();

  // The rail is the conversation and nothing else, so the thread gets the
  // entire column height. Documents live at the foot of the record instead.
  const rail = conv.ok ? (
    <IntakeConversation
      fill
      intakeId={intake.id}
      viewerRole="legal"
      viewerUserId={conv.userId}
      canPost={conv.canPost}
      canUseInternal={conv.canUseInternal}
      initialMessages={conv.messages}
      mentionables={conv.mentionables}
      emptyHint="No messages yet. Reply here and the requester is notified straight away."
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-col gap-3 animate-fade-up">
      {/* Compact identity bar. Everything below scrolls; this does not. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Link
          href="/counsel/inbox"
          className="text-[12.5px] text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Requests</T>
        </Link>
        <span className="font-mono text-[12px] font-semibold text-gold-700 dark:text-gold-300">
          {ref}
        </span>
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {ticketTitle}
        </h1>
        {isEmployeeReq && (
          <span className="rounded-full bg-gold-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold-700 ring-1 ring-gold-500/30 dark:text-gold-200">
            <T>In-house</T> · {submittedBy}
          </span>
        )}
        <SectionJump target="meeting">
          <span aria-hidden>📅</span>
          <T>Schedule meeting</T>
        </SectionJump>
        <SectionJump target="documents">
          <span aria-hidden>📄</span>
          <T>Documents</T>
          {conv.ok && conv.documents.length > 0 && (
            <span className="rounded-full bg-ink-100 px-1.5 text-[10.5px] font-semibold text-ink-600 dark:bg-forest-800 dark:text-cream-100/70">
              {conv.documents.length}
            </span>
          )}
        </SectionJump>
        <span
          className={`inline-flex shrink-0 items-center rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
        >
          {intake.status.replace(/_/g, ' ')}
        </span>
      </div>

      <WorkspaceShell side={rail}>
        {/* Highlights: the few facts you need on every scroll position. */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-100 bg-white/95 px-5 py-3 backdrop-blur dark:border-forest-800/60 dark:bg-forest-900/90">
          <Highlight label="Requester" value={requester} />
          <Highlight label="Type" value={intake.matter_type ?? '—'} />
          {priority && <Highlight label="Priority" value={priority} />}
          {dueBy && <Highlight label="Due" value={dueBy} />}
          <Highlight
            label="Owner"
            value={conv.ok && conv.assignee ? conv.assignee.name : 'Unassigned'}
          />
          <div className="ml-auto">
            <FolderPicker
              firmId={ctx.firm.id}
              intakeId={intake.id}
              current={currentFolder}
              folders={requestFolders}
            />
          </div>
        </div>

        {/* Lead with the matter itself: what was actually asked for, before
            any of the metadata about it. */}
        <RecordSection id="matter" title="The matter">
          {intake.matter_summary ? (
            <p className="max-w-[70ch] whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-800 dark:text-cream-100/90">
              {intake.matter_summary}
            </p>
          ) : (
            <p className="text-[13px] text-ink-400 dark:text-cream-100/40">
              <T>No summary was provided with this request.</T>
            </p>
          )}
        </RecordSection>

        {meta.length > 0 && (
          <RecordSection id="details" title="Request details">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              {meta.map((m) => (
                <div key={m.label}>
                  <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                    <T>{m.label}</T>
                  </dt>
                  <dd className="text-[13.5px] text-forest-900 dark:text-cream-100">{m.value}</dd>
                </div>
              ))}
            </dl>
          </RecordSection>
        )}

        {questionAnswers.length > 0 && (
          <RecordSection id="questions" title="Intake questions" count={questionAnswers.length}>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {questionAnswers.map((q) => (
                <div key={q.id}>
                  <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                    {q.label}
                  </dt>
                  <dd className="text-[13.5px] text-forest-900 dark:text-cream-100">{q.value}</dd>
                </div>
              ))}
            </dl>
          </RecordSection>
        )}


        <RecordSection id="contact" title="Contact" defaultOpen={false}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                <T>Email</T>
              </dt>
              <dd className="break-words text-[13.5px] text-forest-900 dark:text-cream-100">
                {intake.client_email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                <T>Phone</T>
              </dt>
              <dd className="text-[13.5px] text-forest-900 dark:text-cream-100">
                {intake.client_phone ?? '—'}
              </dd>
            </div>
          </dl>
        </RecordSection>

        {(intake.opposing_parties?.length > 0 || intake.related_parties?.length > 0) && (
          <RecordSection id="parties" title="Parties" defaultOpen={false}>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                  <T>Other parties</T>
                </p>
                <p className="text-[13.5px] text-forest-900 dark:text-cream-100">
                  {intake.opposing_parties?.length ? intake.opposing_parties.join(', ') : '—'}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                  <T>Related parties</T>
                </p>
                <p className="text-[13.5px] text-forest-900 dark:text-cream-100">
                  {intake.related_parties?.length ? intake.related_parties.join(', ') : '—'}
                </p>
              </div>
            </div>
          </RecordSection>
        )}

        {conv.ok && (
          <RecordSection id="people" title="People" count={conv.participants.length}>
            <IntakeWorkPanel
              intakeId={intake.id}
              canManage
              embedded
              sections={['people']}
              assignee={conv.assignee}
              participants={conv.participants}
              people={conv.mentionables}
              documents={conv.documents}
              uploadRequests={conv.uploadRequests}
            />
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

        <RecordSection id="actions" title="Matter &amp; next steps">
          <RequestActions
            firmId={ctx.firm.id}
            intakeId={intake.id}
            currentReminder={String(ans.reminder_at ?? '')}
            caseId={(intake as { case_id?: string | null }).case_id ?? null}
          />
        </RecordSection>

        {ans.review != null && typeof ans.review === 'object' && 'grade' in (ans.review as object) && (
          <RecordSection id="review" title="Advottic Review" defaultOpen={false}>
            <ReviewScorecard data={ans.review as DocScorecard} audience="legal" />
          </RecordSection>
        )}

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

        <RecordSection id="meeting" title="Schedule a meeting" defaultOpen={false}>
          <ScheduleMeetingPanel
            firmId={ctx.firm.id}
            intakeId={intake.id}
            defaultTitle={`Advottic: ${ticketTitle}`}
          />
        </RecordSection>

        <RecordSection id="analyze" title="Analyze" defaultOpen={false}>
          <p className="mb-2 text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>Run an AI breakdown of what the submitted document means, how the law
            applies, its bias, and the risky clauses.</T>
          </p>
          <AnalyzeStudio embedded initialText={String(intake.matter_summary ?? '')} />
        </RecordSection>

      </WorkspaceShell>
    </div>
  );
}

/** One fact in the sticky highlights strip. */
function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
        <T>{label}</T>
      </p>
      <p className="truncate text-[13px] font-medium text-forest-900 dark:text-cream-100">
        {value}
      </p>
    </div>
  );
}
