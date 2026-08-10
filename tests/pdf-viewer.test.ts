import { describe, it, expect } from 'vitest';
import {
  PDF_VIEWER_FAILURE_COPY,
  PDF_VIEWER_FIT_WIDTH,
  PDF_VIEWER_MAX_ZOOM,
  PDF_VIEWER_MIN_ZOOM,
  PDF_VIEWER_ZOOM_STEPS,
  acceptPdfByteLength,
  classifyPdfFetchFailure,
  classifyPdfOpenFailure,
  clampViewerPage,
  isPdfViewerFailure,
  nextPdfZoom,
  pdfZoomLabel,
  resolvePdfViewerKeyAction,
  type PdfViewerFailure,
} from '../lib/pdf-viewer';

const FAILURES: PdfViewerFailure[] = [
  'empty',
  'too-large',
  'unreadable',
  'unsupported',
  'unavailable',
];

describe('zoom ladder', () => {
  it('starts at fit-to-width, which is a stop on the ladder', () => {
    expect(PDF_VIEWER_ZOOM_STEPS).toContain(PDF_VIEWER_FIT_WIDTH);
  });

  it('walks the ladder one stop per press, in both directions', () => {
    let z: number = PDF_VIEWER_MIN_ZOOM;
    const up: number[] = [z];
    for (let i = 0; i < PDF_VIEWER_ZOOM_STEPS.length + 2; i++) {
      z = nextPdfZoom(z, 'in');
      up.push(z);
    }
    // Every stop is visited in order, then it stays at the top.
    expect(up.slice(0, PDF_VIEWER_ZOOM_STEPS.length)).toEqual([
      ...PDF_VIEWER_ZOOM_STEPS,
    ]);
    expect(up[up.length - 1]).toBe(PDF_VIEWER_MAX_ZOOM);

    let d: number = PDF_VIEWER_MAX_ZOOM;
    const down: number[] = [];
    for (let i = 0; i < PDF_VIEWER_ZOOM_STEPS.length; i++) {
      d = nextPdfZoom(d, 'out');
      down.push(d);
    }
    expect(d).toBe(PDF_VIEWER_MIN_ZOOM);
  });

  it('does not run off either end', () => {
    expect(nextPdfZoom(PDF_VIEWER_MAX_ZOOM, 'in')).toBe(PDF_VIEWER_MAX_ZOOM);
    expect(nextPdfZoom(PDF_VIEWER_MIN_ZOOM, 'out')).toBe(PDF_VIEWER_MIN_ZOOM);
    expect(nextPdfZoom(99, 'in')).toBe(PDF_VIEWER_MAX_ZOOM);
    expect(nextPdfZoom(0.01, 'out')).toBe(PDF_VIEWER_MIN_ZOOM);
  });

  /**
   * A press always moves the page the way it was pressed. Snapping to
   * the NEAREST stop instead would leave 1.1 zooming "in" to 1.0.
   */
  it('snaps a between-stops value onward, never backward', () => {
    expect(nextPdfZoom(1.1, 'in')).toBe(1.25);
    expect(nextPdfZoom(1.1, 'out')).toBe(1);
    expect(nextPdfZoom(0.9, 'in')).toBe(1);
    expect(nextPdfZoom(0.9, 'out')).toBe(0.75);
  });

  /**
   * A NaN scale renders a zero-sized canvas, which is the blank
   * rectangle this whole component exists to stop showing.
   */
  it('answers fit-width for a zoom that is not a number', () => {
    expect(nextPdfZoom(Number.NaN, 'in')).toBe(PDF_VIEWER_FIT_WIDTH);
    expect(nextPdfZoom(Number.POSITIVE_INFINITY, 'out')).toBe(
      PDF_VIEWER_FIT_WIDTH,
    );
    expect(pdfZoomLabel(Number.NaN)).toBe('100%');
  });

  it('reads out as a whole percentage', () => {
    expect(pdfZoomLabel(1)).toBe('100%');
    expect(pdfZoomLabel(0.75)).toBe('75%');
    expect(pdfZoomLabel(2.5)).toBe('250%');
  });
});

describe('failure states', () => {
  it('separates loading and ready from every failure', () => {
    expect(isPdfViewerFailure('loading')).toBe(false);
    expect(isPdfViewerFailure('ready')).toBe(false);
    for (const failure of FAILURES) {
      expect(isPdfViewerFailure(failure)).toBe(true);
    }
  });

  /**
   * The whole complaint about the iframe was that a document that had
   * gone from storage and a document rendering perfectly looked the
   * same. Every failure therefore has to say something DIFFERENT, and
   * every one has to end with something the reader can do.
   */
  it('gives every failure its own sentence and its own next step', () => {
    const whats = new Set<string>();
    const nexts = new Set<string>();
    for (const failure of FAILURES) {
      const copy = PDF_VIEWER_FAILURE_COPY[failure];
      expect(copy, failure).toBeDefined();
      expect(copy.what.trim().length, failure).toBeGreaterThan(20);
      expect(copy.next.trim().length, failure).toBeGreaterThan(20);
      whats.add(copy.what);
      nexts.add(copy.next);
    }
    expect(whats.size).toBe(FAILURES.length);
    expect(nexts.size).toBe(FAILURES.length);
  });

  /**
   * The reader here is the firm. Copy that tells them to ask the firm
   * is copy that tells them to do nothing, and it is the exact mistake
   * lifting SIGNER_DOCUMENT_RENDER_COPY across would have made.
   */
  it('never tells the firm to ask the firm', () => {
    for (const failure of FAILURES) {
      const copy = PDF_VIEWER_FAILURE_COPY[failure];
      expect(`${copy.what} ${copy.next}`.toLowerCase(), failure).not.toContain(
        'ask the firm',
      );
    }
  });

  it('keeps the calm register: no exclamation, no em dash', () => {
    for (const failure of FAILURES) {
      const copy = PDF_VIEWER_FAILURE_COPY[failure];
      const text = `${copy.what} ${copy.next}`;
      expect(text, failure).not.toContain('!');
      expect(text, failure).not.toContain('—');
    }
  });
});

