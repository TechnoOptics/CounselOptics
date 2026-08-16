'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DocumentText } from './DocumentWithMark';
import { locateLine, pageGeometry, paginate } from '@/lib/document-pagination';

/**
 * A document shown as paper, one page at a time, turning rather than scrolling.
 *
 * REPLACES a single `whitespace-pre-wrap` block inside a `max-h-[70vh]` scroll
 * pane. Measured on production, that pane was 530px tall around 4168px of
 * content, so a person about to sign saw roughly an eighth of the document at a
 * time through a window that also swallowed the page's own scrolling.
 *
 * WHY TURNING RATHER THAN SCROLLING. A contract is read page by page and
 * referred to by page number. A deck gives the reader a fixed frame, a position
 * they can name, and an end they can see coming, none of which a column of text
 * offers. It also removes the last scroll conflict: there is nothing here that
 * can capture the wheel, because there is nothing here that scrolls.
 *
 * THE SIGNATURE ARRIVES IN VIEW. When a mark lands, the deck turns to the page
 * carrying the signature line and the mark is drawn on with a short entrance.
 * The signature block is the last thing in most of these documents, so a mark
 * that renders perfectly still arrives several pages away from wherever the
 * signer is looking, and from their chair that is indistinguishable from it not
 * rendering at all.
 *
 * The pagination is approximate and lib/document-pagination.ts says why. The
 * exact rendering is the full preview dialog, which builds the real PDF.
 */
export function DocumentSheets({
  text,
  markSrc,
  markLine,
}: {
  text: string;
  /** The mark, as a data URL or a short-lived signed URL. Null renders text. */
  markSrc: string | null;
  /** Which SOURCE line the mark sits above, or null for the end of the document. */
  markLine?: number | null;
}) {
  const pages = paginate(text);
  const geom = pageGeometry();
  const count = pages.length;

  // Where the mark goes, translated from a source line onto a sheet. A null
  // locator means the signature block was rewritten and the renderer puts the
  // mark at the end under a rule, so the same thing happens here rather than
  // the mark being dropped.
  const at =
    markSrc && markLine !== null && markLine !== undefined ? locateLine(text, markLine) : null;
  const markPage = markSrc ? (at ? Math.min(at.page, count - 1) : count - 1) : -1;

  const [index, setIndex] = useState(0);
  // Overview is a real reading mode, not a gadget.
  //
  // Asked for on the approvals page, and that is the surface that most needs
  // it: an approver is deciding whether a document goes out, which means
  // questions like "how long is this" and "where are the signature blocks" that
  // a one-page-at-a-time view answers slowly and a wall of pages answers at a
  // glance. It is on the shared deck rather than that page so the employee
  // filling the form gets it too.
  const [overview, setOverview] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);

  const go = useCallback(
    (to: number) => setIndex((i) => Math.max(0, Math.min(to, count - 1))),
    [count],
  );

  // Turn to the signature the moment it lands, and only then. Keyed on the mark
  // rather than running every render, so the deck never moves under somebody
  // who is reading.
  useEffect(() => {
    if (markPage >= 0) setIndex(markPage);
  }, [markSrc, markPage]);

  // A document that got shorter must not leave the reader past its last page.
  useEffect(() => {
    setIndex((i) => Math.min(i, count - 1));
  }, [count]);

  // Swipe, and a drag with a mouse. The threshold is a twelfth of the frame so
  // it scales with the sheet rather than being a pixel count that feels right
  // on one screen size and wrong on the rest.
  const drag = useRef<{ x: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const threshold = (frame.current?.clientWidth ?? 600) / 12;
    if (dx <= -threshold) go(index + 1);
    else if (dx >= threshold) go(index - 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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
  };

  if (overview) {
    return (
      <div className="flex flex-col gap-4">
        <style>{TURN_CSS}</style>
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12px] text-muted">
            {count === 1 ? '1 page' : `${count} pages`}
          </p>
          <ViewToggle overview onClick={() => setOverview(false)} />
        </div>
        {/* Two up on a phone, more as there is room. Small enough to see the
            shape of the document, large enough that a signature block is
            recognisable, which is the thing an approver is scanning for. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((page, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setIndex(i);
                setOverview(false);
              }}
              aria-label={`Go to page ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              className={`group relative overflow-hidden rounded-md border bg-white text-left shadow-card transition-shadow hover:shadow-card-hover ${
                i === index ? 'border-accent ring-1 ring-accent' : 'border-edge'
              }`}
              style={{ aspectRatio: `${geom.widthPt} / ${geom.heightPt}` }}
            >
              <div className="pointer-events-none h-full overflow-hidden px-[8%] py-[6%] font-serif text-[4px] leading-[1.4] text-forest-950 sm:text-[5px]">
                <div className="whitespace-pre-wrap">
                  {i === markPage ? (
                    <MarkedPage
                      page={page}
                      lineInPage={at ? at.lineInPage : Number.MAX_SAFE_INTEGER}
                      markSrc={markSrc}
                    />
                  ) : (
                    <DocumentText text={page} />
                  )}
                </div>
              </div>
              <span className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-white/85 px-1 font-serif text-[9px] tabular-nums text-ink-500">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
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
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="relative touch-pan-y overflow-hidden rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent"
        style={{ aspectRatio: `${geom.widthPt} / ${geom.heightPt}` }}
      >
        {pages.map((page, i) => (
          <article
            key={i}
            aria-hidden={i !== index}
            // Pages off the deck are removed from the tab order and the
            // accessibility tree as well as hidden. aria-hidden alone leaves
            // their contents focusable, which is worse than not hiding them.
            {...(i !== index ? { inert: '' as unknown as boolean } : {})}
            className="doc-sheet absolute inset-0 rounded-lg border border-edge bg-white px-[8%] py-[6%] shadow-card"
            style={{
              transform: `translateX(${(i - index) * 102}%)`,
              opacity: Math.abs(i - index) > 1 ? 0 : 1,
              pointerEvents: i === index ? 'auto' : 'none',
            }}
          >
            {/*
              No fixed height and no overflow-hidden on the text, and this is
              load-bearing. The first version clipped, and the rendered page
              showed the opening sheet cutting a definition of Confidential
              Information off mid-sentence: the lines-per-page estimate
              under-counts what a browser fits at its own size, and the
              remainder was simply hidden. Hiding text from somebody about to
              sign it is worse than the scrolling column this replaced.
            */}
            <div className="whitespace-pre-wrap font-serif text-[clamp(9px,1.55vw,12.5px)] leading-[1.45] text-forest-950">
              {i === markPage ? (
                <MarkedPage
                  page={page}
                  lineInPage={at ? at.lineInPage : Number.MAX_SAFE_INTEGER}
                  markSrc={markSrc}
                />
              ) : (
                <DocumentText text={page} />
              )}
            </div>
            <span className="pointer-events-none absolute bottom-[2.5%] right-[8%] font-serif text-[10px] tabular-nums text-ink-400">
              {i + 1}
            </span>
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <TurnButton
          direction="previous"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        />

        <div className="flex flex-1 flex-col items-center gap-2">
          {/* A rail rather than a row of dots: a forty page agreement would
              produce forty dots and tell the reader nothing. */}
          <div className="h-[3px] w-full max-w-[240px] overflow-hidden rounded-full bg-ink-200 dark:bg-forest-700/60">
            <div
              className="doc-rail h-full rounded-full bg-accent"
              style={{ width: `${((index + 1) / count) * 100}%` }}
            />
          </div>
          <p className="text-[12px] tabular-nums text-muted" aria-live="polite">
            Page {index + 1} of {count}
          </p>
          <ViewToggle overview={false} onClick={() => setOverview(true)} />
        </div>

        <TurnButton
          direction="next"
          disabled={index === count - 1}
          onClick={() => go(index + 1)}
        />
      </div>
    </div>
  );
}

