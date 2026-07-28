import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { IntakeConversation } from '@/components/intake/IntakeConversation';
import { WorkspaceShell } from '@/components/intake/WorkspaceShell';
import { RecordSection } from '@/components/intake/RecordSection';
import { IntakeWorkPanel } from '@/components/intake/IntakeWorkPanel';
import { loadIntakeConversationAction } from '@/lib/intake-conversation';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request · Portal' };

// Plain-language status for employees - never the firm's internal
// conflict-check vocabulary.
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'Received',
  conflict_check_passed: 'In review',
  conflict_check_flagged: 'In review',
  engaged: 'Accepted',
  rejected: 'Closed',
};
const STATUS_TONE: Record<string, string> = {
  Received: 'bg-forest-800/50 text-cream-100/85 ring-forest-700/40',
  'In review': 'bg-amber-950/30 text-amber-200 ring-amber-700/40',
  Accepted: 'bg-emerald-950/30 text-emerald-200 ring-emerald-700/40',
  Closed: 'bg-forest-800/50 text-cream-100/70 ring-forest-700/40',
};
// The employee-visible journey. We collapse the firm's internal
// states onto three legible milestones.
const STEPS = ['Received', 'In review', 'Decision'] as const;

export default async function PortalRequestPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const admin = createAdminSupabase();
  if (!admin) notFound();
  const { data } = await admin
    .from('firm_matter_intakes')
    .select(
      'id, firm_id, created_by, client_name, matter_type, matter_summary, status, created_at, intake_answers',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const intake = data as {
    id: string;
    firm_id: string;
    created_by: string | null;
    client_name: string;
    matter_type: string | null;
    matter_summary: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  };
  // Hard ownership gate: an employee may only ever see THEIR OWN
  // request in THEIR firm. Anything else is a 404 (never leak that
  // the row exists).
  if (
    intake.firm_id !== persona.firm.id ||
    intake.created_by !== user.id
  ) {
    notFound();
  }

  const label = STATUS_LABEL[intake.status] ?? 'Received';
  const tone = STATUS_TONE[label] ?? STATUS_TONE.Received;
  const isDecision = label === 'Accepted' || label === 'Closed';
  const currentStep = isDecision ? 2 : label === 'In review' ? 1 : 0;

  const ans = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const meta: Array<{ label: string; value: string }> = (
    [
      ['Request type', 'request_type'],
      ['Priority', 'priority'],
      ['Confidentiality', 'confidentiality'],
      ['Due by', 'due_by'],
      ['Expiry', 'expiry'],
    ] as const
  )
    .map(([l, k]) => ({ label: l, value: String(ans[k] ?? '').trim() }))
    .filter((m) => m.value.length > 0);

  // Let the employee @mention a specific person on the legal team.
  const { data: memRows } = await admin
    .from('firm_members')
    .select('user_id, display_name')
    .eq('firm_id', persona.firm.id)
    .limit(100);
  const conv = await loadIntakeConversationAction(intake.id);
  void memRows; // the conversation resolves its own mentionable people

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/portal"
          className="text-cream-100/60 hover:text-cream-100"
        >
          &larr; My requests
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">{persona.firm.name}</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100 break-words">
            {intake.client_name}
          </h1>
          <p className="text-[12px] text-cream-100/55 mt-1">
            {intake.matter_type ?? 'Request'}
            {' · filed '}
            {new Date(intake.created_at).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
        >
          {label}
        </span>
      </header>

      {/* Milestone strip */}
      <section className="card p-5">
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <li key={s} className="flex-1 flex items-center gap-2">
                <div className="flex flex-col items-center flex-1">
                  <span
                    className={`h-7 w-7 rounded-full inline-flex items-center justify-center text-[12px] font-bold ring-1 ${
                      done || active
                        ? 'bg-gold-500/20 text-gold-200 ring-gold-500/40'
                        : 'bg-forest-900/40 text-cream-100/60 ring-forest-700/40'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span
                    className={`mt-1.5 text-[11px] ${
                      active
                        ? 'text-cream-100 font-semibold'
                        : 'text-cream-100/55'
                    }`}
                  >
                    {s === 'Decision' && isDecision ? label : s}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span
                    className={`h-px flex-1 ${
                      i < currentStep
                        ? 'bg-gold-500/40'
                        : 'bg-forest-700/40'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Same shape as the legal team's view: the request in the centre with
          its own scroll, the conversation with legal down the right. */}
      <WorkspaceShell
        mainLabel="Your request"
        sideLabel="Conversation with legal"
        side={
          conv.ok ? (
            <IntakeConversation
              fill
              intakeId={intake.id}
              viewerRole="employee"
              viewerUserId={conv.userId}
              canPost={conv.canPost}
              canUseInternal={false}
              initialMessages={conv.messages}
              mentionables={conv.mentionables}
              emptyHint="No messages yet. Ask a question here and your legal team is notified right away."
            />
          ) : null
        }
      >
        {meta.length > 0 && (
          <RecordSection id="portal-details" title="Request details">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              {meta.map((m) => (
                <div key={m.label}>
                  <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cream-100/50">
                    {m.label}
                  </dt>
                  <dd className="text-[13.5px] text-cream-100/90">{m.value}</dd>
                </div>
              ))}
            </dl>
          </RecordSection>
        )}

        {intake.matter_summary && (
          <RecordSection id="portal-summary" title="What you submitted">
            <p className="max-w-[70ch] whitespace-pre-wrap text-[14px] leading-relaxed text-cream-100/85">
              {intake.matter_summary}
            </p>
          </RecordSection>
        )}

        {conv.ok && (
          <RecordSection id="portal-documents" title="Documents" count={conv.documents.length}>
            <IntakeWorkPanel
              intakeId={intake.id}
              canManage={false}
              sections={['documents']}
              assignee={conv.assignee}
              participants={conv.participants}
              people={conv.mentionables}
              documents={conv.documents}
              uploadRequests={[]}
            />
          </RecordSection>
        )}

        {conv.ok && (
          <RecordSection id="portal-people" title="Who is on this" count={conv.participants.length}>
            <IntakeWorkPanel
              intakeId={intake.id}
              canManage={false}
              sections={['people']}
              assignee={conv.assignee}
              participants={conv.participants}
              people={conv.mentionables}
              documents={conv.documents}
              uploadRequests={[]}
            />
          </RecordSection>
        )}

        {ans.review != null && typeof ans.review === 'object' && 'grade' in (ans.review as object) && (
          <RecordSection id="portal-review" title="Advottic Review" defaultOpen={false}>
            <ReviewScorecard data={ans.review as DocScorecard} audience="employee" />
          </RecordSection>
        )}
      </WorkspaceShell>
    </div>
  );
}
