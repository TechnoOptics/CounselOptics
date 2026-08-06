'use client';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import {
  firstDroppedRenderObject,
  needsPromiseWithResolvers,
  resolveCanvasRenderScale,
} from '@/lib/signer-view';

/**
 * The only module on the signer page that knows pdf.js exists.
 *
 * Everything here is a call into the library or a browser API. Every
 * DECISION it makes - how big the canvas may be, which page is on
 * screen, whether the file is one this device should attempt, where
 * the signature box goes - lives in lib/signer-view.ts, because the
 * test environment is node with no DOM and canvas work is not
 * unit-testable here. What is left in this file is wiring, and it is
 * kept small for exactly that reason.
 *
 * Two things about it are load-bearing rather than incidental.
 *
 * SAME ORIGIN, ALL OF IT. This page is unauthenticated and its URL
 * carries a live signing credential. The library is bundled from
 * node_modules; the worker and the OpenJPEG wasm are copied out of
 * node_modules into public/pdf-worker/<version>/ by
 * scripts/copy-pdf-worker.mjs on prebuild and loaded from there; and
 * the PDF bytes come from /api/firm/sign/document/[token] on this
 * origin. Nothing is fetched from a CDN: no worker, no wasm, no font
 * file, no character map. `useWorkerFetch: false` keeps the library
 * from fetching anything from inside the worker, so even the wasm is
 * fetched by this page and handed across.
 *
 * cMapUrl and standardFontDataUrl are still unset, and that stays a
 * deliberate trade: a document needing a predefined CMap or a standard
 * font file renders with substituted glyphs rather than reaching for
 * them. It is a trade because the text is still there and still
 * readable. `wasmUrl` was left unset for the same reason and it was
 * NOT the same trade, which is why it is set now: without it the
 * OpenJPEG decoder cannot be reached at all, and a scanned agreement
 * whose pages are JPEG 2000 images - what Acrobat's optimiser and many
 * office scanners produce - loses every page image and renders as a
 * white rectangle. Nothing is substituted in that case. Nothing is
 * shown at all.
 *
 * NO EVAL. `isEvalSupported: false` turns off the optimisation that
 * compiles PDF font programs through the JS engine. It costs a little
 * speed on font-heavy documents and it removes the class of bug that
 * produced CVE-2024-4367, which is worth more on a page that renders
 * a file an unauthenticated visitor was sent.
 */

type PdfJsModule = typeof import('pdfjs-dist/build/pdf.min.mjs');

let modulePromise: Promise<PdfJsModule> | null = null;

/**
 * Load pdf.js once per page, lazily.
 *
 * Lazy because it is roughly 400 KB the signer does not need until the
 * document is being opened, and because importing it at module scope
 * would drag it into the server render of a page that has no canvas.
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  if (!modulePromise) {
    modulePromise = initPdfJs().catch((err) => {
      // Do not cache a failed load: a signer who reloads should get a
      // fresh attempt rather than the first failure forever.
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

async function initPdfJs(): Promise<PdfJsModule> {
  installPromiseWithResolvers();
  const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
  // Same origin, and version-locked without being vendored. The worker
  // is copied out of node_modules into public/pdf-worker/<version>/ by
  // scripts/copy-pdf-worker.mjs on prebuild, and the version in this
  // path is the one reported by the library that is about to use it,
  // so the two are the same string or the fetch 404s. It is not
  // bundled with `new URL(..., import.meta.url)` because the worker is
  // an ES module and Next minifies emitted .mjs assets in non-module
  // mode, which fails on the import.meta inside it.
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf-worker/${pdfjs.version}/pdf.worker.min.mjs`;
  return pdfjs;
}

/**
 * pdf.js 5 uses Promise.withResolvers unguarded. It shipped in Safari
 * 17.4 and Chrome 119, so a signer on an iPhone that stopped at iOS 16
 * would get a thrown reference instead of a contract. The predicate is
 * in lib/signer-view.ts so it can be tested without mutating the test
 * runner's globals; this is the installation.
 */
