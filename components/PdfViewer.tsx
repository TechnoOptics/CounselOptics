'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  PDF_VIEWER_FAILURE_COPY,
  PDF_VIEWER_FIT_WIDTH,
  PDF_VIEWER_MAX_ZOOM,
  PDF_VIEWER_MIN_ZOOM,
  acceptPdfByteLength,
  classifyPdfFetchFailure,
  classifyPdfOpenFailure,
  clampViewerPage,
  isPdfViewerFailure,
  nextPdfZoom,
  pdfZoomLabel,
  resolvePdfViewerKeyAction,
  type PdfViewerStatus,
} from '@/lib/pdf-viewer';
import {
  openSignerPdf,
  renderPageToCanvas,
} from '@/app/sign/[token]/pdf-runtime';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The one PDF viewer the firm surfaces use.
 *
 * It replaced two bare `<iframe>` elements pointed at a PDF - the
 * counsel document preview (components/counsel/DocumentFrame.tsx) and
 * the print-and-send dialog (components/PdfPreviewDialog.tsx) - and the
 * problem with both was the same. An iframe hands the whole experience
 * to whatever the browser does with application/pdf, which means:
 *
 *   - No page navigation, no page count, no zoom, no fit-to-width. A
 *     reader on a phone got a letter page squeezed into 375 points with
 *     no way to enlarge it.
 *   - No loading state and, worse, NO ERROR STATE. A signed storage URL
 *     that had expired, a file removed from the bucket, and a document
 *     rendering perfectly all looked identical: an empty rectangle. The
 *     reader had no way to tell "this is loading" from "this is gone",
 *     and nothing told them what to do about either.
 *   - Chrome's viewer titles the document with the blob UUID and adds
 *     its own Download and Print, next to ours, saving under a name
 *     that is not the document's. Safari and the in-app WebViews do
 *     something else again, and iOS frequently downloads the file
 *     rather than displaying it.
 *
 * So the page is rasterised here instead, onto our own canvas, inside
 * our own chrome. That is not a new capability in this repo: the signer
 * page already does it, and this uses ITS runtime
 * (app/sign/[token]/pdf-runtime.ts) rather than a third copy of the
 * pdf.js wiring. What is not reused is the signer's COMPONENT, which is
 * bound to a token, a drawn mark, a signature placement and the
 * counterparty's fields, none of which exist here.
 *
 * WHERE THIS FILE SHOULD LIVE, EVENTUALLY. The runtime import reaches
 * into a route folder, which is backwards: a shared component should
 * not depend on one page's directory. It is imported rather than moved
 * because app/sign is owned elsewhere right now. Moving pdf-runtime.ts
 * to lib/ and re-pointing both importers is a rename and nothing more.
 *
 * WHAT THIS VIEWER DOES NOT DO, stated plainly because it is a real
 * trade against the iframe. It draws pixels, so there is no selectable
 * text and no in-document search, and a screen reader gets the page
 * label rather than the page. Both surfaces keep a download link beside
 * the viewer for exactly that reason, and the reader who needs the text
 * gets the actual file rather than an approximation of it.
 */

export type PdfViewerSource =
  /** A URL the browser will fetch. Same-origin or a signed storage URL;
   *  the caller owns whether it is still valid. */
  | { kind: 'url'; url: string }
  /** Bytes already in hand, which is the dialog: it builds the exact
   *  PDF the Download button produces and shows THOSE bytes, so the
   *  preview and the file cannot be different documents. */
  | { kind: 'blob'; blob: Blob };

