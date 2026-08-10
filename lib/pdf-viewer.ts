/**
 * The decisions behind the in-app PDF viewer, apart from the component
 * that makes them visible.
 *
 * Same reason lib/signer-view.ts exists: the unit suite runs in a node
 * environment with no DOM, so anything that can be WRONG on its own -
 * which zoom step comes next, what a failure is called, what it tells
 * the reader to do, which key does what - is a pure function over plain
 * values here, and components/PdfViewer.tsx is the wiring around it.
 *
 * The reader on the other side of this module is a firm: a lawyer or an
 * assistant looking at a document they, or their client, own. That is
 * who the copy below addresses, and it is why none of it is a copy of
 * SIGNER_DOCUMENT_RENDER_COPY. A signer is told to ask the firm for the
 * document. Telling the firm to ask the firm would be an instruction to
 * do nothing.
 *
 * What IS shared with the signer is shared rather than rewritten. The
 * page clamp, the size ceiling and the acceptance check below are
 * re-exports, because this repo has already paid for the same rule kept
 * in three hand-written copies that each claimed to agree
 * (lib/signature-geometry.ts exists for exactly that reason).
 */

import {
  clampSignerPageNumber,
  resolveDocumentSizeAcceptance,
  SIGNER_DOCUMENT_MAX_BYTES,
  SIGNER_DOCUMENT_TOO_LARGE_STATUS,
} from './signer-view';

/**
 * Which page the viewer is on: the signer page's clamp, under a name
 * that does not claim the signer owns it. Same function, so the two
 * surfaces cannot disagree about what page 0 or page 900 means.
 */
export const clampViewerPage = clampSignerPageNumber;

/**
 * How large a file the viewer will attempt, and whether these bytes
 * pass. Both are the signer's, deliberately: the ceiling is a property
 * of parsing a PDF in a browser tab, not of who is reading it, and a
 * firm previewing a document on a phone is the same device with the
 * same limits.
 */
export const PDF_VIEWER_MAX_BYTES = SIGNER_DOCUMENT_MAX_BYTES;
export const acceptPdfByteLength = resolveDocumentSizeAcceptance;

// ---------------------------------------------------------------------
// Where a preview can end up
// ---------------------------------------------------------------------

/**
 * Every state the viewer can be in, and each failure is separate
 * because each one has a different thing for the reader to DO. Folding
 * them into one "could not load the preview" is what the iframe this
 * replaced effectively did, and it is why a document that had been
 * removed from storage and a document that was rendering perfectly
 * looked identical: an empty rectangle either way.
 */
export type PdfViewerFailure =
  | 'empty'
  | 'too-large'
  | 'unreadable'
  | 'unsupported'
  | 'unavailable';

export type PdfViewerStatus = 'loading' | 'ready' | PdfViewerFailure;

export function isPdfViewerFailure(
  status: PdfViewerStatus,
): status is PdfViewerFailure {
  return status !== 'loading' && status !== 'ready';
}

/**
 * What each failure says, in two parts, and the split is the point.
 *
 * `what` is what happened, stated without blame and without jargon.
 * `next` is the one thing the reader can do about it. A message with
 * only the first half leaves somebody staring at a rectangle deciding
 * whether to call support; a message with only the second half tells
 * them to act without saying why.
 *
 * Calm, plain, and no exclamation: whoever is reading this is often
 * reading it under pressure, and a preview failing is an inconvenience
 * rather than an emergency.
 */
export const PDF_VIEWER_FAILURE_COPY: Record<
  PdfViewerFailure,
  { what: string; next: string }
> = {
  empty: {
    what: 'This file has no content in it, so there is nothing to show.',
    next: 'Upload the document again, or ask whoever sent it for a fresh copy.',
  },
  'too-large': {
    what: 'This document is larger than the preview can open in a browser tab.',
    next: 'Download it and open it in a PDF reader instead.',
  },
  unreadable: {
    what: 'This document could not be opened. It may be damaged, or protected with a password.',
    next: 'Download it and try opening it in a PDF reader, which will say if a password is needed.',
  },
  unsupported: {
    what: 'This browser could not start the document viewer.',
    next: 'Open the page in an up-to-date browser, or download the file and read it in a PDF reader.',
  },
  unavailable: {
    what: 'The document could not be loaded.',
    next: 'Check your connection and reload the page. If it keeps happening, the file may no longer be in storage.',
  },
};

/**
 * Whether a failure is the browser refusing to run the renderer rather
 * than the file refusing to be read.
 *
 * The two need different sentences, because a reader whose browser
 * cannot start a worker is helped by being told to use another browser,
 * and a reader with a damaged file is not.
 *
 * NOTE FOR WHOEVER OWNS app/sign/[token]/document-view.tsx: that file
 * carries a private `isWorkerFailure` with the same regex. This is the
 * second copy and it should be the last one. It is here rather than
 * there because a component in app/ cannot be imported by the unit
 * suite, and because the counsel surfaces have no business importing
 * from the signer's route folder.
 */
