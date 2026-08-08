import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
  getDocumentArtifactSigningRequest,
  getFirmExecutedCopySignedUrl,
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
  const [originalUrl, cases, signingRequest] = await Promise.all([
    getFirmDocumentSignedUrl(doc.filePath, 60 * 60),
    listFirmCases(ctx.firm.id),
    // This page shows a document, not a request, so it has no request
    // to read an executed copy off. Once one has been signed to
    // completion, the executed copy IS what counsel means by "the
    // document", and previewing the original instead is the bug the
    // owner reported. A request still out for signature is picked up
    // too, so a document with two of three signers in does not sit
    // here saying nothing has been signed onto it.
    getDocumentArtifactSigningRequest(doc.id),
  ]);

  const choice = selectSigningArtifact({
    status: signingRequest?.status ?? null,
    signedFilePath: signingRequest?.signedFilePath ?? null,
    originalFilePath: doc.filePath,
  });
  const executedUrl =
    choice?.kind === 'executed' && signingRequest
      ? await getFirmExecutedCopySignedUrl({
          firmId: doc.firmId,
          requestId: signingRequest.id,
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
          className="text-muted hover:text-foreground"
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
                className="inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground"
              >
                {FIRM_DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status}
              </span>
            )}
          </div>
        }
      >
        <p className="text-[12px] text-muted mt-1 font-mono">
          v{doc.version} &middot; {doc.mimeType} &middot; <T>uploaded</T>{' '}
          {new Date(doc.uploadedAt).toLocaleString()}
        </p>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <span
                key={t}
                className="badge bg-surface-2 text-foreground text-[10px]"
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
              className="text-[13px] font-semibold text-foreground hover:underline truncate block"
              title={linkedCase.title}
            >
              {linkedCase.title}
            </Link>
          ) : (
            <p className="text-[13px] text-muted italic">
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
                  : 'text-foreground'
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
            <p className="text-[13px] text-muted italic">
              <T>No deadline set</T>
            </p>
          )}
        </div>
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Status moved</T></p>
          <p className="text-[13px] text-foreground font-mono tabular-nums">
            {new Date(doc.statusUpdatedAt).toLocaleString()}
          </p>
        </div>
        {doc.description && (
          <div className="sm:col-span-3 pt-3 border-t border-edge">
            <p className="eyebrow text-[10px] mb-1"><T>Description</T></p>
            <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
              {doc.description}
            </p>
          </div>
        )}
      </section>

      {artifact && (
        <>
          <DocumentArtifactCard artifact={artifact} documentName={doc.name} />
          {signingRequest && (
            <p className="text-[13px]">
              <Link
                href={`/counsel/signing/${signingRequest.id}`}
                className="text-muted hover:text-foreground underline"
              >
                {signingRequest.status === 'completed' ? (
                  <T>See who signed and when</T>
                ) : (
                  <T>See who has signed so far</T>
                )}
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