export function PdfViewer({
  source,
  title,
  className = 'w-full h-[70vh]',
  fallbackHref,
}: {
  source: PdfViewerSource;
  /** The document's name. Used as the viewer's accessible name; never
   *  drawn as a heading, because both callers already show one. */
  title: string;
  /** Sizing for the page surface. The caller owns the height, because a
   *  card on a page and a panel inside a dialog want different ones. */
  className?: string;
  /** Where the file can be opened outside this viewer. Offered in the
   *  failure state, which is the one place it is genuinely the next
   *  thing to try. */
  fallbackHref?: string;
}) {
  const [status, setStatus] = useState<PdfViewerStatus>('loading');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<number>(PDF_VIEWER_FIT_WIDTH);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  // Two viewers can share a page (a signing request shows the original
  // and the executed copy), so the surface's id is per-instance rather
  // than a constant. A duplicated id makes aria-controls point at
  // whichever one the browser found first.
  const surfaceId = useId();
  // The failure copy comes out of a Record rather than a literal, so it
  // goes through the lookup directly instead of <T>{expr}</T>: a braced
  // wrap is the pattern scripts/test/counsel-i18n-invariants.mjs makes
  // somebody review, and it reserves that review for wraps that might
  // be carrying user data. These five sentences are ours.
  const t = useT();

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<Awaited<ReturnType<typeof openSignerPdf>>['doc'] | null>(
    null,
  );

  // The identity of what is being shown. A URL string for the counsel
  // surfaces and the Blob itself for the dialog, and either way it is
  // the ONLY thing that may restart the fetch: a re-render that hands
  // over the same document must not drop the reader back to page one.
  const sourceKey = source.kind === 'url' ? source.url : source.blob;

  // Width the page is laid out at. Measured rather than assumed, so a
  // phone rotated to landscape, a resized window and a dialog that
  // grows all render the page at the size it is shown.
  //
  // The surface's own padding comes off it, and that is not a detail:
  // clientWidth INCLUDES padding, so drawing the page at clientWidth
  // makes the sheet wider than the box that holds it and puts a
  // horizontal scrollbar under a button labelled Fit width. The padding
  // is read rather than repeated as a constant here, so changing the
  // class cannot silently un-fit the fit.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => {
      const style = window.getComputedStyle(el);
      const gutters =
        (parseFloat(style.paddingLeft) || 0) +
        (parseFloat(style.paddingRight) || 0);
      setSurfaceWidth(Math.max(0, el.clientWidth - gutters));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Get the bytes and parse them, once per document.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setStatus('loading');
    setPageCount(null);
    setPageNumber(1);

    (async () => {
      // The transfer and the parse are kept apart because their
      // failures are different sentences. A dropped connection rejects
      // with a TypeError exactly as a bug would, and telling someone
      // their document may be damaged when their wifi dropped sends
      // them after the wrong thing.
      let bytes: ArrayBuffer;
      try {
        if (source.kind === 'blob') {
          bytes = await source.blob.arrayBuffer();
        } else {
          const res = await fetch(source.url, {
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (!res.ok) {
            if (!cancelled) setStatus(classifyPdfFetchFailure(res.status));
            return;
          }
          bytes = await res.arrayBuffer();
        }
      } catch {
        if (cancelled || controller.signal.aborted) return;
        setStatus('unavailable');
        return;
      }

      try {
        const size = acceptPdfByteLength(bytes.byteLength);
        if (size !== 'ok') {
          if (!cancelled) setStatus(size);
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
        setStatus(classifyPdfOpenFailure(err));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void doc.destroy();
    };
    // The document is the only dependency. `source` is rebuilt on every
    // render by both callers, so depending on the object itself would
    // re-fetch and re-parse on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // Draw the page whenever it, the width, or the zoom changes.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !pageCount || surfaceWidth <= 0) return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        await renderPageToCanvas({
          doc,
          pageNumber: clampViewerPage(pageNumber, pageCount),
          canvas,
          cssWidthPx: surfaceWidth * zoom,
          devicePixelRatio:
            typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
          signal: controller.signal,
        });
        if (cancelled) return;
        setStatus('ready');
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // renderPageToCanvas throws rather than leaving a blank canvas
        // behind, including when pdf.js quietly dropped an image it
        // could not decode. A page that did not draw completely has to
        // say so; showing the white rectangle it would otherwise leave
        // is the failure this component was built to remove.
        setStatus(classifyPdfOpenFailure(err));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pageCount, pageNumber, surfaceWidth, zoom]);

  const total = pageCount ?? 1;
  const goToPage = useCallback(
    (next: number) => setPageNumber(clampViewerPage(next, pageCount)),
    [pageCount],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = resolvePdfViewerKeyAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'previous-page') goToPage(pageNumber - 1);
      else if (action === 'next-page') goToPage(pageNumber + 1);
      else if (action === 'first-page') goToPage(1);
      else if (action === 'last-page') goToPage(total);
      else if (action === 'zoom-in') setZoom((z) => nextPdfZoom(z, 'in'));
      else if (action === 'zoom-out') setZoom((z) => nextPdfZoom(z, 'out'));
      else setZoom(PDF_VIEWER_FIT_WIDTH);
    },
    [goToPage, pageNumber, total],
  );

  if (isPdfViewerFailure(status)) {
    const copy = PDF_VIEWER_FAILURE_COPY[status];
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 border-y border-edge bg-surface-2 px-6 py-10 text-center ${className}`}
        role="alert"
      >
        <p className="text-[14px] font-medium text-foreground">{t(copy.what)}</p>
        <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">
          {t(copy.next)}
        </p>
        {fallbackHref && (
          <a
            href={fallbackHref}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary mt-2 text-sm"
          >
            <T>Open the file in a new tab</T>
          </a>
        )}
      </div>
    );
  }

  const loading = status === 'loading';
  const controlsReady = !loading && pageCount !== null;

  return (
    <div className="flex flex-col border-y border-edge bg-surface">
      <div
        role="toolbar"
        aria-label={`Document controls for ${title}`}
        aria-controls={surfaceId}
        // Two groups rather than one row of controls, and the wrap is
        // why. At 375 points the whole row does not fit, and a flat row
        // breaks wherever it runs out: the last time, between the zoom
        // out and the zoom in, which put half of one control on each
        // line. Grouping makes the break land between paging and
        // zooming, which is where a reader would put it.
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 sm:px-3"
      >
        <div className="flex items-center gap-1">
        <Control
          label={t('Previous page')}
          onClick={() => goToPage(pageNumber - 1)}
          disabled={!controlsReady || pageNumber <= 1}
        >
          <Chevron direction="left" />
        </Control>

        <label className="inline-flex items-center gap-1.5 px-1">
          <span className="sr-only">
            <T>Page number</T>
          </span>
          <input
            type="number"
            min={1}
            max={total}
            value={pageNumber}
            disabled={!controlsReady}
            onChange={(e) => goToPage(Number(e.currentTarget.value))}
            className="input h-10 w-14 px-1 py-1 text-center text-[13px] tabular-nums"
          />
          <span className="whitespace-nowrap text-[12.5px] tabular-nums text-muted">
            <T>of</T> {controlsReady ? total : '-'}
          </span>
        </label>

        <Control
          label={t('Next page')}
          onClick={() => goToPage(pageNumber + 1)}
          disabled={!controlsReady || pageNumber >= total}
        >
          <Chevron direction="right" />
        </Control>
        </div>

        <span aria-hidden className="hidden h-5 w-px bg-edge sm:block" />

        <div className="flex items-center gap-1">
        <Control
          label={t('Zoom out')}
          onClick={() => setZoom((z) => nextPdfZoom(z, 'out'))}
          disabled={!controlsReady || zoom <= PDF_VIEWER_MIN_ZOOM}
        >
          <Minus />
        </Control>
        <span className="min-w-[3.25rem] text-center text-[12.5px] tabular-nums text-muted">
          {pdfZoomLabel(zoom)}
        </span>
        <Control
          label={t('Zoom in')}
          onClick={() => setZoom((z) => nextPdfZoom(z, 'in'))}
          disabled={!controlsReady || zoom >= PDF_VIEWER_MAX_ZOOM}
        >
          <Plus />
        </Control>
        <button
          type="button"
          onClick={() => setZoom(PDF_VIEWER_FIT_WIDTH)}
          disabled={!controlsReady}
          aria-pressed={zoom === PDF_VIEWER_FIT_WIDTH}
          className="btn-ghost h-10 px-2.5 text-[13px] font-normal"
        >
          <T>Fit width</T>
        </button>
        </div>
      </div>

      <div
        id={surfaceId}
        ref={surfaceRef}
        tabIndex={0}
        role="group"
        aria-label={title}
        onKeyDown={onKeyDown}
        className={`relative overflow-auto border-t border-edge bg-surface-2 p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500/60 sm:p-4 ${className}`}
      >
        <div className="mx-auto w-max">
          <canvas
            ref={canvasRef}
            aria-label={`${title}, page ${pageNumber} of ${total}`}
            role="img"
            // The hairline is not decoration. A white page on the light
            // theme's near-white inset has almost no edge of its own, so
            // without it the sheet and the surface run together and the
            // reader cannot see where the document stops.
            className={`block rounded-[2px] shadow-card ring-1 ring-edge ${loading ? 'invisible' : ''}`}
          />
        </div>

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-2">
            {/* A calm placeholder rather than a spinner, and the pulse
                stops for anyone who has asked their system for less
                motion. */}
            <div
              aria-hidden
              className="h-1 w-24 animate-pulse rounded-full bg-edge motion-reduce:animate-none"
            />
            <p className="text-[13px] text-muted">
              <T>Opening the document.</T>
            </p>
          </div>
        )}
      </div>

      {/* Page changes are silent for a screen reader otherwise: the
          canvas label changes, and a changed label is not announced. */}
      <p aria-live="polite" className="sr-only">
        {controlsReady ? `Page ${pageNumber} of ${total}` : ''}
      </p>
    </div>
  );
}

function Control({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="btn-ghost h-10 w-10 px-0"
    >
      {children}
    </button>
  );
}

/* Plain stroke icons, sized to the 13px type beside them. */

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function Minus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function Plus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