export function classifyPdfOpenFailure(
  err: unknown,
): Extract<PdfViewerFailure, 'unsupported' | 'unreadable'> {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /worker|importScripts|SecurityError|not a function|is not defined/i.test(
    message,
  )
    ? 'unsupported'
    : 'unreadable';
}

/**
 * What a non-OK response to the byte fetch means.
 *
 * 413 is the one status with its own sentence, and it is named rather
 * than spelled because the signer's byte route already answers with it
 * and the two must not drift. Everything else is 'unavailable': a
 * counsel surface fetches a time-limited signed storage URL, and an
 * expired signature, a deleted object and a network hiccup all end in
 * the same advice, which is to reload the page.
 */
export function classifyPdfFetchFailure(httpStatus: number): PdfViewerFailure {
  return httpStatus === SIGNER_DOCUMENT_TOO_LARGE_STATUS
    ? 'too-large'
    : 'unavailable';
}

// ---------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------

/**
 * Zoom is a multiple of the width the page is being shown at, not of
 * the page's own size in points.
 *
 * That is the honest model for a viewer whose container is a card on a
 * responsive page: there is no fixed physical size to be 100% of, and
 * claiming one would make the number mean something different on a
 * phone than on a desktop. So 1 IS fit-to-width, steps above it
 * overflow the container and scroll, and steps below it leave the page
 * centred with air around it, which is the only way to see a whole
 * landscape page on a narrow window.
 */
export const PDF_VIEWER_FIT_WIDTH = 1;

/**
 * The ladder, rather than a multiplier.
 *
 * A multiplier gives a reader 1.21x and 1.46x, which nobody asked for
 * and which makes returning to fit-width a matter of luck. Fixed stops
 * mean every press lands somewhere legible and the button that says
 * Fit width can genuinely put you back.
 */
export const PDF_VIEWER_ZOOM_STEPS = [
  0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3,
] as const;

export const PDF_VIEWER_MIN_ZOOM = PDF_VIEWER_ZOOM_STEPS[0];
export const PDF_VIEWER_MAX_ZOOM =
  PDF_VIEWER_ZOOM_STEPS[PDF_VIEWER_ZOOM_STEPS.length - 1];

/**
 * The next stop on the ladder, in the direction asked for.
 *
 * A value already at either end stays there, so the caller can disable
 * the button without a second rule about where the ends are. A value
 * BETWEEN stops - which nothing produces today, and which a future
 * pinch gesture would - snaps to the next stop in that direction rather
 * than to the nearest one, so the press always moves the page the way
 * it was pressed.
 *
 * Anything non-finite comes back as fit-width. A NaN zoom renders a
 * zero-width canvas, which is the blank page every part of this feature
 * exists to avoid.
 */
export function nextPdfZoom(current: number, direction: 'in' | 'out'): number {
  if (!Number.isFinite(current)) return PDF_VIEWER_FIT_WIDTH;
  if (direction === 'in') {
    for (const step of PDF_VIEWER_ZOOM_STEPS) {
      if (step > current + 1e-9) return step;
    }
    return PDF_VIEWER_MAX_ZOOM;
  }
  for (let i = PDF_VIEWER_ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = PDF_VIEWER_ZOOM_STEPS[i];
    if (step < current - 1e-9) return step;
  }
  return PDF_VIEWER_MIN_ZOOM;
}

/** The label on the zoom readout. A percentage of the fit width. */
export function pdfZoomLabel(zoom: number): string {
  const safe = Number.isFinite(zoom) ? zoom : PDF_VIEWER_FIT_WIDTH;
  return `${Math.round(safe * 100)}%`;
}

// ---------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------

export type PdfViewerKeyAction =
  | 'previous-page'
  | 'next-page'
  | 'first-page'
  | 'last-page'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-width';

/**
 * Which viewer action a key press asks for, if any.
 *
 * Only the keys a document reader expects, and deliberately NOT the
 * arrow keys on their own axis of scroll: Up and Down are left alone so
 * the surface still scrolls the page the reader is on, which is the
 * more common thing to want and the thing a browser already does well.
 * Left and Right change page, because a canvas has nothing to scroll
 * horizontally at fit width.
 *
 * A press carrying a modifier returns null. Ctrl+Left is a text-cursor
 * command and Cmd+Left is Back; swallowing either to turn a page would
 * take a key away from the reader that the operating system already
 * spent.
 */
export function resolvePdfViewerKeyAction(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): PdfViewerKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowLeft':
    case 'PageUp':
      return 'previous-page';
    case 'ArrowRight':
    case 'PageDown':
      return 'next-page';
    case 'Home':
      return 'first-page';
    case 'End':
      return 'last-page';
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
    case '_':
      return 'zoom-out';
    case '0':
      return 'fit-width';
    default:
      return null;
  }
}
