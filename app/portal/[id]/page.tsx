import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { IntakeConversation } from '@/components/intake/IntakeConversation';
import { RecordSection } from '@/components/intake/RecordSection';
import { IntakeWorkPanel } from '@/components/intake/IntakeWorkPanel';
import { loadIntakeConversationAction } from '@/lib/intake-conversation';
import { canViewIntake, visibleIntakeIds } from '@/lib/portal-scope';
import {
  isPortalDecision,
  portalStatusLabel,
  portalStatusColor,
} from '@/lib/portal-status';
import { PortalRequestHeader } from '@/components/portal/RequestHeader';
import { PanelCard, MonoRef, relativeTime } from '@/components/counsel/patterns';
import { refFor } from '@/lib/intake-notify';
import { parseDueBy } from '@/lib/portal-due';
import { familyOfType } from '@/lib/portal-request-families';
import { ReviewScorecard } from '@/components/ReviewScorecard';
import type { DocScorecard } from '@/lib/doc-review';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request · Portal' };

/** The anchor the header's "Message legal" link jumps to. */
const CONVERSATION_ID = 'portal-conversation';

/**
 * How many of the requester's other tickets the rail lists. Small on
 * purpose: this is context, not a second inbox, and "My requests" in the
 * breadcrumb is one click away for the full list.
 */
