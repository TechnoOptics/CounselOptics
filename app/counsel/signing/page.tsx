import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmSigningRequestsWithSummary,
  type FirmSigningRequestSummary,
} from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { submissionCategoriesForRequests } from '@/lib/submission-completion';
import { groupByCategory, UNFILED_CATEGORY } from '@/lib/document-category';
import {
  FIRM_SIGNING_STATUS_COLOR,
  FIRM_SIGNING_STATUS_LABEL,
} from '@/lib/firm-types';
import { PageHeader, EmptyState, SectionTitle } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signing · Counsel' };

/** One row of the list, shared by both sections so they cannot drift apart. */
function RequestRow({ req }: { req: FirmSigningRequestSummary }) {
  return (
    <li className="p-4">
      <Link
        href={`/counsel/signing/${req.id}`}
        className="flex flex-wrap items-baseline justify-between gap-2"
      >
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">
            {req.recipients.length > 0
              ? req.recipients.join(', ')
              : `Request #${req.id.slice(0, 8)}`}
          </p>
          <p className="text-[12px] text-muted mt-0.5">
            {req.completedAt ? (
              <>
                <T>Signed</T> {new Date(req.completedAt).toLocaleDateString()}
              </>
            ) : req.sentAt ? (
              <>
                <T>Sent</T> {new Date(req.sentAt).toLocaleDateString()}
              </>
            ) : (
              <>
                <T>Created</T> {new Date(req.createdAt).toLocaleDateString()}
              </>
            )}
            {req.totalSigners > 0 && (
              <>
                {' '}
                · {req.signedCount} <T>of</T> {req.totalSigners} <T>signed</T>
              </>
            )}
          </p>
        </div>
        <StatusPill size="sm" color={FIRM_SIGNING_STATUS_COLOR[req.status]}>
          {FIRM_SIGNING_STATUS_LABEL[req.status]}
        </StatusPill>
      </Link>
    </li>
  );
}

export default async function CounselSigningPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const requests = await listFirmSigningRequestsWithSummary(ctx.firm.id);

  // Signed documents, filed under what they are.
  //
  // The category comes from the submission that produced the request, which
  // is where it was copied at filing time. A category column on
  // firm_documents was the alternative and it is a bigger decision than this
  // page: an uploaded file would need a way for someone to set it.
  //
  // The submissions table is behind RLS with no policies, so this reads
  // through the service-role client, scoped to the firm getActiveFirmContext
  // has already established the caller belongs to.
  const executed = requests.filter((r) => r.status === 'completed');
  const rest = requests.filter((r) => r.status !== 'completed');
  const admin = createAdminSupabase();
  const categories = admin
    ? await submissionCategoriesForRequests(
        admin,
        ctx.firm.id,
        executed.map((r) => r.id),
      )
    : new Map<string, string>();
  const executedGroups = groupByCategory(executed, (r) => categories.get(r.id) ?? null);
  // A single Unfiled heading over the whole list says nothing, and it is what
  // a firm sees before 20260807_flow_join.sql is applied, when no request has
  // a category to read. The list is the same either way; only the headings
  // appear once there is something to head.
  const showCategoryHeadings =
    executedGroups.length > 1 || executedGroups[0]?.category !== UNFILED_CATEGORY;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Signing</T>}
        title={<T>E-signature requests</T>}
        subtitle={
          <>
            <T>Review status of every signing request you&rsquo;ve sent. Open a document from</T>{' '}
            <Link href="/counsel/documents" className="underline">
              <T>Documents</T>
            </Link>{' '}
            <T>to send a new request.</T>
          </>
        }
      />
      <section className="card p-5 sm:p-6 ring-1 ring-emerald-300/30 dark:ring-emerald-500/25 bg-emerald-50/30 dark:bg-emerald-950/15">
        <p className="text-sm text-foreground leading-relaxed">
          <strong><T>UETA-aligned signing.</T></strong>{' '}
          <T>
            Each request hashes the document at creation, captures intent
            through a two-step disclosure flow, and appends every event (sent,
            viewed, signed, completed) to a tamper-evident audit chain you can
            inspect from each request below. Jurisdictional fit for specific
            document classes (real-estate conveyances, wills, certain UCC
            instruments) stays a question for your counsel.
          </T>
        </p>
      </section>

      {executed.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>
            <T>Fully executed</T>
          </SectionTitle>
          <p className="text-[13px] text-muted max-w-[70ch]">
            <T>
              Every signer is in on these. Open one to read the executed copy,
              compare it against the original, and download either.
            </T>
          </p>
          <div className="space-y-5">
            {executedGroups.map((group) => (
              <div key={group.category} className="space-y-2">
                {showCategoryHeadings && (
                  // The firm's own words for what this is, so the translator
                  // leaves it alone.
                  <p className="eyebrow" data-no-translate>
                    {group.category}
                  </p>
                )}
                <ul className="card divide-y divide-edge">
                  {group.rows.map((req) => (
                    <RequestRow key={req.id} req={req} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {requests.length === 0 ? (
        <EmptyState
          title={<T>No signing requests yet.</T>}
          sub={<T>Open a document and use &ldquo;Send for signature&rdquo;.</T>}
        />
      ) : (
        rest.length > 0 && (
          <section className="space-y-3">
            {executed.length > 0 && (
              <SectionTitle>
                <T>Everything else</T>
              </SectionTitle>
            )}
            <ul className="card divide-y divide-edge">
              {rest.map((req) => (
                <RequestRow key={req.id} req={req} />
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
