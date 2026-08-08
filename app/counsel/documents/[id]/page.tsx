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
import { StatusPill, pillSurface } from '@/components/counsel/StatusPill';
import {
  ActionBar,
  Chip,
  MonoRef,
  PanelCard,
  relativeTime,
  shortRef,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One document, as the detail pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3: breadcrumb with a mono
 * reference, a meta chip row, the action bar as its own bordered card,
 * then the work in the main column with the document's related records
 * in the aside.
 *
 * The mono reference is the document's id, shortened, because a firm
 * document carries no reference number of its own; see shortRef. The
 * pattern's contextual banner is absent because the one live condition
 * this page has, a document past its due date, already reads in the
 * action bar in danger text, and a banner saying the same thing twice
 * is how a banner stops being read.
 */
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

  const statusColor = FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[doc.status]];
  const isOverdue = Boolean(
    doc.dueAt &&
      new Date(doc.dueAt).getTime() < Date.now() &&
      !doc.status.startsWith('signed_') &&
      doc.status !== 'canceled',
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/documents"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Documents</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={doc.id}>{shortRef(doc.id)}</MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {doc.name}
        </h1>
        {/* Meta chip row: the one live state as a pill, the fixed facts
            of the file as quiet chips, then plain provenance. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusPill dot color={statusColor}>
            {FIRM_DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status}
          </StatusPill>
          <Chip>
            <span data-no-translate>v{doc.version}</span>
          </Chip>
          <Chip>
            <span data-no-translate>
              {doc.mimeType.split('/').pop() ?? doc.mimeType}
            </span>
          </Chip>
          <Chip>
            <span data-no-translate>{formatBytes(doc.fileSize)}</span>
          </Chip>
          {doc.tags.map((tag) => (
            <Chip key={tag}>
              <span data-no-translate>{tag}</span>
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          <T>uploaded</T> {relativeTime(doc.uploadedAt)}
          {' · '}
          <T>status moved</T> {relativeTime(doc.statusUpdatedAt)}
        </p>
      </header>

      {/* Action bar: the one thing this page changes in place is the
          document's status, with its due state on the right. */}
      <ActionBar
        trailing={
          doc.dueAt ? (
            <p
              className={`text-[12.5px] ${
                isOverdue ? 'font-semibold text-danger-text' : 'text-muted'
              }`}
            >
              {isOverdue ? <T>Overdue since</T> : <T>Due</T>}{' '}
              {new Date(doc.dueAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          ) : undefined
        }
      >
        {canEdit ? (
          <DocumentStatusChanger
            firmId={ctx.firm.id}
            documentId={doc.id}
            currentStatus={doc.status}
            statusUpdatedAt={doc.statusUpdatedAt}
          />
        ) : (
          // Same surface as the status changer this stands in for, so a
          // member who cannot edit sees the state the editors see
          // rather than a different-looking chip.
          <span
            style={pillSurface(statusColor)}
            className="inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground"
          >
            {FIRM_DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status}
          </span>
        )}
      </ActionBar>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {artifact && (
            <>
              <DocumentArtifactCard artifact={artifact} documentName={doc.name} />
              {signingRequest && (
                <p className="text-[13px]">
                  <Link
                    href={`/counsel/signing/${signingRequest.id}`}
                    className="text-muted underline hover:text-foreground"
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

        <aside className="min-w-0 space-y-4">
          <PanelCard
            title={<T>Matter</T>}
            action={
              linkedCase ? (
                <Link
                  href={`/counsel/cases/${linkedCase.id}`}
                  className="text-[12px] font-medium text-accent-text hover:underline"
                >
                  <T>Open matter</T> &rarr;
                </Link>
              ) : undefined
            }
          >
            {linkedCase ? (
              <p
                className="text-[13px] font-semibold text-foreground"
                data-no-translate
              >
                {linkedCase.title}
              </p>
            ) : (
              <p className="text-[13px] text-muted">
                <T>Not attached to a matter.</T>
              </p>
            )}
          </PanelCard>

          {doc.description && (
            <PanelCard title={<T>Description</T>}>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground"
                data-no-translate
              >
                {doc.description}
              </p>
            </PanelCard>
          )}

          <PanelCard title={<T>File</T>}>
            <dl className="space-y-2 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">
                  <T>Uploaded</T>
                </dt>
                <dd className="font-mono tabular-nums text-foreground">
                  {new Date(doc.uploadedAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">
                  <T>Status moved</T>
                </dt>
                <dd className="font-mono tabular-nums text-foreground">
                  {new Date(doc.statusUpdatedAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">
                  <T>Type</T>
                </dt>
                <dd className="font-mono text-foreground" data-no-translate>
                  {doc.mimeType}
                </dd>
              </div>
            </dl>
          </PanelCard>
        </aside>
      </div>
    </div>
  );
}
