import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmSigningRequestsWithSummary,
} from '@/lib/firm-storage';
import {
  FIRM_SIGNING_STATUS_COLOR,
  FIRM_SIGNING_STATUS_LABEL,
} from '@/lib/firm-types';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signing · Counsel' };

export default async function CounselSigningPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const requests = await listFirmSigningRequestsWithSummary(ctx.firm.id);

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
        <p className="text-sm text-ink-700 dark:text-cream-100/85 leading-relaxed">
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

      {requests.length === 0 ? (
        <EmptyState
          title={<T>No signing requests yet.</T>}
          sub={<T>Open a document and use &ldquo;Send for signature&rdquo;.</T>}
        />
      ) : (
        <ul className="card divide-y divide-ink-100 dark:divide-forest-700/40">
          {requests.map((req) => (
            <li key={req.id} className="p-4">
              <Link
                href={`/counsel/signing/${req.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                    {req.recipients.length > 0
                      ? req.recipients.join(', ')
                      : `Request #${req.id.slice(0, 8)}`}
                  </p>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    {req.sentAt ? (
                      <>
                        <T>Sent</T>{' '}
                        {new Date(req.sentAt).toLocaleDateString()}
                      </>
                    ) : (
                      <>
                        <T>Created</T>{' '}
                        {new Date(req.createdAt).toLocaleDateString()}
                      </>
                    )}
                    {req.totalSigners > 0 && (
                      <>
                        {' '}
                        · {req.signedCount} <T>of</T> {req.totalSigners}{' '}
                        <T>signed</T>
                      </>
                    )}
                  </p>
                </div>
                <StatusPill size="sm" color={FIRM_SIGNING_STATUS_COLOR[req.status]}>
                  {FIRM_SIGNING_STATUS_LABEL[req.status]}
                </StatusPill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
