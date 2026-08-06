import { DocumentFrame } from './DocumentFrame';
import { ExternalLink } from '@/components/ExternalLink';
import { T } from '@/components/i18n/LocaleProvider';
import type { ResolvedSigningArtifact } from '@/lib/signing-artifact';

/**
 * The document preview on a counsel surface, together with a plain
 * statement of WHICH document it is.
 *
 * A signing request has two artifacts and they are not versions of one
 * another. The original is the bytes the firm uploaded and the bytes
 * the request's SHA-256 chain is grounded in. The executed copy is the
 * PDF produced once the last signer is in, with each signature and its
 * date on the signature line. Counsel comparing the two, or asked in a
 * dispute which one they were looking at, must not have to guess, so
 * the artifact is named on the card rather than swapped underneath
 * them.
 *
 * The frame is a DocumentFrame, which pins its signed URL for the life
 * of the mount. Both pages here are force-dynamic and mint a fresh
 * signed URL on every render, and writing a new one into the iframe
 * navigates it: the PDF viewer reloads to page 1 and takes focus. Pass
 * a plain iframe instead and that bug is back.
 *
 * Which is why the frame is keyed on the artifact. The retainer is
 * created once per MOUNT, and a router.refresh() re-renders the server
 * component in place: same element type, same position, so no remount
 * and the retainer keeps the first URL. If the request completed in
 * between, the header and the notice flip to the executed copy while
 * the frame still holds the original, and the Download button, which
 * is not retained, disagrees with the frame about which document this
 * is. That is the substitution this whole feature refuses, reappearing
 * inside a live window. A change of artifact is the one case where
 * re-navigating the iframe is correct, and the key is what makes it
 * happen; the retainer itself must stay as strict as it is.
 */
export function DocumentArtifactCard({
  artifact,
  documentName,
  frameClassName = 'w-full h-[70vh] border-0 bg-ink-50 dark:bg-forest-950',
}: {
  artifact: ResolvedSigningArtifact;
  /** Used only as the iframe's accessible title, never rendered as text. */
  documentName: string;
  frameClassName?: string;
}) {
  const executed = artifact.kind === 'executed';
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3 space-y-1.5">
        <p className="eyebrow">
          {executed ? <T>Executed copy</T> : <T>Original as uploaded</T>}
        </p>
        <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed max-w-[70ch]">
          {artifact.notice === 'executed' ? (
            <T>
              Every signer has signed. This is the executed copy, with each
              signature and its date on the signature line. The original you
              uploaded is unchanged, and you can open it below to compare.
            </T>
          ) : artifact.notice === 'executed_missing' ? (
            <T>
              Every signer has signed, but no executed copy was produced for
              this request. What follows is the original you uploaded, without
              the signatures on it. The signatures themselves are recorded on
              this page and in the audit trail.
            </T>
          ) : artifact.notice === 'executed_unreadable' ? (
            <T>
              An executed copy exists for this request but could not be opened
              just now. What follows is the original you uploaded, without the
              signatures on it. Reloading the page usually resolves this.
            </T>
          ) : artifact.notice === 'original_partial' ? (
            <T>
              Some signers have not signed yet. This is the original you
              uploaded. An executed copy, with the signatures on the signature
              line, is produced once the last signature is in.
            </T>
          ) : (
            <T>
              This is the original you uploaded. Nothing has been signed onto
              it.
            </T>
          )}
        </p>
      </div>

      {artifact.url ? (
        <>
          <DocumentFrame
            key={artifact.kind}
            src={artifact.url}
            title={documentName}
            className={frameClassName}
          />
          <div className="p-3 flex flex-wrap items-center justify-end gap-2">
            {artifact.originalUrl && (
              <ExternalLink
                href={artifact.originalUrl}
                className="btn-secondary text-sm"
                download={documentName}
              >
                <T>Download original</T>
              </ExternalLink>
            )}
            <ExternalLink
              href={artifact.url}
              className="btn-secondary text-sm"
              download={documentName}
            >
              {executed ? <T>Download executed copy</T> : <T>Download original</T>}
            </ExternalLink>
          </div>
        </>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-ink-500 dark:text-cream-100/55">
          <T>
            Neither the executed copy nor the original could be opened. Reload
            the page, and if it persists the file may have been removed from
            storage.
          </T>
        </p>
      )}
    </section>
  );
}