describe('classifying what went wrong', () => {
  it('calls a worker that will not start a browser problem', () => {
    expect(classifyPdfOpenFailure(new Error('Setting up fake worker failed'))).toBe(
      'unsupported',
    );
    expect(classifyPdfOpenFailure(new Error('importScripts blew up'))).toBe(
      'unsupported',
    );
    expect(
      classifyPdfOpenFailure(new Error('Promise.withResolvers is not a function')),
    ).toBe('unsupported');
  });

  it('calls a file that will not parse a document problem', () => {
    expect(classifyPdfOpenFailure(new Error('Invalid PDF structure'))).toBe(
      'unreadable',
    );
    expect(classifyPdfOpenFailure(new Error('No password given'))).toBe(
      'unreadable',
    );
    // A non-Error rejection must still land somewhere rather than throw.
    expect(classifyPdfOpenFailure(null)).toBe('unreadable');
    expect(classifyPdfOpenFailure('boom')).toBe('unreadable');
  });

  it('reads 413 as too large and everything else as unavailable', () => {
    expect(classifyPdfFetchFailure(413)).toBe('too-large');
    expect(classifyPdfFetchFailure(404)).toBe('unavailable');
    expect(classifyPdfFetchFailure(400)).toBe('unavailable');
    expect(classifyPdfFetchFailure(500)).toBe('unavailable');
  });

  /**
   * An expired signed URL is the ordinary counsel failure: the page
   * mints one, the reader leaves the tab open, and the fetch comes back
   * 400 from storage. It must not read as a damaged document.
   */
  it('does not call an expired signed URL a damaged file', () => {
    expect(classifyPdfFetchFailure(400)).not.toBe('unreadable');
  });

  it('refuses an empty body and an oversized one, and accepts the rest', () => {
    expect(acceptPdfByteLength(0)).toBe('empty');
    expect(acceptPdfByteLength(null)).toBe('empty');
    expect(acceptPdfByteLength(40 * 1024 * 1024 + 1)).toBe('too-large');
    expect(acceptPdfByteLength(120_000)).toBe('ok');
  });
});

describe('page clamp', () => {
  it('keeps the page inside the document', () => {
    expect(clampViewerPage(0, 6)).toBe(1);
    expect(clampViewerPage(7, 6)).toBe(6);
    expect(clampViewerPage(3, 6)).toBe(3);
  });

  it('stays on page one while the page count is unknown', () => {
    expect(clampViewerPage(4, null)).toBe(1);
    expect(clampViewerPage(Number.NaN, 6)).toBe(1);
  });
});

describe('keyboard', () => {
  it('maps the keys a document reader expects', () => {
    expect(resolvePdfViewerKeyAction({ key: 'ArrowLeft' })).toBe('previous-page');
    expect(resolvePdfViewerKeyAction({ key: 'PageUp' })).toBe('previous-page');
    expect(resolvePdfViewerKeyAction({ key: 'ArrowRight' })).toBe('next-page');
    expect(resolvePdfViewerKeyAction({ key: 'PageDown' })).toBe('next-page');
    expect(resolvePdfViewerKeyAction({ key: 'Home' })).toBe('first-page');
    expect(resolvePdfViewerKeyAction({ key: 'End' })).toBe('last-page');
    expect(resolvePdfViewerKeyAction({ key: '+' })).toBe('zoom-in');
    expect(resolvePdfViewerKeyAction({ key: '=' })).toBe('zoom-in');
    expect(resolvePdfViewerKeyAction({ key: '-' })).toBe('zoom-out');
    expect(resolvePdfViewerKeyAction({ key: '0' })).toBe('fit-width');
  });

  /**
   * Up and Down scroll the page the reader is on. A viewer that stole
   * them to turn pages would take away the only way to read the bottom
   * of a page that is taller than the window.
   */
  it('leaves vertical scrolling alone', () => {
    expect(resolvePdfViewerKeyAction({ key: 'ArrowUp' })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: 'ArrowDown' })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: ' ' })).toBeNull();
  });

  /**
   * Cmd+Left is Back and Ctrl+Left is a cursor command. Turning a page
   * on either would spend a key the operating system already owns.
   */
  it('ignores anything carrying a modifier', () => {
    expect(resolvePdfViewerKeyAction({ key: 'ArrowLeft', metaKey: true })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: 'ArrowRight', ctrlKey: true })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: '0', altKey: true })).toBeNull();
  });

  it('ignores ordinary typing', () => {
    expect(resolvePdfViewerKeyAction({ key: 'a' })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: 'Enter' })).toBeNull();
    expect(resolvePdfViewerKeyAction({ key: 'Tab' })).toBeNull();
  });
});
