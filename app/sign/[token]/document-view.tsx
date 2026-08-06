'use client';

import { useState } from 'react';
import {
  SIGNER_DOCUMENT_URL_TTL_MINUTES,
  createSignerFrameSrcRetainer,
  type SignerFrameSrcRetainer,
} from '@/lib/signer-view';
import { ExternalLink } from '@/components/ExternalLink';

/**
 * The document, above the signing area.
 *
 * The page is force-dynamic and mints a fresh storage signature on
 * every render, so a re-render would hand this frame a different URL,
 * the browser would treat the write as a navigation, and the viewer
 * would reload to page one and take focus. On a page whose whole
 * purpose is reading before signing, that is not a cosmetic problem.
 * So the first usable URL is held for the life of the mount. The
 * retention itself is createSignerFrameSrcRetainer, unit-tested in the
 * node environment; this component is the React around it.
 *
 * The frame is deliberately the only place the storage URL goes,
 * except for the explicit "open in a new tab" control below it. That
 * control is not decoration: several mobile browsers render only the
 * first page of a PDF inside an iframe and give it no scroll, so
 * without it a phone signer could not reach the end of the document.
 * It goes through ExternalLink rather than a raw target="_blank"
 * anchor, because inside the Capacitor shell a plain _blank anchor
 * commonly no-ops, and the mobile case is the one this control exists
 * for in the first place.
 */
export function SignerDocumentView({
  src,
  documentName,
  firmName,
}: {
  src: string | null;
  documentName: string;
  firmName: string;
}) {
  // One retainer per mount, created lazily so it survives re-renders
  // and is never shared with another frame.
  const [retain] = useState<SignerFrameSrcRetainer>(() =>
    createSignerFrameSrcRetainer(),
  );
  const frameSrc = retain(src);

  if (!frameSrc) {
    return (
      <section className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">The document</p>
        <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          This document could not be opened here.
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          You should not be asked to sign something you cannot read. Please ask{' '}
          <span data-no-translate>{firmName}</span> to send you the document
          before you continue.
        </p>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-3">
        <p className="eyebrow mb-2">The document</p>
        <h2
          className="font-display text-lg sm:text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words"
          data-no-translate
        >
          {documentName}
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          Read the whole document before you sign. Scroll inside the frame, or
          open it in a new tab if that reads better on your device.
        </p>
      </div>
      <iframe
        src={frameSrc}
        title={documentName}
        referrerPolicy="no-referrer"
        className="w-full h-[60vh] min-h-[380px] sm:h-[75vh] border-0 border-t border-ink-200 dark:border-forest-700/40 bg-ink-50 dark:bg-forest-950"
      />
      <div className="px-5 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-ink-200 dark:border-forest-700/40">
        {/* The link the frame is reading expires, so say so and say
            what to do about it, rather than leaving a long read on a
            phone to end at a storage error page with no way back. */}
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          This view of the document stays open for about{' '}
          {SIGNER_DOCUMENT_URL_TTL_MINUTES} minutes. If it stops loading,
          reload this page for a fresh one. Reloading starts the steps below
          again, so it is worth finishing them once you have read the
          document.
        </p>
        <ExternalLink href={frameSrc} className="btn-secondary text-sm shrink-0">
          Open in a new tab
        </ExternalLink>
      </div>
    </section>
  );
}
