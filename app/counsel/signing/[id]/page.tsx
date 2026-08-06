import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExternalLink } from '@/components/ExternalLink';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
  getFirmSigningRequestWithSignatures,
} from '@/lib/firm-storage';
import {
  FIRM_SIGNING_STATUS_COLOR,
  FIRM_SIGNING_STATUS_LABEL,
} from '@/lib/firm-types';
import { RecallButton } from './recall-button';
import { ReopenButton } from './reopen-button';
import { ResendButton } from './resend-button';
import { DocumentFrame } from '@/components/counsel/DocumentFrame';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

export default async function SigningRequestDetail({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const data = await getFirmSigningRequestWithSignatures(params.id);
  if (!data || data.request.firmId !== ctx.firm.id) notFound();
  const doc = await getFirmDocument(data.request.documentId);
  const signedUrl = doc ? await getFirmDocumentSignedUrl(doc.filePath) : null;
  // Same roles that may send a document for signature may re-send it.
  // The action re-checks this server-side; this only hides the control.
  const canResend = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link href="/counsel/signing" className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100">
          <T>&larr; Signing requests</T>
        </Link>
      </p>
      <PageHeader
        size="sm"
        eyebrow={<T>Signing request</T>}
        title={doc?.name ?? <T>Document</T>}
        action={
          <div className="flex flex-col items-end gap-2">
            <StatusPill
              size="sm"
              color={FIRM_SIGNING_STATUS_COLOR[data.request.status]}
            >
              {FIRM_SIGNING_STATUS_LABEL[data.request.status]}
            </StatusPill>
            {data.request.status !== 'completed' &&
              data.request.status !== 'canceled' && (
                <RecallButton requestId={data.request.id} />
              )}
          </div>
        }
      >
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
          <T>Request</T> #{data.request.id.slice(0, 8)} &middot; <T>Sent</T>{' '}
          {data.request.sentAt
            ? new Date(data.request.sentAt).toLocaleString()
            : <T>not yet</T>}
        </p>
      </PageHeader>

      {(data.request.status === 'rejected' ||
        data.request.status === 'changes_requested' ||
        data.request.status === 'canceled') && (
        <div
          className={`card p-4 text-sm ${
            data.request.status === 'canceled'
              ? 'ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/80'
              : 'ring-1 ring-amber-300/50 dark:ring-amber-600/30 bg-amber-50/50 dark:bg-amber-950/15 text-amber-900 dark:text-amber-200'
          }`}
        >
          <p>
            {data.request.status === 'canceled' ? (
              <T>You recalled this request. Its sign links no longer work. Send a new request from Documents when the document is ready.</T>
            ) : data.request.status === 'rejected' ? (
              <T>A signer declined to sign. Review their note below. Reopen to send the revised document without losing signatures already collected, or send a fresh request.</T>
            ) : (
              <T>A signer requested changes. Review their note below. Reopen to put the document back out for signature (anyone who already signed stays signed), or send a fresh request.</T>
            )}
          </p>
          {(data.request.status === 'rejected' ||
            data.request.status === 'changes_requested') && (
            <div className="mt-3">
              <ReopenButton requestId={data.request.id} />
            </div>
          )}
        </div>
      )}

      {data.request.message && (
        <p className="card p-4 text-sm text-ink-700 dark:text-cream-100/80 italic leading-relaxed">
          &ldquo;{data.request.message}&rdquo;
        </p>
      )}

      <section className="card p-5 sm:p-6 space-y-3">
        <p className="eyebrow"><T>Signers</T></p>
        <ul className="space-y-2">
          {data.signatures.map((sig) => (
            <li
              key={sig.id}
              className="flex flex-wrap items-baseline justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-900 dark:text-cream-100 truncate">
                  {sig.signerName || sig.signerEmail}
                </p>
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                  {sig.signerEmail}
                </p>
              </div>
              <div className="text-right">
                {sig.signedAt ? (
                  <span className="text-[12px] font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                    <T>Signed</T> {new Date(sig.signedAt).toLocaleString()}
                  </span>
                ) : sig.response ? (
                  <span
                    className={`text-[12px] font-medium ${
                      sig.response === 'rejected'
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {sig.response === 'rejected' ? (
                      <T>Declined</T>
                    ) : (
                      <T>Requested changes</T>
                    )}
                    {sig.respondedAt
                      ? ` · ${new Date(sig.respondedAt).toLocaleDateString()}`
                      : ''}
                  </span>
                ) : (
                  <span className="text-[12px] text-amber-700 dark:text-amber-300">
                    <T>Awaiting signature</T>
                    {sig.accessCodeRequired &&
                      (sig.accessVerifiedAt ? (
                        <span className="text-ink-500 dark:text-cream-100/45">
                          {' '}
                          <T>· code verified</T>
                        </span>
                      ) : (
                        <span className="text-ink-500 dark:text-cream-100/45">
                          {' '}
                          <T>· code sent</T>
                        </span>
                      ))}
                  </span>
                )}
                {!sig.signedAt &&
                  !sig.response &&
                  data.request.status !== 'canceled' &&
                  data.request.status !== 'rejected' &&
                  data.request.status !== 'changes_requested' && (
                    <p className="mt-0.5 flex items-start justify-end gap-3">
                      <ExternalLink
                        href={`${SITE_URL}/sign/${sig.token}`}
                        className="text-[11px] underline text-forest-900 dark:text-cream-100"
                      >
                        <T>Open sign link</T>
                      </ExternalLink>
                      {canResend && (
                        <ResendButton
                          firmId={data.request.firmId}
                          signatureId={sig.id}
                          rotatesCode={sig.accessCodeRequired}
                          alreadyUnlocked={!!sig.accessVerifiedAt}
                        />
                      )}
                    </p>
                  )}
                {sig.responseNote && (
                  <p className="mt-1 text-[12px] text-ink-600 dark:text-cream-100/70 italic max-w-[42ch]">
                    &ldquo;{sig.responseNote}&rdquo;
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {signedUrl && (
        <section className="card overflow-hidden">
          <p className="eyebrow px-5 pt-4 pb-2"><T>Document preview</T></p>
          <DocumentFrame
            src={signedUrl}
            title={doc?.name ?? 'Document'}
            className="w-full h-[60vh] border-0 bg-ink-50 dark:bg-forest-950"
          />
        </section>
      )}
    </div>
  );
}
