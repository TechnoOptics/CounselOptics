import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExternalLink } from '@/components/ExternalLink';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
  getFirmExecutedCopySignedUrl,
  getFirmSigningRequestWithSignatures,
} from '@/lib/firm-storage';
import {
  FIRM_SIGNING_STATUS_COLOR,
  FIRM_SIGNING_STATUS_LABEL,
} from '@/lib/firm-types';
import {
  resolveSigningArtifact,
  selectSigningArtifact,
} from '@/lib/signing-artifact';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  NO_ACTIVITY,
  automatedOpensSentence,
  firmActivitySentence,
  loadSigningActivity,
  opensSentence,
  resolveActivityVerdict,
  verdictNeedsAttention,
} from '@/lib/signing-activity';
import { RecallButton } from './recall-button';
import { ReopenButton } from './reopen-button';
import { ResendButton } from './resend-button';
import { DocumentArtifactCard } from '@/components/counsel/DocumentArtifactCard';
import { StatusPill } from '@/components/counsel/StatusPill';
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

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

/**
 * One signing request, as the detail pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3.
 *
 * The pattern's contextual banner earns its place here: a declined
 * request, a request somebody asked for changes on and a recalled
 * request are all live conditions that change what the reader should do
 * next, and none of them is legible from the status pill alone. The
 * control that acts on the condition sits in the action bar with the
 * other controls rather than inside the banner, so there is one place
 * on the page where things happen.
 *
 * The mono reference is the request's id, shortened, because a signing
 * request carries no reference number of its own.
 */
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

  // Which of the two documents this request means, and why. Until this
  // existed the page always previewed doc.filePath, so a completed
  // signing showed the original with nothing on the signature line
  // while the executed copy sat unread in storage.
  const choice = selectSigningArtifact({
    status: data.request.status,
    signedFilePath: data.request.signedFilePath,
    originalFilePath: doc?.filePath ?? null,
  });
  // The original is minted alongside the executed copy so the two can
  // be compared; resolveSigningArtifact drops it when the original is
  // itself what is on screen.
  const [executedUrl, originalUrl] = await Promise.all([
    choice?.kind === 'executed'
      ? getFirmExecutedCopySignedUrl({
          firmId: data.request.firmId,
          requestId: data.request.id,
          filePath: choice.path,
        })
      : Promise.resolve(null),
    doc ? getFirmDocumentSignedUrl(doc.filePath) : Promise.resolve(null),
  ]);
  const artifact = resolveSigningArtifact(choice, { executedUrl, originalUrl });
  // Same roles that may send a document for signature may re-send it.
  // The action re-checks this server-side; this only hides the control.
  const canResend = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  const status = data.request.status;
  const signed = data.signatures.filter((s) => s.signedAt).length;
  const total = data.signatures.length;
  const live = status !== 'completed' && status !== 'canceled';
  const stalled = status === 'rejected' || status === 'changes_requested';

  // What has actually happened to this document, for a firm that until now
  // learned nothing at all between sending it and a signature landing.
  //
  // Read through the service-role client, scoped to the request this page has
  // already established belongs to ctx.firm. firm_signature_events is RLS-
  // gated to firm members and the user-scoped client could read it, but the
  // same loader serves the employee's portal record, where the reader is a
  // member of nothing, so there is one loader and it takes an admin client.
  //
  // Null, not an empty map, when the events could not be read at all. That is
  // a different fact from "nobody opened it" and the page says so rather than
  // rendering an absence as an answer. No report is worth failing a page over
  // either, so neither case throws.
  const activityAdmin = createAdminSupabase();
  const activity = activityAdmin
    ? await loadSigningActivity(activityAdmin, data.request.id)
    : null;
  const now = new Date();
  const activityOf = (email: string | null) =>
    activity?.get((email ?? '').trim().toLowerCase()) ?? NO_ACTIVITY;
  const verdicts = new Map(
    activity
      ? data.signatures.map((sig) => [
          sig.id,
          resolveActivityVerdict({
            signedAt: sig.signedAt,
            response: sig.response ?? null,
            sentAt: data.request.sentAt,
            activity: activityOf(sig.signerEmail),
            now,
          }),
        ])
      : [],
  );
  const attention = data.signatures
    .map((sig) => ({ sig, verdict: verdicts.get(sig.id)! }))
    .filter((row) => row.verdict && verdictNeedsAttention(row.verdict));

  return (
    <div className="space-y-6 animate-fade-up">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/signing"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Signing requests</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={data.request.id}>{shortRef(data.request.id)}</MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {doc?.name ?? 'Document'}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusPill dot color={FIRM_SIGNING_STATUS_COLOR[status]}>
            {FIRM_SIGNING_STATUS_LABEL[status]}
          </StatusPill>
          {total > 0 && (
            <Chip>
              <span data-no-translate>
                {signed}/{total}
              </span>{' '}
              <T>signed</T>
            </Chip>
          )}
          <Chip>
            {data.request.signerCanDownload ? (
              <T>signers may keep a copy</T>
            ) : (
              <T>no signer copy</T>
            )}
          </Chip>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          <T>created</T> {relativeTime(data.request.createdAt)}
          {data.request.sentAt && (
            <>
              {' · '}
              <T>sent</T> {relativeTime(data.request.sentAt)}
            </>
          )}
          {data.request.completedAt && (
            <>
              {' · '}
              <T>completed</T> {relativeTime(data.request.completedAt)}
            </>
          )}
        </p>
      </header>

      {(stalled || status === 'canceled') && (
        <section className="card p-4 text-sm leading-relaxed">
          <p className="font-semibold text-warn-text">
            {status === 'canceled' ? (
              <T>This request was recalled.</T>
            ) : status === 'rejected' ? (
              <T>A signer declined to sign.</T>
            ) : (
              <T>A signer asked for changes.</T>
            )}
          </p>
          {/* WHY THIS SAYS "THE SAME DOCUMENT".
              It used to say reopening "sends the revised document". There is
              no document-replacement path anywhere in this product: a signing
              request holds one document_id, reopening does not touch it, and
              firm_documents.version is written as the literal 1 by every
              insert and incremented by nothing. So the signer who objected was
              sent the identical file with no explanation.
              Nor is the claim one to build behind: a signature is evidence
              about a particular set of bytes, which is what the audit chain
              hashes, so a request cannot swap its file and keep the signatures
              made on the old one. Revising means a fresh request, and that is
              what this says. */}
          <p className="mt-1 text-foreground">
            {status === 'canceled' ? (
              <T>Its sign links no longer work. Send a new request from Documents when the document is ready.</T>
            ) : status === 'rejected' ? (
              <T>Read their note below. Reopening makes their link work again and puts the same document in front of them; anyone who already signed stays signed. The file on a request cannot be swapped, so if the document itself has to change, send a fresh request from Documents with the revised one.</T>
            ) : (
              <T>Read their note below. Reopening makes their link work again and puts the same document in front of them; anyone who already signed stays signed. The file on a request cannot be swapped, so if the changes they asked for are changes to the document, send a fresh request from Documents with the revised one.</T>
            )}
          </p>
        </section>
      )}

      {/* Silence, said out loud.
          A request nobody has touched for a long time looks exactly like one
          sent this morning, and the difference is the whole reason this page
          reads the events at all. The two ways it goes quiet are kept apart
          because a firm acts differently on each: a link never opened is
          probably an address problem and wants a resend, while a link opened
          and then dropped reached the person and wants a conversation. */}
      {live && !stalled && attention.length > 0 && (
        <section className="card p-4 text-sm leading-relaxed">
          <p className="font-semibold text-warn-text">
            <T>This request has gone quiet.</T>
          </p>
          <ul className="mt-1 space-y-0.5">
            {attention.map(({ sig, verdict }) => (
              <li key={sig.id} className="text-foreground">
                <span data-no-translate>
                  {sig.signerName || sig.signerEmail}
                </span>
                {' · '}
                {firmActivitySentence(verdict)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Action bar: what this page can do to the request, with its
          progress on the left. Recall and reopen are mutually
          exclusive, so the bar never carries both. */}
      <ActionBar
        trailing={
          <>
            {stalled && <ReopenButton requestId={data.request.id} />}
            {live && !stalled && <RecallButton requestId={data.request.id} />}
          </>
        }
      >
        <p className="text-[12.5px] text-muted">
          {total > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">
                {signed}/{total}
              </span>{' '}
              <T>signers are in</T>
            </>
          ) : (
            <T>This request has no signers on it.</T>
          )}
        </p>
      </ActionBar>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <PanelCard title={<T>Signers</T>}>
            <p className="text-[11.5px] leading-relaxed text-muted">
              {data.request.signerCanDownload ? (
                <T>
                  Signers can download a copy of this document once they have
                  signed.
                </T>
              ) : (
                <T>
                  Signers cannot download a copy of this document. The download
                  is refused by the server, and they are told to ask you for a
                  copy.
                </T>
              )}
            </p>
            <ul className="mt-3 space-y-3">
              {data.signatures.map((sig) => (
                <li
                  key={sig.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate font-medium text-foreground"
                      data-no-translate
                    >
                      {sig.signerName || sig.signerEmail}
                    </p>
                    <p className="text-[11px] text-muted" data-no-translate>
                      {sig.signerEmail}
                    </p>
                  </div>
                  <div className="text-right">
                    {sig.signedAt ? (
                      <span className="font-mono text-[12px] tabular-nums text-emerald-700 dark:text-emerald-300">
                        <T>Signed</T> {new Date(sig.signedAt).toLocaleString()}
                      </span>
                    ) : sig.response ? (
                      <span
                        className={`text-[12px] font-medium ${
                          sig.response === 'rejected'
                            ? 'text-danger-text'
                            : 'text-warn-text'
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
                      <span className="text-[12px] text-warn-text">
                        <T>Awaiting signature</T>
                        {sig.accessCodeRequired &&
                          (sig.accessVerifiedAt ? (
                            <span className="text-muted">
                              {' '}
                              <T>· code verified</T>
                            </span>
                          ) : (
                            <span className="text-muted">
                              {' '}
                              <T>· code sent</T>
                            </span>
                          ))}
                      </span>
                    )}
                    {!sig.signedAt && !sig.response && live && !stalled && (
                      <p className="mt-0.5 flex items-start justify-end gap-3">
                        <ExternalLink
                          href={`${SITE_URL}/sign/${sig.token}`}
                          className="text-[11px] text-foreground underline"
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
                      <p
                        className="mt-1 max-w-[42ch] text-[12px] italic text-muted"
                        data-no-translate
                      >
                        &ldquo;{sig.responseNote}&rdquo;
                      </p>
                    )}
                  </div>
                  {/* What happened to the link, on its own line rather than
                      squeezed under the status, because it is a sentence and
                      the status is a word. */}
                  {(() => {
                    const verdict = verdicts.get(sig.id);
                    if (!verdict || verdict.kind === 'signed') return null;
                    const own = activityOf(sig.signerEmail);
                    const opens = opensSentence(own);
                    const machines = automatedOpensSentence(own);
                    return (
                      <div className="w-full border-t border-edge pt-2">
                        <p
                          className={`text-[12.5px] leading-relaxed ${
                            verdictNeedsAttention(verdict)
                              ? 'text-warn-text'
                              : 'text-foreground'
                          }`}
                        >
                          {firmActivitySentence(verdict)}
                        </p>
                        {opens && (
                          <p className="mt-0.5 text-[11.5px] text-muted">
                            {opens}
                            {own.lastOpenedAt && (
                              <span data-no-translate>
                                {' '}
                                Last on{' '}
                                {new Date(own.lastOpenedAt).toLocaleString()}.
                              </span>
                            )}
                          </p>
                        )}
                        {machines && (
                          <p className="mt-0.5 text-[11.5px] text-muted">
                            {machines}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </li>
              ))}
            </ul>
            {/* The one case where saying nothing would be read as an answer.
                An empty activity block looks exactly like a document nobody
                touched, so a failed read says it failed. */}
            {!activity && (
              <p className="mt-3 text-[11.5px] text-muted">
                <T>
                  The open and download history could not be read just now.
                  Reload the page to try again.
                </T>
              </p>
            )}
            {/* Said once, under the list, because it qualifies every line in
                it. An open is an HTTP request carrying that signer's token
                and nothing more: it does not establish that a person read
                the document, and this page must not let a reader believe it
                does. The events are also only as complete as the writes that
                made them, which is what the audit trail says in full. */}
            <p className="mt-4 border-t border-edge pt-3 text-[11.5px] leading-relaxed text-muted">
              <T>
                An open means the signing link was requested with this
                signer&rsquo;s token. It does not establish that anyone read the
                document. Opens that identify themselves as a link scanner or a
                mail client fetching the link are counted separately and are
                never reported as the signer.
              </T>{' '}
              <ExternalLink
                href={`/api/firm/sign/audit-trail/${data.request.id}`}
                className="underline"
              >
                <T>Full event record</T>
              </ExternalLink>
              <T>
                , with addresses, devices and the tamper-evident chain, is open
                to firm members.
              </T>
            </p>
          </PanelCard>

          {artifact && (
            <DocumentArtifactCard
              artifact={artifact}
              documentName={doc?.name ?? 'Document'}
              frameClassName="w-full h-[60vh] border-0 bg-surface-2"
            />
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <PanelCard
            title={<T>Document</T>}
            action={
              doc ? (
                <Link
                  href={`/counsel/documents/${doc.id}`}
                  className="text-[12px] font-medium text-accent-text hover:underline"
                >
                  <T>Open document</T> &rarr;
                </Link>
              ) : undefined
            }
          >
            {doc ? (
              <>
                <p
                  className="text-[13px] font-semibold text-foreground"
                  data-no-translate
                >
                  {doc.name}
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-muted" data-no-translate>
                  v{doc.version} &middot; {doc.mimeType}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted">
                <T>The document behind this request is no longer in the vault.</T>
              </p>
            )}
          </PanelCard>

          {data.request.message && (
            <PanelCard title={<T>Message to signers</T>}>
              <p
                className="text-[13px] italic leading-relaxed text-foreground"
                data-no-translate
              >
                &ldquo;{data.request.message}&rdquo;
              </p>
            </PanelCard>
          )}
        </aside>
      </div>
    </div>
  );
}
