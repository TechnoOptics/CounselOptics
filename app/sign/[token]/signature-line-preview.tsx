'use client';

import {
  signatureRelocationNote,
  signaturePreviewGeometryNote,
  type SignatureLinePlacement,
} from '@/lib/signer-view';

/**
 * What the pad says about where the signature is going.
 *
 * This used to draw a schematic: a Letter-shaped rectangle with a box
 * on it, standing in for a page nobody had rendered. It was honest
 * about being a substitute and it was still the wrong thing, so the
 * document is rasterised above now and the mark appears on the real
 * signature line on the real page as it is drawn. What is left here is
 * the sentence that points at it, and the two admissions that go with
 * it.
 *
 * The geometry admission survives because it is still reachable: the
 * signature can be on a page the renderer has not reached yet, and
 * until it has, the placement falls back to a letter-size page.
 * signaturePreviewGeometryNote returns null once the page is measured,
 * which on the ordinary path is immediately, because reaching this
 * step moves the viewer to the signature page.
 *
 * The relocation admission is not about this preview at all. When the
 * recorded anchor is too close to an edge for the box to fit, the
 * renderer moves the box to keep the whole mark on the page, so the
 * signature lands somewhere other than the coordinate the document
 * recorded. The signer is the only person positioned to notice that
 * before the instrument is executed.
 */
export function SignatureLinePreview({
  placement,
  signerLabel,
}: {
  placement: SignatureLinePlacement;
  signerLabel: string;
}) {
  if (placement.mode === 'deferred') {
    return (
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4">
        <p className="eyebrow mb-1.5">Your signature line</p>
        <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          This document has no signature line recorded for you yet, so we are
          not going to show you a position we cannot stand behind. Your
          signature is placed on the document when the signing is complete, and
          the copy you receive shows exactly where it landed.
        </p>
      </div>
    );
  }

  // The caption lib/signature-render.ts writes under the signature, so
  // the signer knows what else is added alongside the mark itself.
  const caption = `${signerLabel} - ${new Date().toISOString().slice(0, 10)}`;
  const geometryNote = signaturePreviewGeometryNote(placement);
  const relocationNote = signatureRelocationNote(placement);

  return (
    <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4 space-y-2">
      <p className="eyebrow mb-1.5">Your signature line</p>
      <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
        Your signature goes on page {placement.page} of the document above, in
        the highlighted box. It appears there as you draw it, in the position
        the signed copy will use. Your name and the date are printed under it:{' '}
        <span className="font-mono" data-no-translate>
          {caption}
        </span>
        .
      </p>

      {placement.pageFellBackToFirst && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          The signature line was recorded on a page beyond the end of this
          document, so it lands on page one instead. That is what the signed
          copy will show. It is worth mentioning to the firm.
        </p>
      )}

      {relocationNote && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          {relocationNote}
        </p>
      )}

      {geometryNote && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          {geometryNote}
        </p>
      )}
    </div>
  );
}
