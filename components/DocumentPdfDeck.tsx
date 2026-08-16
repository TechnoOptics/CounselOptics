'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { LABEL_RE } from '@/lib/signature-anchor-text';
import { openSignerPdf, renderPageToCanvas, type OpenedPdf } from '../app/sign/[token]/pdf-runtime';

/**
 * The REAL document, page by page, turning rather than scrolling.
 *
 * WHY THIS EXISTS AND components/DocumentSheets.tsx STILL DOES TOO. Asked why
 * an uploaded contract lost its pages and its formatting, the answer turned out
 * to be that a firm template stores plain text: lib/firm-templates.ts extracts
 * the file's words at upload and the file itself is never kept. So no preview
 * can show the ORIGINAL layout, and the sheets component reflowed that text and
 * estimated where the pages fell.
 *
 * But the document the employee actually sends is not that text either. It is a
 * PDF this app builds, on the firm's letterhead, with real pagination and a
 * real signature box. That PDF can be rendered exactly, so this renders it, and
 * the estimate goes away for the one surface that can build it.
 *
 * NOTHING NEW WAS WRITTEN TO DO IT. The signer's own page already rasterises
 * the document it asks somebody to sign, for a reason recorded there: an iframe
 * could not put the mark on the real signature line, and an overlay came apart
 * on the first scroll. Its runtime is imported here rather than reimplemented,
 * so the employee and the recipient are looking at the same pixels produced by
 * the same code.
 *
 * DocumentSheets stays for the two surfaces that hold text and cannot build a
 * PDF: the reviewer's copy and a past submission.
 */
