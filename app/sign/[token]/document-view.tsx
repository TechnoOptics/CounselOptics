'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS,
  SIGNER_DOCUMENT_RENDER_COPY,
  clampSignerPageNumber,
  resolveDocumentResponseFailure,
  resolveDocumentSizeAcceptance,
  resolveSignatureLinePlacement,
  rotateSignatureRectForDisplay,
  type SignatureLinePlacement,
  type SignerDocumentRenderStatus,
} from '@/lib/signer-view';
import { ExternalLink } from '@/components/ExternalLink';
import type { TemplateField } from '@/lib/firm-templates';
import {
  formatCounterpartyValue,
  type CounterpartyValues,
} from '@/lib/counterparty-fields';
import {
  boxesForKey,
  fieldRectToDisplayFractions,
  resolveFieldBoxRect,
  type FieldBox,
} from '@/lib/template-field-boxes';
import { openSignerPdf, renderPageToCanvas, type RenderedPage } from './pdf-runtime';

/**
 * The document, drawn on this page, with the signature where it will
 * actually land.
 *
 * This replaced an iframe pointed at a signed storage URL. The frame
 * was honest about showing the document and could not do the one thing
 * the owner asked for: put the signer's mark on the real signature
 * line, on the real page, as they draw it. Absolutely positioning a
 * mark over the frame was considered and rejected, because the frame
 * is cross-origin and its internal scroll and zoom are invisible to
 * us, so the mark would have been correct until the first scroll or
 * pinch. Rasterising the page ourselves is the only version where the
 * mark and the page cannot come apart.
 *
 * Rendering also removed an assumption. The old preview computed the
 * signature box against a hard-coded US Letter page, which made it
 * wrong on A4 and legal and, above one threshold, wrong by up to a
 * third of the page width. The page is measured now, so
 * resolveSignatureLinePlacement is given real dimensions and
 * pageGeometry is a measurement rather than a disclosure.
 *
 * A failed render blocks. Every failure below sets a status that is
 * not 'ready', the parent turns that into documentPresented = false,
 * and the disclosure step will not open. That is deliberate and it is
 * the whole point of the branch: nobody signs a record they have not
 * seen, and a blank canvas is the most convincing way to appear to
 * have shown someone a document without having shown them anything.
 */
