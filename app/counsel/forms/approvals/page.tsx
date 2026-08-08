import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplateSubmissionsAction } from '@/lib/template-submissions';
import { isAwaitingReview } from '@/lib/template-approval';
import { groupByCategory } from '@/lib/document-category';
import { PageHeader } from '@/components/counsel/ui';
import { PanelCard } from '@/components/counsel/patterns';
import { SubmissionList } from '@/components/counsel/SubmissionList';
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
 * On the shape of this page, and on the one piece of the reference it does
 * NOT copy. The reference's approvals screen carries a request form: a card
 * that starts a new approval. Advottic has no such thing to start. Every row
 * in this queue is created by a colleague filling in a form on their own
 * side, and there is no action a reviewer takes here that begins one. The
 * card would have been four controls with nothing behind them, so it is not
 * here. What a reviewer can actually do lives one click in, on the
 * submission itself: approve it, edit it, send it back with a note, decline
 * it.
 */
export default async function CounselFormApprovalsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const res = await listFirmTemplateSubmissionsAction(ctx.firm.id);
  const submissions = res.submissions ?? [];
  const waiting = submissions.filter((s) => isAwaitingReview(s.status));
  const decided = submissions.filter((s) => !isAwaitingReview(s.status));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · self-service</T>}
        title={<T>Document approvals</T>}
        subtitle={
          <T>
            Approving one of these releases it: the finished document goes to the
            outside recipient your colleague named, from the firm. Nothing here has
            been sent yet. The other way out is to send it back with a note, which
            keeps it alive and returns it to the person who filled it in.
          </T>
        }
      />

      {!res.canApprove && (
        <p className="rounded-lg border border-edge bg-surface-2 px-4 py-3 text-[13px] text-muted">
          <T>
            You can follow everything in this queue: who filled each form in, who it is
            addressed to, and where it has got to. Releasing a document to an outside party,
            and reading the wording of one that has not been released yet, is limited to
            owners, admins, and attorneys.
          </T>
        </p>
      )}

      {/* The count lives in the heading because it is the thing a reviewer
          came to find out. It is the length of the list underneath, not a
          separate number that could disagree with it. */}
      <PanelCard
        title={
          <>
            <T>Awaiting decision</T>
            {' · '}
            <span data-no-translate>{waiting.length}</span>
          </>
        }
        bodyClassName={waiting.length === 0 ? 'p-5' : 'p-0'}
      >
        {waiting.length === 0 ? (
          <p className="text-[13px] text-muted">
            <T>
              Nothing waiting on you. A form a colleague fills in and addresses to
              someone outside the company lands here.
            </T>
          </p>
        ) : (
          /**
           * Grouped by the kind of document, so a reviewer can take all the
           * NDAs in one sitting instead of context-switching down a mixed
           * list. The category is the one the submission was FILED under, not
           * the one its template carries now.
           *
           * Until 20260807_flow_join.sql is applied no submission has a
           * category at all, groupByCategory returns one section, and this
           * queue reads exactly as it reads today.
           */
          groupByCategory(waiting, (s) => s.category).map((group) => (
            <div key={group.category}>
              <p
                className="border-b border-edge bg-surface-2 px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted"
                data-no-translate
              >
                {group.category}
              </p>
              <SubmissionList items={group.rows} stamp="filed" />
            </div>
          ))
        )}
      </PanelCard>

      <PanelCard
        title={
          <>
            <T>Decision history</T>
            {' · '}
            <span data-no-translate>{decided.length}</span>
          </>
        }
        bodyClassName={decided.length === 0 ? 'p-5' : 'p-0'}
      >
        {decided.length === 0 ? (
          <p className="text-[13px] text-muted">
            <T>
              Nothing decided yet. Once a document is approved, sent back or
              declined it stays here with who decided it and when.
            </T>
          </p>
        ) : (
          <SubmissionList items={decided} stamp="decided" />
        )}
      </PanelCard>
    </div>
  );
}
