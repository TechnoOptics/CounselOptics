'use client';

import { useCallback, useState } from 'react';
import {
  isDocumentPresented,
  type SignatureLinePlacement,
  type SignerDocumentRenderStatus,
} from '@/lib/signer-view';
import type { TemplateField } from '@/lib/firm-templates';
import {
  counterpartyFieldsSettled,
  type CounterpartyValues,
} from '@/lib/counterparty-fields';
import type { FieldBox } from '@/lib/template-field-boxes';
import { SignerDocumentView } from './document-view';
import { SignatureCapture } from './signature-capture';
import type { SignatureMethod } from '@/lib/signature-methods';
import { CounterpartyFields, CounterpartyFieldsSummary } from './counterparty-fields';

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
  signatureMethods,
  viewerOnPhone,
  copyHref,
  counterpartyFields,
  fieldBoxes,
  initialFieldValues,
  canFillFields,
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
  /** Which methods the firm allows on this request. Null means all four. */
  signatureMethods: SignatureMethod[] | null;
  /**
   * Whether the signer is already holding a phone, established by the server
   * from the request's user agent and passed straight through to the ceremony.
   *
   * Carried rather than resolved. This component runs in the browser, where
   * every way of answering the question is either a viewport test (which cannot
   * tell a phone from a narrow window) or a client effect (which the first paint
   * beats: see the header of the prop's source in app/sign/[token]/page.tsx and
   * the App Store rejection recorded there).
   *
   * Not optional and not defaulted. A caller that forgets it should be a type
   * error rather than a page that quietly puts the QR back in front of somebody
   * holding a phone.
   */
  viewerOnPhone: boolean;
  copyHref: string;
  /** The parts of the document this signer supplies. Empty for every
   *  document with no counterparty fields, which is every document this
   *  product has produced so far, and for every firm whose database has not
   *  had 20260807_flow_join.sql applied. */
  counterpartyFields: TemplateField[];
  /** Where those blanks are, recorded by the renderer when it drew them. */
  fieldBoxes: FieldBox[];
  /** What this signer typed already, if they are coming back to the link.
   *  For a signer who fills nothing in, what the OTHER side supplied. */
  initialFieldValues: CounterpartyValues;
  /**
   * Whether these blanks are this signer's to fill. False for the employee
   * who counter-signs: they are shown the blanks and the other side's words
   * in the document above, read only, and no form.
   */
  canFillFields: boolean;
}) {
  const [markDataUrl, setMarkDataUrl] = useState<string | null>(null);
  // Held here rather than in the form, because two children need them: the
  // form that collects them and the rendered page that draws them.
  const [fieldValues, setFieldValues] =
    useState<CounterpartyValues>(initialFieldValues);
  // A signer returning to a half-filled link starts at the form; one whose
  // values are already recorded starts past it and can go back. The rule is
  // counterpartyFieldsSettled and it is NOT written out here: it decides
  // whether the pad exists at all, and an expression inside a client
  // component is one no test in this repo can reach.
  const [fieldsDone, setFieldsDone] = useState(() =>
    counterpartyFieldsSettled({
      canFill: canFillFields,
      fields: counterpartyFields,
      values: initialFieldValues,
    }),
  );
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
        counterpartyFields={counterpartyFields}
        fieldBoxes={fieldBoxes}
        fieldValues={fieldValues}
      />

      {/* The details come before the ceremony, and the ceremony does not
          exist until they are in. The disclosure asks the signer to affirm
          they have reviewed the document, and a document still missing their
          own entity name is not the document they are being asked to be
          bound by. Hiding the pad rather than disabling a button is the
          version of that which cannot be clicked past. */}
      {canFillFields && counterpartyFields.length > 0 && !fieldsDone && (
        <CounterpartyFields
          token={token}
          fields={counterpartyFields}
          initialValues={fieldValues}
          onSubmitted={(next) => {
            setFieldValues(next);
            setFieldsDone(true);
          }}
        />
      )}

      {counterpartyFields.length > 0 && fieldsDone && (
        <CounterpartyFieldsSummary
          fields={counterpartyFields}
          values={fieldValues}
          onEdit={() => setFieldsDone(false)}
          // Locked for a signer who did not supply them, whatever step they
          // are at: the edit button is the one route back into the form, and
          // a later signer must not reach it.
          locked={!canFillFields || step !== 'disclosure'}
          ownedByReader={canFillFields}
        />
      )}

      {fieldsDone && (
        <SignatureCapture
          token={token}
          signerEmail={signerEmail}
          signerName={signerName}
          documentName={documentName}
          firmName={firmName}
          documentPresented={isDocumentPresented(renderStatus)}
          placement={placement}
          signatureMethods={signatureMethods}
          viewerOnPhone={viewerOnPhone}
          copyPermitted={copyPermitted}
          copyHref={copyHref}
          onMarkChange={handleMark}
          onStepChange={handleStep}
        />
      )}
    </>
  );
}