export function SignerDocumentView({
  token,
  documentName,
  firmName,
  positionPage,
  positionX,
  positionY,
  copyPermitted,
  markDataUrl,
  focusSignature,
  onStatusChange,
  onPlacementChange,
  counterpartyFields,
  fieldBoxes,
  fieldValues,
}: {
  token: string;
  documentName: string;
  firmName: string;
  positionPage: number | null;
  positionX: number | null;
  positionY: number | null;
  /** The firm's per-request decision about the signer keeping a copy.
   *  When it is false the byte route refuses a browser pointed at the
   *  document, so offering to open it in a tab would walk the signer
   *  into a refusal. The gate is the route; this only stops the page
   *  offering a door that is shut. */
  copyPermitted: boolean;
  /** PNG data URL of the mark as it stands right now, or null. */
  markDataUrl: string | null;
  /** True once the signer is at the pad, which is when the viewer
   *  jumps to their signature line and stays in view above it. */
  focusSignature: boolean;
  onStatusChange: (status: SignerDocumentRenderStatus) => void;
  onPlacementChange: (placement: SignatureLinePlacement) => void;
  /** The parts of the document this signer supplies, and where the renderer
   *  drew the blanks for them. Both empty for every document that asks the
   *  signer for nothing, which is every document produced before this
   *  shipped. */
  counterpartyFields: TemplateField[];
  fieldBoxes: FieldBox[];
  /** What the server accepted from this signer so far. */
  fieldValues: CounterpartyValues;
}) {
  const [status, setStatus] = useState<SignerDocumentRenderStatus>('pending');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [rendered, setRendered] = useState<
    (RenderedPage & { pageNumber: number }) | null
  >(null);
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<Awaited<ReturnType<typeof openSignerPdf>>['doc'] | null>(
    null,
  );
  const [frameWidth, setFrameWidth] = useState(0);

  const documentHref = `/api/firm/sign/document/${token}`;

  // Set once the page has given up waiting. After that a render that
  // finishes late may still report a failure, but it may not report
  // 'ready': the signer has already been told the document did not
  // open, and a page that quietly takes that back would put
  // documentPresented true underneath a sentence saying otherwise.
  const expired = useRef(false);

  const report = useCallback(
    (next: SignerDocumentRenderStatus) => {
      if (expired.current && next === 'ready') return;
      setStatus(next);
      onStatusChange(next);
    },
    [onStatusChange],
  );

  // The one failure that had no sentence. A stalled body never
  // resolves and never rejects, and a frame measured at zero width
  // never renders a page at all; either way the signer sat on
  // "Opening the document." with Continue disabled, no error, and
  // nothing telling them to ask the firm. This runs from mount to the
  // first rendered page, so it covers the fetch, the parse and the
  // render alike, and it is cleared the moment the status leaves
  // pending.
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setTimeout(() => {
      expired.current = true;
      report('unavailable');
    }, SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, report]);

  // Width of the surface the page is drawn at. Measured rather than
  // assumed so a phone in landscape, a rotated tablet, and a resized
  // desktop window all get a page rendered at the size it is shown.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrameWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch and parse, once.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      // The transfer and the parse are separated because their
      // failures are different sentences and fetch does not
      // distinguish them: a dropped connection rejects with a
      // TypeError, exactly like a bug would, and telling a signer on a
      // train that their document may be damaged sends them and their
      // firm after the wrong thing.
      let bytes: ArrayBuffer;
      try {
        const res = await fetch(documentHref, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!cancelled) report(resolveDocumentResponseFailure(res.status));
          return;
        }
        bytes = await res.arrayBuffer();
      } catch {
        if (cancelled || controller.signal.aborted) return;
        report('unavailable');
        return;
      }
      try {
        // A stored file with no bytes in it is refused by the route
        // before it gets here, and refused as a missing document
        // rather than an oversized one. So 'empty' at this point means
        // something else: a response that was accepted and arrived
        // with nothing in it, which is its own sentence.
        const size = resolveDocumentSizeAcceptance(bytes.byteLength);
        if (size !== 'ok') {
          if (!cancelled) report(size);
          return;
        }
        const opened = await openSignerPdf(bytes);
        if (cancelled) {
          void opened.doc.destroy();
          return;
        }
        docRef.current = opened.doc;
        setPageCount(opened.pageCount);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // A worker that will not start and a file that will not parse
        // are different sentences to the signer, because the first is
        // fixed by another browser and the second is not.
        report(isWorkerFailure(err) ? 'unsupported' : 'unreadable');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void doc.destroy();
    };
  }, [documentHref, report]);

  // Draw the current page whenever it, the width, or the zoom changes.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !pageCount || frameWidth <= 0) return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const page = clampSignerPageNumber(pageNumber, pageCount);
        const out = await renderPageToCanvas({
          doc,
          pageNumber: page,
          canvas,
          cssWidthPx: frameWidth * zoom,
          devicePixelRatio:
            typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
          signal: controller.signal,
        });
        if (cancelled) return;
        setRendered({ ...out, pageNumber: page });
        report('ready');
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        report(isWorkerFailure(err) ? 'unsupported' : 'unreadable');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pageCount, pageNumber, frameWidth, zoom, report]);

  // Where the signature lands. Two passes, both pure: the first asks
  // only which page it is on, which needs the page count; the second
  // asks for the geometry, and is given real dimensions only when the
  // page on screen IS that page. Handing it another page's dimensions
  // would be a measurement of the wrong thing, which is worse than the
  // Letter assumption it would be replacing.
  const target = resolveSignatureLinePlacement({
    positionPage,
    positionX,
    positionY,
    pageCount,
  });
  const onSignaturePage =
    target.mode === 'placed' &&
    rendered !== null &&
    rendered.pageNumber === target.page;
  const placement = resolveSignatureLinePlacement({
    positionPage,
    positionX,
    positionY,
    pageCount,
    pageWidthPt: onSignaturePage ? rendered?.widthPt : null,
    pageHeightPt: onSignaturePage ? rendered?.heightPt : null,
  });

  useEffect(() => {
    onPlacementChange(placement);
    // The placement object is rebuilt every render; comparing it by
    // identity would fire this on every keystroke elsewhere on the
    // page, so the inputs that can actually change it are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    positionPage,
    positionX,
    positionY,
    pageCount,
    onSignaturePage,
    rendered?.widthPt,
    rendered?.heightPt,
  ]);

  // When the signer reaches the pad, take them to their signature
  // line. Multi-page navigation exists on this page for this reason.
  useEffect(() => {
    if (!focusSignature) return;
    if (target.mode !== 'placed') return;
    setPageNumber(clampSignerPageNumber(target.page, pageCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignature, target.mode === 'placed' ? target.page : null, pageCount]);

  // And scroll it into view once it is on screen. Our own element in
  // our own scroll container, which is the thing the rejected overlay
  // approach could never do through a cross-origin frame.
  useEffect(() => {
    if (!focusSignature || !onSignaturePage) return;
    boxRef.current?.scrollIntoView({ block: 'center', inline: 'center' });
  }, [focusSignature, onSignaturePage, rendered?.cssHeightPx]);

  if (status !== 'ready' && status !== 'pending') {
    return (
      <section className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">The document</p>
        <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          This document could not be opened here.
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          {SIGNER_DOCUMENT_RENDER_COPY[status]}
        </p>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          You should not be asked to sign something you cannot read, so signing
          is not available until it opens. You can ask{' '}
          <span data-no-translate>{firmName}</span> to send you the document.
        </p>
        {/* Only where it could actually help. A file over the ceiling
            and an empty response are refused by the route as well, so
            offering a new tab would walk the signer into the same
            refusal in a plainer typeface. So is a document the firm
            has withheld a copy of: the route serves this page's render
            fetch and refuses a browser pointed at the file. */}
        {copyPermitted && status !== 'too-large' && status !== 'empty' && (
          <p className="mt-4">
            <ExternalLink href={documentHref} className="btn-secondary text-sm">
              Try opening it in a new tab
            </ExternalLink>
          </p>
        )}
      </section>
    );
  }

  const rect =
    placement.mode === 'placed' && onSignaturePage
      ? rotateSignatureRectForDisplay(
          {
            leftFrac: placement.leftPct / 100,
            topFrac: placement.topPct / 100,
            widthFrac: placement.widthPct / 100,
            heightFrac: placement.heightPct / 100,
          },
          rendered?.rotationDeg,
        )
      : null;

  const total = pageCount ?? 1;

  /**
   * The signer's own words, drawn into the blanks the renderer recorded when
   * it drew the document.
   *
   * THIS IS ONE HALF OF THE PREVIEW-EQUALS-DELIVERED INVARIANT. The other
   * half is lib/signature-render.ts, and neither computes a rectangle: both
   * call resolveFieldBoxRect on the same stored box, and the only thing this
   * end adds is the conversion into the coordinates a browser positions in,
   * plus the page's own /Rotate, exactly as the signature box above already
   * does. tests/template-field-boxes.test.ts converts the result back into
   * points and asserts it reproduces the stamp's rectangle.
   *
   * What is NOT identical, stated plainly rather than implied: the GLYPHS.
   * pdf-lib draws Times through an embedded standard font and a browser
   * draws whatever serif it has, so the letters are an approximation of the
   * ones on the executed copy. The position, the extent and the wording are
   * the same by construction; the typeface is a likeness.
   */
  const drawnFields =
    rendered === null
      ? []
      : counterpartyFields.flatMap((field) => {
          const stored = fieldValues[field.key];
          if (!stored) return [];
          // Formatted through the same function the stamp uses, so a date
          // cannot read one way here and another on the signed copy.
          const text = formatCounterpartyValue(field, stored);
          if (!text) return [];
          const page = {
            pageWidthPt: rendered.widthPt,
            pageHeightPt: rendered.heightPt,
          };
          return boxesForKey(fieldBoxes, field.key)
            .filter((box) => box.page === rendered.pageNumber)
            .map((box, index) => {
              const boxRect = resolveFieldBoxRect(box, page);
              const fractions = rotateSignatureRectForDisplay(
                fieldRectToDisplayFractions(boxRect, page),
                rendered.rotationDeg,
              );
              return { id: `${field.key}-${index}`, text, ...fractions };
            })
            .filter((f) => f.widthFrac > 0 && f.heightFrac > 0);
        });

  return (
    <section
      className={`card overflow-hidden ${focusSignature ? 'sticky top-16 z-20' : ''}`}
    >
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-3">
        <p className="eyebrow mb-2">The document</p>
        <h2
          className="font-display text-lg sm:text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words"
          data-no-translate
        >
          {documentName}
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          {focusSignature && rect
            ? 'This is the page your signature goes on. The highlighted box is where it lands, and your signature appears in it as you draw.'
            : 'Read the whole document before you sign. Use the page controls below to move through it.'}
        </p>
      </div>

      <div
        ref={frameRef}
        className={`relative border-t border-ink-200 dark:border-forest-700/40 bg-ink-100 dark:bg-forest-950 overflow-auto ${
          focusSignature
            ? 'h-[38vh] min-h-[220px]'
            : 'h-[60vh] min-h-[380px] sm:h-[75vh]'
        }`}
      >
        <div className="relative w-max mx-auto">
          <canvas ref={canvasRef} className="block" />
          {/* Painted opaque over the ruled blank underneath, because that is
              what the executed copy does: the marker is still in the stored
              bytes and covering it is how the value replaces it rather than
              printing on top of it. The line under the text is the blank
              itself, kept so the page still reads as a filled-in form. */}
          {drawnFields.map((f) => (
            <div
              key={f.id}
              className="absolute pointer-events-none overflow-hidden flex items-end bg-white border-b border-forest-900/40"
              style={{
                left: `${f.leftFrac * 100}%`,
                top: `${f.topFrac * 100}%`,
                width: `${f.widthFrac * 100}%`,
                height: `${f.heightFrac * 100}%`,
                // The renderer draws the body at 11 points inside a 16 point
                // line, so the preview keeps that ratio against the height
                // the page was actually laid out at.
                fontSize: `${Math.max(
                  6,
                  f.heightFrac * (rendered?.cssHeightPx ?? 0) * (11 / 16),
                )}px`,
                fontFamily: '"Times New Roman", Times, serif',
                color: '#1a1a1a',
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
              }}
              data-no-translate
            >
              {f.text}
            </div>
          ))}
          {rect && (
            <div
              ref={boxRef}
              className="absolute rounded-[2px] ring-2 ring-forest-900/70 dark:ring-gold-metal/80 bg-forest-900/5 dark:bg-gold-metal/10 pointer-events-none overflow-hidden"
              style={{
                left: `${rect.leftFrac * 100}%`,
                top: `${rect.topFrac * 100}%`,
                width: `${rect.widthFrac * 100}%`,
                height: `${rect.heightFrac * 100}%`,
              }}
            >
              {markDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={markDataUrl}
                  alt="Your signature, where it will appear on the document"
                  className="w-full h-full object-contain"
                />
              ) : null}
            </div>
          )}
        </div>
        {status === 'pending' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
              {SIGNER_DOCUMENT_RENDER_COPY.pending}
            </p>
          </div>
        )}
      </div>

      <div className="px-5 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-200 dark:border-forest-700/40">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageNumber((p) => clampSignerPageNumber(p - 1, total))}
            disabled={pageNumber <= 1}
            className="btn-ghost text-sm min-h-[40px] px-3"
          >
            Previous
          </button>
          {/* Typed, not just stepped. Reading a long agreement with
              only Previous and Next means one click per page, and the
              signer is being asked to read the whole thing. */}
          <label className="text-[12px] text-ink-600 dark:text-cream-100/70">
            <span className="sr-only">Page number</span>
            <input
              type="number"
              min={1}
              max={total}
              value={pageNumber}
              onChange={(e) =>
                setPageNumber(
                  clampSignerPageNumber(Number(e.currentTarget.value), total),
                )
              }
              className="input w-16 px-2 py-1 text-[12px] text-center tabular-nums"
            />
          </label>
          <span className="text-[12px] text-ink-600 dark:text-cream-100/70 tabular-nums">
            of {total}
          </span>
          <button
            type="button"
            onClick={() => setPageNumber((p) => clampSignerPageNumber(p + 1, total))}
            disabled={pageNumber >= total}
            className="btn-ghost text-sm min-h-[40px] px-3"
          >
            Next
          </button>
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2))}
            disabled={zoom <= 1}
            className="btn-ghost text-sm min-h-[40px] px-3"
          >
            Smaller
          </button>
          <span className="text-[12px] text-ink-600 dark:text-cream-100/70 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.5) * 2) / 2))}
            disabled={zoom >= 3}
            className="btn-ghost text-sm min-h-[40px] px-3"
          >
            Larger
          </button>
        </div>

        {target.mode === 'placed' && (
          <button
            type="button"
            onClick={() => setPageNumber(clampSignerPageNumber(target.page, total))}
            className="btn-ghost text-sm min-h-[40px] px-3"
          >
            Go to your signature line
          </button>
        )}

        {/* Offered only when the firm has left the signer able to keep
            a copy. Otherwise the byte route refuses a browser pointed
            at the document, and a button that leads to a refusal is
            worse than no button. */}
        {copyPermitted && (
          <ExternalLink
            href={documentHref}
            className="btn-secondary text-sm ml-auto shrink-0"
          >
            Open in a new tab
          </ExternalLink>
        )}
      </div>
    </section>
  );
}

/**
 * Whether a failure is the browser refusing to run the renderer rather
 * than the file refusing to be read. The two need different sentences:
 * a signer whose browser cannot start a worker is helped by being told
 * to use another browser, and a signer with a damaged file is not.
 */
function isWorkerFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /worker|importScripts|SecurityError|not a function|is not defined/i.test(
    message,
  );
}