export function DocumentPdfDeck({
  buildPdf,
  /** Changes whenever the document would change. Drives the rebuild. */
  revision,
  /** True once a signature exists, so the deck can turn to it. */
  signed,
  fallback,
}: {
  buildPdf: () => Promise<Blob>;
  revision: string;
  signed: boolean;
  /** Shown while the first build runs, and if a build fails. Usually the text
   *  preview, so the employee is never left with an empty frame. */
  fallback: React.ReactNode;
}) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [signaturePage, setSignaturePage] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'first' | 'building' | 'ready' | 'failed'>('first');
  // The opened document, held so the PAINT can happen in a second pass.
  //
  // The first version painted in the same effect that set the page list, and
  // every page came out blank: React had not created the canvases yet, so
  // every ref was null and the `continue` below skipped all of them silently.
  // Measured on production, six canvases sat at their 300x150 default having
  // never been drawn to. The signer page's own notes call a blank canvas the
  // most convincing way to appear to have shown somebody a document without
  // having shown them anything, and this was that.
  const opened = useRef<{ doc: OpenedPdf['doc']; generation: number } | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const frame = useRef<HTMLDivElement | null>(null);

  // One build in flight at a time, and the newest wins. Without the generation
  // check a slow early build can land after a fast later one and put stale
  // pages on screen, which on a document somebody is about to sign is the worst
  // kind of wrong: it looks settled.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const timer = setTimeout(async () => {
      setStatus((s) => (s === 'first' ? 'first' : 'building'));
      try {
        const blob = await buildPdf();
        const bytes = await blob.arrayBuffer();
        if (mine !== generation.current) return;
        const { doc, pageCount } = await openSignerPdf(bytes);
        if (mine !== generation.current) return;

        const sizes: { width: number; height: number }[] = [];
        let sigPage: number | null = null;
        for (let n = 1; n <= pageCount; n++) {
          const page = await doc.getPage(n);
          const v = page.getViewport({ scale: 1 });
          sizes.push({ width: v.width, height: v.height });
          if (sigPage === null) {
            // The page the signature line is on, found by READING the document
            // rather than assuming it is the last page. Multi-party agreements
            // put blocks on more than one page, and an appendix after the
            // signatures is ordinary. The vocabulary is the one
            // lib/signature-anchor-text.ts already established against a real
            // commercial NDA, imported rather than written a second time.
            const content = await page.getTextContent();
            const items = content.items as Array<{ str?: string }>;
            if (items.some((i) => LABEL_RE.test(i.str ?? ''))) sigPage = n - 1;
          }
          page.cleanup?.();
        }
        if (mine !== generation.current) return;
        setPages(sizes);
        setSignaturePage(sigPage);

        opened.current = { doc, generation: mine };
        setStatus('ready');
      } catch {
        // A failed build must not leave a blank frame where a contract goes. It
        // falls back to the text preview, which is always available because it
        // needs nothing but the words.
        if (mine === generation.current) setStatus('failed');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [buildPdf, revision]);

  /**
   * Paint the pages, AFTER React has made the canvases.
   *
   * Keyed on `pages`, so it runs on the render that created the canvas
   * elements rather than on the one that only decided how many there would be.
   * That ordering is the whole fix: the previous version ran in the build
   * effect, found every ref null, and skipped every page without a word.
   *
   * A missing canvas is now a FAILURE rather than a `continue`. There is no
   * legitimate reason for one to be absent at this point, and treating it as
   * routine is what let a deck of blank pages look like a rendered document.
   */
  useEffect(() => {
    const held = opened.current;
    if (!held || pages.length === 0) return;
    let cancelled = false;
    (async () => {
      const width = frame.current?.clientWidth ?? 612;
      try {
        for (let n = 1; n <= pages.length; n++) {
          const canvas = canvases.current[n - 1];
          if (cancelled || held.generation !== generation.current) return;
          if (!canvas) throw new Error('canvas missing');
          await renderPageToCanvas({
            doc: held.doc,
            pageNumber: n,
            canvas,
            cssWidthPx: width,
            devicePixelRatio: window.devicePixelRatio || 1,
          });
        }
      } catch {
        if (!cancelled && held.generation === generation.current) setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages]);

  const count = pages.length;
  const go = useCallback(
    (to: number) => setIndex((i) => Math.max(0, Math.min(to, count - 1))),
    [count],
  );

  // Turn to the signature when one lands. Keyed on `signed` so the deck moves
  // when a mark appears and never while somebody is reading a clause.
  useEffect(() => {
    if (signed && signaturePage !== null) setIndex(signaturePage);
  }, [signed, signaturePage]);

  useEffect(() => {
    if (count > 0) setIndex((i) => Math.min(i, count - 1));
  }, [count]);

  const drag = useRef<{ x: number; id: number } | null>(null);

  if (status === 'first' || status === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        {status === 'first' && (
          <p className="text-[12px] text-muted">Preparing the document.</p>
        )}
        {fallback}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <style>{TURN_CSS}</style>

      <div
        ref={frame}
        role="group"
        aria-roledescription="Document pages"
        aria-label={`Page ${index + 1} of ${count}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            go(index + 1);
          } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            go(index - 1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            go(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            go(count - 1);
          }
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, id: e.pointerId };
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const threshold = (frame.current?.clientWidth ?? 600) / 12;
          if (dx <= -threshold) go(index + 1);
          else if (dx >= threshold) go(index - 1);
        }}
        className="relative touch-pan-y overflow-hidden rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent"
        style={{
          aspectRatio: pages[0] ? `${pages[0].width} / ${pages[0].height}` : '612 / 792',
        }}
      >
        {pages.map((_, i) => (
          <div
            key={i}
            aria-hidden={i !== index}
            // inert, not merely aria-hidden: a page waiting off the deck must
            // leave the tab order too, or its contents stay reachable.
            {...(i !== index ? { inert: '' as unknown as boolean } : {})}
            className="doc-page absolute inset-0 overflow-hidden rounded-lg border border-edge bg-white shadow-card"
            style={{
              transform: `translateX(${(i - index) * 102}%)`,
              opacity: Math.abs(i - index) > 1 ? 0 : 1,
              pointerEvents: i === index ? 'auto' : 'none',
            }}
          >
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              className="block h-full w-full"
            />
          </div>
        ))}
        {status === 'building' && (
          <p className="absolute right-3 top-3 rounded-full bg-surface/90 px-3 py-1 text-[11px] text-muted shadow-card">
            Updating
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <TurnButton direction="previous" disabled={index === 0} onClick={() => go(index - 1)} />
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="h-[3px] w-full max-w-[240px] overflow-hidden rounded-full bg-ink-200 dark:bg-forest-700/60">
            <div
              className="doc-rail h-full rounded-full bg-accent"
              style={{ width: `${count ? ((index + 1) / count) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[12px] tabular-nums text-muted" aria-live="polite">
            Page {index + 1} of {count}
          </p>
        </div>
        <TurnButton
          direction="next"
          disabled={index >= count - 1}
          onClick={() => go(index + 1)}
        />
      </div>
    </div>
  );
}

function TurnButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  const next = direction === 'next';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={next ? 'Next page' : 'Previous page'}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-foreground transition-colors hover:bg-ink-50 disabled:cursor-default disabled:opacity-30 dark:hover:bg-forest-800/60"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
      </svg>
    </button>
  );
}

const TURN_CSS = `
.doc-page {
  transition: transform 420ms cubic-bezier(.22,.61,.36,1), opacity 260ms ease;
  will-change: transform;
  backface-visibility: hidden;
}
.doc-rail { transition: width 420ms cubic-bezier(.22,.61,.36,1); }
@media (prefers-reduced-motion: reduce) {
  .doc-page, .doc-rail { transition: none; }
}
`;
