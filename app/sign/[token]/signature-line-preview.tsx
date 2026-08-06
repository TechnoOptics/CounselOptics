'use client';

import {
  signaturePreviewGeometryNote,
  type SignatureLinePlacement,
} from '@/lib/signer-view';

/**
 * Where the signer's mark lands on the document, shown while they make
 * it.
 *
 * The position, the page, and the box proportions all come from
 * resolveSignatureLinePlacement, which reads the same recorded
 * coordinates lib/signature-render.ts stamps into and clamps them the
 * same way. So this cannot claim a spot the final render will not use.
 *
 * What this is NOT is a rendering of the page itself. Rasterising a
 * PDF in the browser would mean a new dependency, and the frame above
 * shows the real thing. This is a schematic of the page with the
 * signature box on it, and it says so.
 *
 * When no coordinate was recorded for this signer, nothing is drawn in
 * any position. The renderer does have a fallback corner for that
 * case, but it is an arbitrary corner rather than a detected signature
 * line, and showing it would present a guess as a fact.
 *
 * The schematic also says when it is approximate. The page size is not
 * measured here, so the outline, the box size, and above one threshold
 * the box position are all Letter-shaped guesses on a page that is not
 * Letter. That admission is signaturePreviewGeometryNote, kept beside
 * the placement rule it qualifies.
 */
export function SignatureLinePreview({
  placement,
  markDataUrl,
  signerLabel,
}: {
  placement: SignatureLinePlacement;
  /** PNG data URL of the mark as it stands right now, or null. */
  markDataUrl: string | null;
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

  // Caption, matching what lib/signature-render.ts writes under the
  // signature so the preview and the executed copy read the same.
  const caption = `${signerLabel} - ${new Date().toISOString().slice(0, 10)}`;
  const geometryNote = signaturePreviewGeometryNote(placement);

  return (
    <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4 space-y-3">
      <div>
        <p className="eyebrow mb-1.5">Your signature line</p>
        <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          Your signature goes on page {placement.page} of the document, in the
          box below. It appears here as you make it, in the position the signed
          copy will use.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Life-size signature line. */}
        <div className="flex-1 min-w-0">
          <div
            className="w-full rounded-md bg-white dark:bg-forest-950 ring-1 ring-ink-300 dark:ring-forest-700/60 overflow-hidden"
            style={{ aspectRatio: '220 / 64' }}
          >
            {markDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={markDataUrl}
                alt="Your signature as it will appear on the document"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-end justify-start p-2">
                <span className="block w-full border-b border-ink-300 dark:border-forest-700/60" />
              </div>
            )}
          </div>
          <p
            className="mt-1 text-[10px] font-mono text-ink-500 dark:text-cream-100/55 truncate"
            data-no-translate
          >
            {caption}
          </p>
        </div>

        {/* Page schematic, so the box has somewhere to be. */}
        <div className="sm:w-[132px] shrink-0">
          <div
            className="relative w-[112px] sm:w-full rounded-sm bg-white dark:bg-forest-950 ring-1 ring-ink-200 dark:ring-forest-700/50"
            style={{ aspectRatio: String(placement.pageAspect) }}
            aria-hidden
          >
            <span
              className="absolute rounded-[2px] ring-1 ring-forest-900/70 dark:ring-gold-metal/70 bg-forest-900/10 dark:bg-gold-metal/15 overflow-hidden"
              style={{
                left: `${placement.leftPct}%`,
                top: `${placement.topPct}%`,
                width: `${placement.widthPct}%`,
                height: `${placement.heightPct}%`,
              }}
            >
              {markDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={markDataUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              ) : null}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-ink-500 dark:text-cream-100/55 leading-snug">
            Page {placement.page}, shown as a schematic rather than a rendering
            of the page.
          </p>
        </div>
      </div>

      {geometryNote && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          {geometryNote}
        </p>
      )}
    </div>
  );
}
