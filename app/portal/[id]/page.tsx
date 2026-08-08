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
import { canViewIntake } from '@/lib/portal-scope';
import {
  PORTAL_STEPS,
  isPortalDecision,
  portalStatusLabel,
  portalStatusColor,
  portalStepIndex,
} from '@/lib/portal-status';
import { PortalRequestHeader } from '@/components/portal/RequestHeader';
import { refFor } from '@/lib/intake-notify';
import { parseDueBy } from '@/lib/portal-due';
import { familyOfType } from '@/lib/portal-request-families';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request · Portal' };

// Plain-language status mapping is shared with the requests list - see
// lib/portal-status.ts for why it must not be duplicated here again.
const STEPS = PORTAL_STEPS;

/** The anchor the header's "Message legal" link jumps to. */
const CONVERSATION_ID = 'portal-conversation';

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
  // Access gate: your own request, or one you were explicitly invited onto.
  // Anything else is a 404: never leak that the row exists. The rule itself
  // lives in lib/portal-scope.ts, shared with every Hub list, so the page
  // that opens a request and the pages that list it cannot disagree.
  const mayView = await canViewIntake(admin, intake, user.id, persona.firm.id);
  if (!mayView) notFound();

  const label = portalStatusLabel(intake.status);
  const color = portalStatusColor(label);
  const isDecision = isPortalDecision(label);
  const currentStep = portalStepIndex(label);

  const ans = (intake.intake_answers ?? {}) as Record<string, unknown>;
  // The heading is what you asked for, not your own name.
  const ticketTitle =
    String(ans.subject ?? '').trim() ||
    (intake.matter_type ?? '').trim() ||
    intake.client_name;
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

  // The reference this person and the legal team quote at each other.
  // One helper decides it (a partner ticket keeps its own external id),
  // so the portal and every notification say the same thing.
  const reference = refFor(intake);
  const family = familyOfType(intake.matter_type);
  const due = parseDueBy(intake.intake_answers);
  const priority = String(ans.priority ?? '').trim();
  const confidentiality = String(ans.confidentiality ?? '').trim();

  return (
    <div className="space-y-6 animate-fade-up">
      <PortalRequestHeader
        reference={reference}
        requestId={intake.id}
        title={ticketTitle}
        firmName={persona.firm.name}
        statusLabel={label}
        statusColor={color}
        familyTitle={family?.title ?? null}
        matterType={intake.matter_type}
        priority={priority}
        confidentiality={confidentiality}
        createdAt={intake.created_at}
        dueAt={due}
        steps={STEPS}
        currentStep={currentStep}
        decidedLabel={isDecision ? label : null}
        canMessage={conv.ok && conv.canPost}
        conversationId={CONVERSATION_ID}
      />

      {/* Same shape as the legal team's view: the request in the centre with
          its own scroll, the conversation with legal down the right. */}
      <WorkspaceShell
        mainLabel="Your request"
        sideLabel="Conversation with legal"
        sideId={CONVERSATION_ID}
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
              embedded
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
              embedded
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
