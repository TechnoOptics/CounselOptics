import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplateSubmissionsAction } from '@/lib/template-submissions';
import { listFirmTemplatesAction } from '@/lib/firm-templates';
import {
  canRequestTemplates,
  listRequestableColleagues,
} from '@/lib/template-requests';
import { parseApprovalQueueParams, toApprovalRow } from '@/lib/approval-queue';
import { PageHeader } from '@/components/counsel/ui';
import { SectionLabel } from '@/components/counsel/patterns';
import { ApprovalsQueue } from '@/components/counsel/ApprovalsQueue';
import { AskColleagueCard } from '@/components/counsel/AskColleagueCard';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Document approvals · Counsel' };

/**
 * The review queue. An employee filled a firm template and named an outside
 * recipient; nothing has been sent. Everyone on the legal team can follow what
 * is waiting and where each one has got to. Reading the wording of a document
 * the firm has not agreed to send, and releasing one, are both limited to
 * owners, admins, and attorneys: see canReadSubmissionDocument and
 * canApproveSubmissions in lib/template-approval.ts.
 *
 * ON THE SHAPE OF THIS PAGE, AND ON WHERE THE PROSE WENT.
 *
 * This screen used to open with a four-line subtitle explaining what approving
 * does, a three-line note about who may release, and a two-line empty state in
 * each of the two cards: about eleven lines of explanation above two empty
 * boxes. None of it was wrong. All of it was in the wrong place, because this
 * is a queue somebody opens every morning and onboarding copy in a permanent
 * position is read once and then re-read forever.
 *
 * So the copy is kept and moved, in three directions:
 *
 *   1. What approving DOES now sits in the disclosure at the foot of this
 *      page, closed by default. A first-time reviewer finds it under a heading
 *      that says what it answers; a daily one never opens it again.
 *   2. What approving does is ALSO stated, in the words that fit the actual
 *      delivery, at the moment the reviewer commits: ReviewActions on the
 *      submission page, which already distinguishes the encrypted share from
 *      the signature request. That is the sentence that has to be right, and
 *      it was already there.
 *   3. Who may release is one line here for the member who is affected by it,
 *      and the full explanation is in the same disclosure. The detail page
 *      repeats it where a reader without release rights actually meets it.
 *
 * The section labels sit ABOVE their cards rather than inside them, with the
 * count in the label, which is the shape the rest of this product's list
 * surfaces use.
 *
 * The queue itself is a client component because searching and ticking rows
 * are things a person does between renders. It is handed ApprovalRow, which is
 * TemplateSubmission with the document wording removed: everything a client
 * component holds is serialized into the page, and an agreement the firm has
 * not agreed to send has no business being there. See lib/approval-queue.ts.
 */
export default async function CounselFormApprovalsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const res = await listFirmTemplateSubmissionsAction(ctx.firm.id);
  const rows = (res.submissions ?? []).map(toApprovalRow);
  const params = parseApprovalQueueParams(searchParams);

  /**
   * The middle card's two lists, and whether this member may use it at all.
   *
   * Only what a colleague could actually fill in is offered: a published
   * template, and a person who has signed in to this firm's workspace and has
   * not been deactivated. askColleagueForTemplateAction checks both again
   * against the caller's own session, so a stale option is refused rather than
   * acted on; narrowing here is so nobody is offered a choice that can only
   * fail. Both list helpers carry their own firm gate.
   */
  const canRequest = await canRequestTemplates(ctx.firm.id);
  const [templateList, colleagues] = canRequest
    ? await Promise.all([
        listFirmTemplatesAction(ctx.firm.id),
        listRequestableColleagues(ctx.firm.id),
      ])
    : [null, []];
  const templates = (templateList?.templates ?? [])
    .filter((t) => t.status === 'published')
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title={<T>Document approvals</T>}
        subtitle={
          <T>
            Forms a colleague filled in for someone outside the firm. Approving one
            releases it to the recipient.
          </T>
        }
      />

      {!res.canApprove && (
        <p className="text-[13px] text-muted">
          <T>
            You can follow this queue. Releasing a document, and reading one that has
            not been released, is limited to owners, admins, and attorneys.
          </T>
        </p>
      )}

      {/* The category grouping this card used to carry is gone, and search has
          it instead: a fixed grouping and a chosen order cannot both hold, and
          the order a person clearing a queue wants is whatever has waited
          longest. matchesQuery covers the category, so "nda" still gathers
          them. */}
      <ApprovalsQueue
        rows={rows}
        params={params}
        canApprove={Boolean(res.canApprove)}
        middle={
          canRequest ? (
            <section className="space-y-2 pt-3">
              <SectionLabel>
                <T>Ask a colleague for a form</T>
              </SectionLabel>
              <AskColleagueCard
                firmId={ctx.firm.id}
                templates={templates}
                colleagues={colleagues}
              />
            </section>
          ) : null
        }
      />

      {/* The explanation, kept and moved rather than deleted. Closed by
          default, so it costs a daily reviewer one line of the page and
          answers a first-time one in one click. */}
      <details className="rounded-xl border border-edge bg-surface-2 px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">
          <T>How this queue works</T>
        </summary>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
          <p>
            <T>
              Approving one of these releases it: the finished document goes to the
              outside recipient your colleague named, from the firm. Nothing here has
              been sent yet. The other way out is to send it back with a note, which
              keeps it alive and returns it to the person who filled it in.
            </T>
          </p>
          <p>
            <T>
              Everyone on the legal team can follow this queue: who filled each form in,
              who it is addressed to, and where it has got to. Releasing a document to an
              outside party, and reading the wording of one that has not been released
              yet, is limited to owners, admins, and attorneys.
            </T>
          </p>
        </div>
      </details>
    </div>
  );
}
