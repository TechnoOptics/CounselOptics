import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
  getFirmExecutedCopySignedUrl,
  getLatestCompletedSigningRequestForDocument,
  listFirmCases,
} from '@/lib/firm-storage';
import {
  FIRM_DOCUMENT_STATUS_LABEL,
  FIRM_DOCUMENT_STATUS_TONE,
  FIRM_TONE_COLOR,
} from '@/lib/firm-types';
import {
  resolveSigningArtifact,
  selectSigningArtifact,
} from '@/lib/signing-artifact';
import { CreateSigningRequestForm } from './signing-form';
import { DocumentStatusChanger } from './status-changer';
import { DocumentArtifactCard } from '@/components/counsel/DocumentArtifactCard';
import { PageHeader } from '@/components/counsel/ui';
import { pillSurface } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export default async function FirmDocumentDetail({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const doc = await getFirmDocument(params.id);
  if (!doc || doc.firmId !== ctx.firm.id) notFound();
  const [originalUrl, cases, completedRequest] = await Promise.all([
    getFirmDocumentSignedUrl(doc.filePath, 60 * 60),
    listFirmCases(ctx.firm.id),
    // This page shows a document, not a request, so it has no request
    // to read an executed copy off. Once one has been signed to
    // completion, the executed copy IS what counsel means by "the
    // document", and previewing the original instead is the bug the
    // owner reported.
    getLatestCompletedSigningRequestForDocument(doc.id),
  ]);

  const choice = selectSigningArtifact({
    status: completedRequest?.status ?? null,
    signedFilePath: completedRequest?.signedFilePath ?? null,
    originalFilePath: doc.filePath,
  });
  const executedUrl =
    choice?.kind === 'executed' && completedRequest
      ? await getFirmExecutedCopySignedUrl({
          firmId: doc.firmId,
          requestId: completedRequest.id,
          filePath: choice.path,
          expiresInSeconds: 60 * 60,
        })
      : null;
  const artifact = resolveSigningArtifact(choice, { executedUrl, originalUrl });

  const canRequestSig = ['owner', 'admin', 'attorney'].includes(
    ctx.membership.role,
  );
  const canEdit = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  const linkedCase = doc.caseId
    ? cases.find((c) => c.id === doc.caseId) ?? null
    : null;

  const isOverdue =
    doc.dueAt &&
    new Date(doc.dueAt).getTime() < Date.now() &&
    !doc.status.startsWith('signed_') &&
    doc.status !== 'canceled';

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/documents"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Documents</T>
        </Link>
      </p>
      <PageHeader
        align="start"
        eyebrow={<T>Document</T>}
        title={doc.name}
        action={
          <div className="shrink-0">
            {canEdit ? (
              <DocumentStatusChanger
                firmId={ctx.firm.id}
                documentId={doc.id}
                currentStatus={doc.status}
                statusUpdatedAt={doc.statusUpdatedAt}
              />
            ) : (
              // Same surface as the status changer this stands in for,
              // so a member who cannot edit sees the state the editors
              // see rather than a different-looking chip.
              <span
                style={pillSurface(
                  FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[doc.status]],
                )}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-semibold uppercase tracking-[0.12em] text-forest-900 dark:text-cream-100"
              >
                {FIRM_DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status}
              </span>
            )}
          </div>
        }
      >
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
          v{doc.version} &middot; {doc.mimeType} &middot; <T>uploaded</T>{' '}
          {new Date(doc.uploadedAt).toLocaleString()}
        </p>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <span
                key={t}
                className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10px]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </PageHeader>

      {/* Context strip: case linkage, due date, description */}
      <section className="card p-4 sm:p-5 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Case</T></p>
          {linkedCase ? (
            <Link
              href={`/counsel/cases/${linkedCase.id}`}
              className="text-[13px] font-semibold text-forest-900 dark:text-cream-100 hover:underline truncate block"
              title={linkedCase.title}
            >
              {linkedCase.title}
            </Link>
          ) : (
            <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
              <T>Not attached to a case</T>
            </p>
          )}
        </div>
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Due date</T></p>
          {doc.dueAt ? (
            <p
              className={`text-[13px] font-semibold ${
                isOverdue
                  ? 'text-rose-600 dark:text-rose-300'
                  : 'text-forest-900 dark:text-cream-100'
              }`}
            >
              {new Date(doc.dueAt).toLocaleString()}
              {isOverdue && (
                <span className="ml-2 text-[10.5px] font-mono uppercase tracking-wider">
                  <T>overdue</T>
                </span>
              )}
            </p>
          ) : (
            <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
              <T>No deadline set</T>
            </p>
          )}
        </div>
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Status moved</T></p>
          <p className="text-[13px] text-forest-900 dark:text-cream-100 font-mono tabular-nums">
            {new Date(doc.statusUpdatedAt).toLocaleString()}
          </p>
        </div>
        {doc.description && (
          <div className="sm:col-span-3 pt-3 border-t border-ink-100 dark:border-forest-800/40">
            <p className="eyebrow text-[10px] mb-1"><T>Description</T></p>
            <p className="text-[13px] text-ink-700 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed">
              {doc.description}
            </p>
          </div>
        )}
      </section>

      {artifact && (
        <>
          <DocumentArtifactCard artifact={artifact} documentName={doc.name} />
          {completedRequest && (
            <p className="text-[13px]">
              <Link
                href={`/counsel/signing/${completedRequest.id}`}
                className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100 underline"
              >
                <T>See who signed and when</T>
              </Link>
            </p>
          )}
        </>
      )}

      {canRequestSig && (
        <CreateSigningRequestForm firmId={ctx.firm.id} documentId={doc.id} />
      )}
    </div>
  );
}