function installPromiseWithResolvers(): void {
  const target = Promise as unknown as {
    withResolvers?: unknown;
  };
  if (!needsPromiseWithResolvers(target)) return;
  target.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export type OpenedPdf = {
  doc: PDFDocumentProxy;
  pageCount: number;
};

/**
 * Open the document the signer is being asked to sign.
 *
 * Takes the bytes rather than a URL so the caller owns the fetch, the
 * abort, and the size check, and so pdf.js is never handed a URL it
 * could be talked into following.
 */
export async function openSignerPdf(bytes: ArrayBuffer): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
    // Same directory the worker was copied into, same version in the
    // path, same guarantee: our origin or nothing. The trailing slash
    // is required - pdf.js throws on a factory URL without one - and
    // the fetch is made by this page rather than the worker, so
    // connect-src 'self' is what covers it.
    wasmUrl: `/pdf-worker/${pdfjs.version}/wasm/`,
    // The whole file is already in hand, so there is nothing left to
    // fetch ahead. Nothing on this page mounts the annotation layer
    // either: only the canvas is drawn, so an interactive AcroForm
    // never appears as a second place to type with no bearing on the
    // signature.
    disableAutoFetch: true,
    // stopAtErrors is deliberately NOT set, and the reason is not the
    // obvious one. It would not have closed the hole it looks like it
    // closes: an image that cannot be decoded is caught inside
    // buildPaintImageXObject and resolved to null before any
    // ignoreErrors branch is reached, so the render still resolves.
    // That case is caught after the fact instead, in
    // renderPageToCanvas. What stopAtErrors WOULD do is turn every
    // benign defect in a real-world PDF - one unreadable font program,
    // one malformed shading - into a total refusal to show a document
    // that is otherwise perfectly readable, which blocks signings that
    // should go ahead without making the blank-page case any safer.
  });
  const doc = await task.promise;
  return { doc, pageCount: doc.numPages };
}

export type RenderedPage = {
  /** Unrotated page size in PDF points: the space the recorded
   *  signature coordinates and lib/signature-render.ts both use. */
  widthPt: number;
  heightPt: number;
  /** The page's own /Rotate, in degrees clockwise. */
  rotationDeg: number;
  /** CSS size the canvas was laid out at. */
  cssWidthPx: number;
  cssHeightPx: number;
};

/**
 * Draw one page onto one canvas and report what was drawn.
 *
 * The page is rendered WITH its rotation, because a signer cannot read
 * a contract sideways, and the unrotated dimensions are reported
 * alongside so the caller can put the signature box in the right place
 * (rotateSignatureRectForDisplay in lib/signer-view.ts).
 *
 * Throws on failure rather than leaving a blank canvas behind. A
 * canvas that allocated but drew nothing is the failure mode this
 * whole page exists to prevent, so the caller turns any throw into a
 * blocked signing step and a sentence the signer can act on.
 *
 * That claim needs the check below to be true, and it was not true of
 * the render task alone. pdf.js resolves a render whose page images
 * could not be decoded: the failure is caught in the worker, the image
 * is resolved to null, the canvas skips the paint, and the task
 * finishes clean over a page still showing nothing but the white fill.
 * So after the task resolves, the page's object bag is checked for
 * anything the worker could not produce (firstDroppedRenderObject),
 * and one null is enough to fail the render. See that function for why
 * a null there means exactly this and why an empty page does not count.
 *
 * The page is released afterwards either way. pdf.js caches every page
 * a reader visits, and this page asks the signer to read the whole
 * document, so without the release a long scanned agreement
 * accumulates decoded bitmaps until the tab is killed mid-ceremony.
 */
export async function renderPageToCanvas(input: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  cssWidthPx: number;
  devicePixelRatio: number;
  signal?: AbortSignal;
}): Promise<RenderedPage> {
  const page: PDFPageProxy = await input.doc.getPage(input.pageNumber);
  if (input.signal?.aborted) throw new Error('aborted');

  // rotation: 0 measures the space the coordinates were recorded in;
  // the default viewport below is what the signer actually reads.
  const unrotated = page.getViewport({ scale: 1, rotation: 0 });
  const scale = resolveCanvasRenderScale({
    pageWidthPt: unrotated.width,
    pageHeightPt: unrotated.height,
    cssWidthPx: input.cssWidthPx,
    devicePixelRatio: input.devicePixelRatio,
  });
  const viewport = page.getViewport({ scale });

  const ctx = input.canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not provide a 2D canvas.');

  input.canvas.width = Math.max(1, Math.floor(viewport.width));
  input.canvas.height = Math.max(1, Math.floor(viewport.height));
  // The canvas is laid out at the width it was measured at; the
  // backing store above is the same page at device resolution.
  const cssHeightPx = (viewport.height / viewport.width) * input.cssWidthPx;
  input.canvas.style.width = `${input.cssWidthPx}px`;
  input.canvas.style.height = `${cssHeightPx}px`;

  // A PDF page is white. Without this, a page whose content does not
  // cover it shows whatever was on the canvas before.
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, input.canvas.width, input.canvas.height);
  ctx.restore();

  const task = page.render({ canvas: input.canvas, canvasContext: ctx, viewport });
  input.signal?.addEventListener('abort', () => task.cancel(), { once: true });
  try {
    await task.promise;
    const dropped = firstDroppedRenderObject(page.objs);
    if (dropped) {
      throw new Error(
        `The page did not draw completely: ${dropped} could not be decoded.`,
      );
    }
  } finally {
    // After the check, not before: cleanup() empties the object bag
    // the check reads.
    page.cleanup();
  }

  return {
    widthPt: unrotated.width,
    heightPt: unrotated.height,
    rotationDeg: page.rotate ?? 0,
    cssWidthPx: input.cssWidthPx,
    cssHeightPx,
  };
}
