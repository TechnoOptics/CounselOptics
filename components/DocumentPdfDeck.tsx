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
  /**
   * Text from the field being filled in, so the deck can show the clause it
   * changes. Null when nothing is focused or the value is too short to find.
   */
  focusText,
  fallback,
}: {
  buildPdf: () => Promise<Blob>;
  revision: string;
  signed: boolean;
  focusText?: string | null;
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

  /**
   * The build function, held in a ref so it is never a DEPENDENCY.
   *
   * THE DEFECT THIS FIXES, reported as "I sign on my phone, I get the thank
   * you, but I do not see it on the rendered form on the laptop":
   *
   * `buildPdf` is declared inline by the fill page, so it is a NEW REFERENCE on
   * every render. With it in the effect's dependency list, every render tore
   * down the pending 700ms debounce and started a fresh one. The phone handoff
   * card polls every 1.2s while it waits, so renders arrived faster than the
   * timer could elapse and the rebuild NEVER RAN. The deck went on showing the
   * pages it had already built, which were the unsigned ones.
   *
   * `revision` is the honest dependency and always was: it is a string, it is
   * stable between renders, and it already contains everything that changes the
   * document, the mark included. The function only ever needs to be the latest
   * one, which is what a ref is for.
   */
  const buildRef = useRef(buildPdf);
  useEffect(() => {
    buildRef.current = buildPdf;
  });

  useEffect(() => {
    const mine = ++generation.current;
    const timer = setTimeout(async () => {
      setStatus((s) => (s === 'first' ? 'first' : 'building'));
      try {
        // A DEADLINE, because the failure this hit in production was a hang
        // and not a throw.
        //
        // Measured on the approvals page: the PDF route answered 200 and
        // `/pdf-worker/<version>/pdf.worker.min.mjs` stayed pending on every
        // attempt, with no console error. openSignerPdf awaits that worker, so
        // the promise never settled, the catch below never ran, and the deck
        // sat in its opening state showing the fallback for as long as the page
        // was open. Nothing was broken in a way anything could see, which is
        // the worst shape a defect can take.
        //
        // 30s rather than the signer page's 120s: this is a live preview beside
        // a form somebody is filling in, not the one-time render that gates a
        // signing ceremony, so it should give up while they still associate the
        // failure with the document.
        const blob = await withDeadline(buildRef.current(), PREVIEW_BUILD_TIMEOUT_MS);
        const bytes = await blob.arrayBuffer();
        if (mine !== generation.current) return;
        const { doc, pageCount } = await withDeadline(
          openSignerPdf(bytes),
          PREVIEW_BUILD_TIMEOUT_MS,
        );
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
      } catch (err) {
        // SAY WHY. This catch is how four rounds of diagnosis got spent on the
        // wrong causes: the release gate, a 403 from a probe with fake ids, and
        // a pdf worker that was never the problem. Every one of those would
        // have been settled in seconds by the error this used to swallow.
        //
        // console.error rather than a UI message: the reader must not be shown
        // a stack trace about a contract, and the person who needs this is
        // whoever is looking at the console while it happens.
        console.error('[preview] build failed:', err);
        // A failed build must not leave a blank frame where a contract goes. It
        // falls back to the text preview, which is always available because it
        // needs nothing but the words.
        if (mine === generation.current) setStatus('failed');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [revision]);

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
      } catch (err) {
        // The paint, separately named. A build that succeeds and a paint that
        // fails look identical from the outside, and this component has
        // already shipped a defect in each. Telling them apart is the whole
        // value of logging here.
        console.error('[preview] paint failed:', err);
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

  /**
   * The zoomed-out view of every page at once.
   *
   * SHIPPED TO THE WRONG COMPONENT FIRST. Asked for on the approvals page, it
   * was built into components/DocumentSheets.tsx, and approvals renders THIS
   * component, so the feature did not exist where it had been asked for.
   * Confirmed in the live browser: zero overview buttons on that page.
   *
   * The canvases stay MOUNTED across the switch. Remounting them would lose
   * the painted bitmaps and repaint every page, which on a long agreement is a
   * visible stall and, worse, a chance for the blank-canvas failure this
   * component already had once. Only the layout of their wrappers changes.
   */
  const [overview, setOverview] = useState(false);

  /**
   * Turn to the page carrying the text of the field being filled in.
   *
   * Searched in the RENDERED document rather than computed from the template,
   * because the placeholder is gone by then and only the page text can say
   * where a value actually landed.
   *
   * Deliberately does nothing when the value is not found, rather than falling
   * back to page one. A field whose text is not in the document yet, because
   * the rebuild has not finished, must leave the reader where they are: a
   * preview that jumps to the front on every keystroke is worse than one that
   * waits.
   *
   * Never runs in overview, where every page is already visible and moving the
   * deck underneath somebody would only take the view away from them.
   */
  useEffect(() => {
    const held = opened.current;
    const needle = (focusText ?? '').trim().toLowerCase();
    if (!held || needle.length < 3 || overview || pages.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= pages.length; n++) {
        if (cancelled || held.generation !== generation.current) return;
        try {
          const page = await held.doc.getPage(n);
          const content = await page.getTextContent();
          const text = (content.items as Array<{ str?: string }>)
            .map((i) => i.str ?? '')
            .join(' ')
            .toLowerCase();
          page.cleanup?.();
          if (text.includes(needle)) {
            if (!cancelled) setIndex(n - 1);
            return;
          }
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusText, pages, overview]);

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
        className={
          overview
            ? 'grid grid-cols-2 gap-3 outline-none sm:grid-cols-3 lg:grid-cols-4'
            : 'relative touch-pan-y overflow-hidden rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent'
        }
        style={
          overview
            ? undefined
            : {
                aspectRatio: pages[0] ? `${pages[0].width} / ${pages[0].height}` : '612 / 792',
              }
        }
      >
        {pages.map((_, i) => (
          <div
            key={i}
            // In overview every page is on screen, so none of them is hidden
            // and none may be inert. Marking them hidden there would take the
            // whole document out of the accessibility tree at exactly the
            // moment it is all visible.
            aria-hidden={overview ? undefined : i !== index}
            // inert, not merely aria-hidden: a page waiting off the deck must
            // leave the tab order too, or its contents stay reachable.
            {...(!overview && i !== index ? { inert: '' as unknown as boolean } : {})}
            onClick={
              overview
                ? () => {
                    setIndex(i);
                    setOverview(false);
                  }
                : undefined
            }
            role={overview ? 'button' : undefined}
            tabIndex={overview ? 0 : undefined}
            aria-label={overview ? `Go to page ${i + 1}` : undefined}
            onKeyDown={
              overview
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIndex(i);
                      setOverview(false);
                    }
                  }
                : undefined
            }
            className={
              overview
                ? `doc-thumb relative cursor-pointer overflow-hidden rounded-md border bg-white shadow-card transition-shadow hover:shadow-card-hover ${
                    i === index ? 'border-accent ring-1 ring-accent' : 'border-edge'
                  }`
                : 'doc-page absolute inset-0 overflow-hidden rounded-lg border border-edge bg-white shadow-card'
            }
            style={
              overview
                ? { aspectRatio: `${pages[i].width} / ${pages[i].height}` }
                : {
                    transform: `translateX(${(i - index) * 102}%)`,
                    opacity: Math.abs(i - index) > 1 ? 0 : 1,
                    pointerEvents: i === index ? 'auto' : 'none',
                  }
            }
          >
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              className="block h-full w-full"
            />
            {overview && (
              <span className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-white/85 px-1 font-serif text-[10px] tabular-nums text-ink-500">
                {i + 1}
              </span>
            )}
          </div>
        ))}
        {status === 'building' && (
          <p className="absolute right-3 top-3 rounded-full bg-surface/90 px-3 py-1 text-[11px] text-muted shadow-card">
            Updating
          </p>
        )}
      </div>

      {overview ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12px] text-muted">
            {count === 1 ? '1 page' : `${count} pages`}
          </p>
          <ViewToggle overview onClick={() => setOverview(false)} />
        </div>
      ) : (
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
          <ViewToggle overview={false} onClick={() => setOverview(true)} />
        </div>
        <TurnButton
          direction="next"
          disabled={index >= count - 1}
          onClick={() => go(index + 1)}
        />
      </div>
      )}
    </div>
  );
}

/**
 * Switch between one page and all of them.
 *
 * Same control, same words and same icons as the one in
 * components/DocumentSheets.tsx. Deliberately duplicated rather than shared:
 * the two decks have different internals and a shared control would have to
 * take a props bag describing both. What must not drift is what the reader
 * SEES, and a test holds the labels together.
 */
function ViewToggle({ overview, onClick }: { overview: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={overview}
      className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-ink-50 dark:hover:bg-forest-800/60"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {overview ? (
          <rect x="6" y="3" width="12" height="18" rx="1.5" />
        ) : (
          <>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </>
        )}
      </svg>
      {overview ? 'One page' : 'All pages'}
    </button>
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

/**
 * How long a preview may take before it is called failed.
 *
 * Deliberately not lib/signer-view.ts's 120s. That one gates a signing
 * ceremony and may only be spent once; this is a preview beside a form being
 * filled in, and a person who waits two minutes beside a form has stopped
 * connecting the delay to the document.
 */
const PREVIEW_BUILD_TIMEOUT_MS = 30_000;

/** Reject if the promise has not settled in time. A hang becomes a failure,
 *  and a failure is something the component can already show. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('preview timed out')), ms),
    ),
  ]);
}

const TURN_CSS = `
/*
 * Scale a page down to its thumbnail.
 *
 * renderPageToCanvas sets the canvas width and height INLINE, because it is
 * painting at a device-pixel-ratio-corrected size. An inline style beats a
 * class, so in the grid every canvas kept its full deck width and the cell,
 * which clips, showed the top-left corner of each page: "Mutual N" cut off
 * mid-word. Sixty-two passing tests could not see it; the rendered page could.
 *
 * !important is the right tool exactly here. The rule is not fighting another
 * stylesheet, it is overriding a style written by the paint routine, which has
 * no way to know it is being shown small.
 */
.doc-thumb canvas { width: 100% !important; height: 100% !important; }

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