/**
 * One sheet with the mark drawn onto its signature line.
 *
 * `lineInPage` past the end of the sheet puts the mark under a rule at the
 * bottom, matching what the renderer does with a document whose signature block
 * it cannot find. The mark is never dropped.
 */
function MarkedPage({
  page,
  lineInPage,
  markSrc,
}: {
  page: string;
  lineInPage: number;
  markSrc: string | null;
}) {
  // key on the source so a replaced signature plays the entrance again rather
  // than swapping silently. Somebody who signs twice should see it land twice.
  const image = (
    <img
      key={markSrc ?? ''}
      src={markSrc ?? ''}
      alt="Signature"
      data-signature-mark
      className="doc-mark my-1 block max-h-[56px] w-auto max-w-[200px] object-contain object-left"
    />
  );

  const lines = page.split('\n');
  if (lineInPage >= lines.length) {
    return (
      <>
        <DocumentText text={page} />
        <span className="mt-3 block h-px w-[200px] bg-ink-300" />
        {image}
      </>
    );
  }
  return (
    <>
      <DocumentText text={lines.slice(0, lineInPage).join('\n')} />
      {image}
      <DocumentText text={lines.slice(lineInPage).join('\n')} />
    </>
  );
}

/**
 * Switch between one page at a time and the whole document at a glance.
 *
 * A labelled control rather than a bare icon. This sits on a page where an
 * attorney is deciding whether a document leaves the building, and a mystery
 * glyph on that surface costs more than the few pixels the words take.
 */
function ViewToggle({ overview, onClick }: { overview: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={overview}
      className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-edge bg-surface px-3 text-[12px] text-foreground transition-colors hover:bg-ink-50 dark:hover:bg-forest-800/60"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {overview ? (
          <rect x="6" y="3" width="12" height="18" rx="1.5" />
        ) : (
          <>
            <rect x="3" y="3" width="7" height="8" rx="1" />
            <rect x="14" y="3" width="7" height="8" rx="1" />
            <rect x="3" y="13" width="7" height="8" rx="1" />
            <rect x="14" y="13" width="7" height="8" rx="1" />
          </>
        )}
      </svg>
      {overview ? 'One page' : 'All pages'}
    </button>
  );
}

/** A page turn control. A stroke chevron, drawn rather than typed, at a size a
 *  thumb can hit on a phone. */
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
 * The turn itself.
 *
 * A single eased translate rather than a folding-paper effect. A fold needs
 * perspective and a seam down the middle of the text, and on the one screen
 * where somebody is reading terms before signing them, legibility wins over the
 * flourish. The easing is a decelerating curve so a page arrives rather than
 * stops.
 *
 * Motion is dropped entirely under prefers-reduced-motion. Under that setting
 * the page still changes; it simply changes at once.
 */
const TURN_CSS = `
.doc-sheet {
  transition: transform 420ms cubic-bezier(.22,.61,.36,1), opacity 260ms ease;
  will-change: transform;
  backface-visibility: hidden;
}
.doc-rail { transition: width 420ms cubic-bezier(.22,.61,.36,1); }
.doc-mark { animation: doc-mark-in 520ms cubic-bezier(.22,.61,.36,1) both; }
@keyframes doc-mark-in {
  from { opacity: 0; transform: translateY(6px) scale(.97); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .doc-sheet, .doc-rail, .doc-mark { transition: none; animation: none; }
}
`;
