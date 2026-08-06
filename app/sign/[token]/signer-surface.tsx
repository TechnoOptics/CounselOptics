'use client';

import { useCallback, useState } from 'react';
import {
  isDocumentPresented,
  type SignatureLinePlacement,
  type SignerDocumentRenderStatus,
} from '@/lib/signer-view';
import { SignerDocumentView } from './document-view';
import { SignatureCapture } from './signature-capture';

/**
 * The document and the ceremony, joined.
 *
 * They used to be two independent children of the server page. They
 * cannot be any more, because three things now cross between them and
 * every one of them decides something:
 *
 *   - the mark, so the rendered page can draw it into the real
 *     signature box as the signer makes it, which is the whole point
 *     of this branch;
 *   - the render status, because documentPresented is no longer "a URL
 *     was minted" but "a page of this PDF was rasterised on this
 *     device", and only the renderer knows that;
 *   - the step, because the pad opening is what sends the viewer to
 *     the page the signature line is on.
 *
 * This holds the state and nothing else. The rules stay in
 * lib/signer-view.ts and the pixels stay in the two children.
 *
 * The ceremony below is untouched: disclosure first, then the two
 * consents plus the review affirmation, then the pad with its separate
 * intent checkbox. Nothing here reorders, duplicates or skips any of
 * it, and the document failing to render closes the first step rather
 * than opening a shortcut past it.
 */
export function SignerSurface({
  token,
  documentName,
  firmName,
  signerEmail,
  signerName,
  positionPage,
  positionX,
  positionY,
  copyPermitted,
  copyHref,
}: {
  token: string;
  documentName: string;
  firmName: string;
  signerEmail: string;
  signerName: string | null;
  positionPage: number | null;
  positionX: number | null;
  positionY: number | null;
  copyPermitted: boolean;
  copyHref: string;
}) {
  const [markDataUrl, setMarkDataUrl] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] =
    useState<SignerDocumentRenderStatus>('pending');
  const [placement, setPlacement] = useState<SignatureLinePlacement>({
    mode: 'deferred',
    reason: 'no-recorded-position',
  });
  const [step, setStep] = useState<'disclosure' | 'capture' | 'done'>(
    'disclosure',
  );

  // Stable, because the viewer's fetch and render effects list these
  // in their dependencies and a new function identity on every
  // keystroke would restart the render underneath the reader.
  const handleStatus = useCallback(
    (next: SignerDocumentRenderStatus) => setRenderStatus(next),
    [],
  );
  const handlePlacement = useCallback(
    (next: SignatureLinePlacement) => setPlacement(next),
    [],
  );
  const handleMark = useCallback((next: string | null) => setMarkDataUrl(next), []);
  const handleStep = useCallback(
    (next: 'disclosure' | 'capture' | 'done') => setStep(next),
    [],
  );

  return (
    <>
      {/* The document comes FIRST. The ceremony below it is unchanged:
          disclosure, then consent, then the pad. */}
      <SignerDocumentView
        token={token}
        documentName={documentName}
        firmName={firmName}
        positionPage={positionPage}
        positionX={positionX}
        positionY={positionY}
        copyPermitted={copyPermitted}
        markDataUrl={markDataUrl}
        focusSignature={step === 'capture'}
        onStatusChange={handleStatus}
        onPlacementChange={handlePlacement}
      />

      <SignatureCapture
        token={token}
        signerEmail={signerEmail}
        signerName={signerName}
        documentName={documentName}
        firmName={firmName}
        documentPresented={isDocumentPresented(renderStatus)}
        placement={placement}
        copyPermitted={copyPermitted}
        copyHref={copyHref}
        onMarkChange={handleMark}
        onStepChange={handleStep}
      />
    </>
  );
}