const RELATED_LIMIT = 5;

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
      'id, firm_id, created_by, client_name, matter_type, matter_summary, status, created_at, intake_answers, request_number',
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
    // The reference this page prints and tells the employee to quote. Null on
    // requests filed before 20260817_request_number.sql, which then show the
    // derived REQ- reference they were originally emailed under.
    request_number: string | null;
  };
  // Access gate: your own request, or one you were explicitly invited onto.
  // Anything else is a 404: never leak that the row exists. The rule itself
  // lives in lib/portal-scope.ts, shared with every Hub list, so the page
  // that opens a request and the pages that list it cannot disagree.
  //
  // THIS PAGE READS THROUGH THE ADMIN CLIENT, SO RLS PROTECTS NOTHING HERE.
  // Every panel below is scoped explicitly, in this file or in the helper it
  // calls. Nothing on this page may be added by widening the query above.
  const mayView = await canViewIntake(admin, intake, user.id, persona.firm.id);
  if (!mayView) notFound();

  const label = portalStatusLabel(intake.status);
  const color = portalStatusColor(label);
  const isDecision = isPortalDecision(label);

  const ans = (intake.intake_answers ?? {}) as Record<string, unknown>;
  // The heading is what you asked for, not your own name.
  const ticketTitle =
    String(ans.subject ?? '').trim() ||
    (intake.matter_type ?? '').trim() ||
    intake.client_name;
  // Priority is deliberately NOT here: the facts strip in the header now
  // carries it, and rendering the page showed the rail restating it two
  // inches to the right, which is how a properties panel turns into noise.
  // "Due by" stays even though the strip carries a due date, because the
  // strip says "in 11d" and this says which day, and those are two
  // different questions.
  const meta: Array<{ label: string; value: string }> = (
    [
      ['Request type', 'request_type'],
      ['Confidentiality', 'confidentiality'],
      ['Due by', 'due_by'],
      ['Expiry', 'expiry'],
    ] as const
  )
    .map(([l, k]) => ({ label: l, value: String(ans[k] ?? '').trim() }))
    .filter((m) => m.value.length > 0);

  const conv = await loadIntakeConversationAction(intake.id);

  // The requester's own other tickets, for the rail. Scoped through
  // visibleIntakeIds, which is the same rule every Hub list uses: what you
  // filed, or were invited onto, inside your own firm. It is deliberately
  // NOT "everything this firm holds about this person" - that is a legal
  // team view and it does not belong on the requester's own copy.
  const relatedIds = (
    await visibleIntakeIds(admin, user.id, persona.firm.id)
  ).filter((id) => id !== intake.id);
  const { data: relatedRows } = relatedIds.length
    ? await admin
        .from('firm_matter_intakes')
        .select('id, matter_type, status, created_at, intake_answers')
        .in('id', relatedIds)
        .order('created_at', { ascending: false })
        .limit(RELATED_LIMIT)
    : { data: [] };
  const related = ((relatedRows ?? []) as Record<string, unknown>[]).map((r) => {
    const a = (r.intake_answers ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      title:
        String(a.subject ?? '').trim() ||
        String(r.matter_type ?? '').trim() ||
        'Untitled request',
      label: portalStatusLabel(String(r.status)),
      createdAt: String(r.created_at),
    };
  });

  // The reference this person and the legal team quote at each other.
  // One helper decides it (a partner ticket keeps its own external id),
  // so the portal and every notification say the same thing.
  const reference = refFor(intake);
  const family = familyOfType(intake.matter_type);
  const due = parseDueBy(intake.intake_answers);
  const priority = String(ans.priority ?? '').trim();

  // The firm's decision, when there is one. Stored on intake_answers by
  // decideIntakeAction, cleared again by reopenIntakeAction, so this block
  // disappears if the request is put back.
  const rawDecision = (ans.decision ?? null) as Record<string, unknown> | null;
  const decision =
    rawDecision && typeof rawDecision === 'object' && rawDecision.outcome
      ? {
          outcome: String(rawDecision.outcome),
          reason: String(rawDecision.reason ?? ''),
        }
      : null;

  const hasReview =
    ans.review != null &&
    typeof ans.review === 'object' &&
    'grade' in (ans.review as object);

  return (
    <div className="space-y-5 animate-fade-up">
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
        assigneeName={conv.ok ? (conv.assignee?.name ?? null) : null}
        createdAt={intake.created_at}
        dueAt={due}
        decided={isDecision}
        canMessage={conv.ok && conv.canPost}
        conversationId={CONVERSATION_ID}
      />

      {/* THE SERVICE-DESK GRID. A ticket is a service-desk item, not a
          matter, so it wears the same shape the legal team's own ticket
          page wears: the record down the middle, the properties in a rail,
          the conversation in the flow underneath.

          WHAT THIS REPLACED, because the replacement is the point: a
          WorkspaceShell, the pinned two-pane console used for a case. It
          measured the viewport, pinned itself to 100dvh and gave the record
          its own inner scrollbar with the conversation in a second one
          beside it. docs/DESIGN.md says only one thing scrolls at a time,
          and that shell put two scrollers on a page that also scrolled.
          Here the document scrolls and nothing else does. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* The record, as one card of collapsible sections, which is the
              spelling the legal team's ticket page already uses. */}
          <div className="card overflow-hidden">
            {/* What the firm decided, in the words it used, first because it
                is the answer to the question the whole ticket asked. A
                person reading that their request was declined with nothing
                after it has been told less than nothing. */}
            {decision && (
              <RecordSection id="portal-decision" title="The decision">
                <p className="text-[14px] leading-relaxed text-foreground">
                  {decision.outcome === 'declined'
                    ? 'Your legal team is not taking this on.'
                    : 'Your legal team has closed this out.'}
                </p>
                {decision.reason && (
                  <p
                    data-no-translate
                    className="mt-3 max-w-[70ch] whitespace-pre-wrap text-[14px] leading-relaxed text-foreground"
                  >
                    {decision.reason}
                  </p>
                )}
                <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                  If something here is not right, reply in the conversation and
                  your legal team can pick it back up.
                </p>
              </RecordSection>
            )}

            <RecordSection id="portal-summary" title="What you asked for">
              {intake.matter_summary ? (
                <p
                  data-no-translate
                  className="max-w-[70ch] whitespace-pre-wrap text-[14px] leading-relaxed text-foreground"
                >
                  {intake.matter_summary}
                </p>
              ) : (
                <p className="text-[13px] text-muted">
                  No summary was submitted with this request.
                </p>
              )}
            </RecordSection>

            {conv.ok && (
              <RecordSection
                id="portal-documents"
                title="Documents"
                count={conv.documents.length}
              >
                {conv.documents.length > 0 ? (
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
                ) : (
                  <p className="text-[13px] text-muted">
                    Nothing has been attached to this request yet. Anything you
                    or your legal team share in the conversation is filed here.
                  </p>
                )}
              </RecordSection>
            )}

            {hasReview && (
              <RecordSection
                id="portal-review"
                title="Advottic Review"
                defaultOpen={false}
              >
                <ReviewScorecard
                  data={ans.review as DocScorecard}
                  audience="employee"
                />
              </RecordSection>
            )}
          </div>

          {/* The conversation, in the document flow rather than pinned in a
              pane beside the record. */}
          {conv.ok && (
            <div id={CONVERSATION_ID} className="scroll-mt-16">
              <IntakeConversation
                intakeId={intake.id}
                viewerRole="employee"
                viewerUserId={conv.userId}
                canPost={conv.canPost}
                canUseInternal={false}
                initialMessages={conv.messages}
                mentionables={conv.mentionables}
                emptyHint="No messages yet. Ask a question here and your legal team is notified right away."
              />
            </div>
          )}
        </div>

        {/* The rail: who has this and what you told them. It carries no
            control, because there is nothing here an employee may change.
            It deliberately does NOT carry the parties, the conflict check
            or the firm's document tree: those are the legal team's view of
            this ticket, and they are on the legal team's page. */}
        <aside className="space-y-4">
          {meta.length > 0 && (
            <PanelCard title="Request details">
              <dl className="space-y-2.5">
                {meta.map((m) => (
                  <div key={m.label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {m.label}
                    </dt>
                    <dd data-no-translate className="text-[13px] text-foreground">
                      {m.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </PanelCard>
          )}

          {conv.ok && conv.participants.length > 0 && (
            <PanelCard title="Who is on this">
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
            </PanelCard>
          )}

          {/* Only when there is something to list. A header standing over
              "None" implies a feature that has not happened yet. */}
          {related.length > 0 && (
            <PanelCard
              title="Your other requests"
              action={
                <Link
                  href="/portal/requests"
                  className="text-[12px] text-muted hover:text-foreground hover:underline"
                >
                  See all
                </Link>
              }
            >
              <ul className="space-y-2.5">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/portal/${r.id}`} className="group block">
                      <span
                        data-no-translate
                        className="block truncate text-[13px] text-foreground group-hover:underline"
                      >
                        {r.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-muted">
                        {r.label} · {relativeTime(r.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </PanelCard>
          )}

          {/* One plainly true sentence. An earlier draft said the legal team
              "can see everything on this page", which is close to true and
              not exactly true (their copy also carries internal notes this
              one does not), and a confidentiality claim that is only nearly
              right is worse than no claim. */}
          <p className="px-1 text-[11.5px] leading-relaxed text-muted">
            Quote <MonoRef title={intake.id}>{reference}</MonoRef> if you
            contact your legal team about this outside the portal.
          </p>
        </aside>
      </div>
    </div>
  );
}
