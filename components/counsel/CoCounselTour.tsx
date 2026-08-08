'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * First-run guided wizard for CO-COUNSEL on a shared matter. A guest attorney
 * lands on a workspace they've never seen, so this walks them through the two
 * things that aren't obvious: that the sections are COLLAPSED and open on tap,
 * and how to move between the matter overview, the timeline, and the tools -
 * and back.
 *
 * The step visuals are faithful renders of the real controls (same styling as
 * SectionPanel, CounselGuestNav and the NavTiles) rather than baked-in
 * screenshots - so they always match the live UI, stay crisp on every display,
 * and one step is a REAL collapsible the reader can actually open.
 *
 * Shows once per browser (localStorage), and can be replayed any time via the
 * "Show me around" control, which dispatches `advottic:cocounsel-tour`.
 */

const SEEN_KEY = 'advottic.cocounsel.tour.v1';
export const TOUR_OPEN_EVENT = 'advottic:cocounsel-tour';

export function CoCounselTour({ firstName }: { firstName?: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Auto-open on the first visit only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);
  }, []);

  // Replay hook: the workspace's "Show me around" button fires this event.
  useEffect(() => {
    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_OPEN_EVENT, reopen);
    return () => window.removeEventListener(TOUR_OPEN_EVENT, reopen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode - fine, it just shows again next time */
    }
  }, []);

  // Esc to dismiss; move initial focus into the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!mounted || !open) return null;

  const steps = getSteps(firstName);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const node = (
    <div
      // `dark counsel-shell` is essential: the modal is portaled to document.body,
      // OUTSIDE the .counsel-shell wrapper. Without these classes the forest tokens
      // fall back to the consumer :root values (a dark GREEN, #0a1f19) instead of
      // the counsel shell's neutral black (--forest-950: #080808), so the tour
      // looked green against the black firm UI. Re-applying the class here pulls the
      // same black palette into the portal subtree.
      className="dark counsel-shell fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cocounsel-tour-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gold-metal/25 bg-forest-950 shadow-2xl outline-none ring-1 ring-black/40 sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Header: brand + skip */}
        <div className="flex items-center justify-between gap-3 border-b border-cream-50/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {/* Plain <img> (not next/image) so the real mark renders in every
                webview, matching LoadingOverlay. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/advottic-mark.png" alt="" width={22} height={22} className="select-none" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300">
              Getting started
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-cream-100/55 transition-colors hover:bg-cream-100/5 hover:text-cream-100"
          >
            Skip
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {/* Visual "screen" */}
          <div className="rounded-xl border border-cream-50/10 bg-forest-900/40 p-3 shadow-inner sm:p-4">
            {current.visual}
          </div>

          {/* Copy */}
          <div className="mt-5">
            <h2
              id="cocounsel-tour-title"
              className="text-xl font-medium tracking-[-0.01em] text-cream-50"
            >
              {current.title}
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-cream-100/75">{current.body}</p>
          </div>
        </div>

        {/* Footer: progress dots + controls */}
        <div className="flex items-center justify-between gap-3 border-t border-cream-50/10 px-5 py-4">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-5 bg-gold-metal' : 'w-1.5 bg-cream-100/20'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-cream-100/75 transition-colors hover:bg-cream-100/5 hover:text-cream-100"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? close() : setStep((s) => s + 1))}
              className="rounded-lg bg-gold-metal px-4 py-2 text-[13px] font-semibold text-forest-950 shadow-sm transition-colors hover:bg-gold-300"
            >
              {isLast ? 'Start working' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

/**
 * Small replay control for the workspace header. Dispatches the open event so
 * counsel can revisit the walkthrough whenever they like.
 */
export function CoCounselTourReplay({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TOUR_OPEN_EVENT))}
      className={`inline-flex items-center gap-1.5 rounded-full border border-cream-50/15 bg-forest-900/40 px-3 py-1.5 text-[12px] font-medium text-cream-100/75 transition-colors hover:border-gold-metal/40 hover:text-cream-100 ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8h.01M11 12h1v4h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Show me around
    </button>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────

function getSteps(firstName?: string | null): {
  title: string;
  body: ReactNode;
  visual: ReactNode;
}[] {
  const hi = firstName ? `${firstName}, this` : 'This';
  return [
    {
      title: 'Welcome to the matter',
      body: (
        <>
          {hi} is your co-counsel workspace: everything you need on this matter,
          and nothing from the firm&rsquo;s internal billing. It&rsquo;s laid out
          top to bottom: the party and case facts first, then the analysis and
          evidence. Here&rsquo;s how to move through it.
        </>
      ),
      visual: <WelcomeVisual />,
    },
    {
      title: 'Open a section to read it',
      body: (
        <>
          The <strong className="text-cream-50">Case analysis</strong> and{' '}
          <strong className="text-cream-50">Evidence overview</strong> sections
          start collapsed to keep the page calm. Tap a section&rsquo;s header and
          it expands. The little chevron flips to show it&rsquo;s open. Try it
          right here:
        </>
      ),
      visual: <CollapsibleDemo />,
    },
    {
      title: 'Move around, and come back',
      body: (
        <>
          The bar at the top of every page has{' '}
          <strong className="text-cream-50">Matter overview</strong> and{' '}
          <strong className="text-cream-50">Timeline</strong>. Wherever you are,
          tap <strong className="text-cream-50">Matter overview</strong> to return
          to this home page for the matter.
        </>
      ),
      visual: <NavVisual />,
    },
    {
      title: 'Open a full tool',
      body: (
        <>
          At the bottom are three tiles. Use them to open the full{' '}
          <strong className="text-cream-50">Timeline</strong>, browse the{' '}
          <strong className="text-cream-50">Evidence files</strong>, or download
          the <strong className="text-cream-50">Export packet</strong> as a PDF
          for filing or review.
        </>
      ),
      visual: <TilesVisual />,
    },
    {
      title: 'You’re all set',
      body: (
        <>
          That&rsquo;s the whole tour. Need it again? Tap{' '}
          <strong className="text-cream-50">Show me around</strong> at the top of
          the matter page any time. Now dive in.
        </>
      ),
      visual: <DoneVisual />,
    },
  ];
}

// ── Faithful control facsimiles (mirror the real components) ─────────────────

/** A miniature of the whole page so the layout order clicks into place. */
function WelcomeVisual() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md bg-forest-950/70 px-2.5 py-1.5">
        <span className="rounded bg-cream-100/10 px-2 py-0.5 text-[9px] font-semibold text-cream-100 ring-1 ring-gold-metal/40">
          Matter overview
        </span>
        <span className="px-2 py-0.5 text-[9px] font-medium text-cream-100/50">Timeline</span>
      </div>
      <MiniRow label="Party &amp; case facts" tall />
      <MiniRow label="Case analysis" chevron />
      <MiniRow label="Evidence overview" chevron />
      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MiniTile>Timeline</MiniTile>
        <MiniTile>Evidence</MiniTile>
        <MiniTile>Export</MiniTile>
      </div>
    </div>
  );
}

function MiniRow({ label, chevron, tall }: { label: string; chevron?: boolean; tall?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border border-cream-50/10 bg-forest-900/40 px-2.5 ${
        tall ? 'py-3' : 'py-2'
      }`}
    >
      <span className="text-[10px] font-medium text-cream-100/70" dangerouslySetInnerHTML={{ __html: label }} />
      {chevron && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-gold-metal" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function MiniTile({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-cream-50/10 bg-forest-900/40 px-1.5 py-2 text-center">
      <span className="grid mx-auto mb-1 h-4 w-4 place-items-center rounded bg-gold-metal/15 text-gold-metal">
        <span className="block h-1.5 w-1.5 rounded-sm bg-gold-metal" />
      </span>
      <span className="text-[9px] font-semibold text-cream-50">{children}</span>
    </div>
  );
}

/** A REAL collapsible styled exactly like SectionPanel: reader can toggle it. */
function CollapsibleDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-xl border transition-colors ${
        open ? 'border-gold-metal/50 bg-forest-900/50' : 'border-cream-50/10 bg-forest-900/30'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-forest-900/40"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-metal/[0.12] text-gold-metal ring-1 ring-gold-metal/25">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 006 0L5 7Zm14 0l-3 6a3 3 0 006 0l-3-6Z"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-cream-50">Case analysis</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-cream-100/55">
            The assembled arguments and the exhibits they marshal.
          </span>
        </span>
        <span className="hidden font-mono text-[11px] tracking-wide text-gold-metal sm:block">
          2 approaches
        </span>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden
          className={`shrink-0 text-gold-metal transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-cream-50/10 p-4 text-[12.5px] leading-relaxed text-cream-100/70">
          <p className="font-semibold text-cream-50">Nicely done.</p>
          <p className="mt-1">
            This is where the section&rsquo;s content appears. Tap the header again
            to collapse it.
          </p>
        </div>
      )}
      {!open && (
        <p className="px-3.5 pb-3 -mt-1 text-[11px] font-medium text-gold-metal">
          ↑ Tap this header to open it
        </p>
      )}
    </div>
  );
}

/** The section navigator, mirroring CounselGuestNav. */
function NavVisual() {
  return (
    <div className="rounded-lg bg-forest-950/70 p-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-cream-100/10 px-3 py-1.5 text-[12px] font-medium text-cream-100 ring-1 ring-gold-metal/40">
          Matter overview
        </span>
        <span className="rounded-md px-3 py-1.5 text-[12px] font-medium text-cream-100/60">
          Timeline
        </span>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-gold-metal">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M11 17l-5-5 5-5M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Always here, tap to come home
      </p>
    </div>
  );
}

/** The three routed-section tiles, mirroring the NavTile grid. */
function TilesVisual() {
  const tiles: { label: string; blurb: string; icon: ReactNode }[] = [
    {
      label: 'Timeline',
      blurb: 'Chronology of events.',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Evidence files',
      blurb: 'Documents & exhibits.',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Export packet',
      blurb: 'Download as PDF.',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-cream-50/10 bg-forest-900/40 p-2.5"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-metal/[0.12] text-gold-metal ring-1 ring-gold-metal/25">
            {t.icon}
          </span>
          <p className="mt-2 text-[11px] font-semibold text-cream-50">{t.label}</p>
          <p className="mt-0.5 text-[10px] leading-snug text-cream-100/50">{t.blurb}</p>
        </div>
      ))}
    </div>
  );
}

function DoneVisual() {
  return (
    <div className="flex flex-col items-center justify-center py-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-gold-metal/15 text-gold-metal ring-1 ring-gold-metal/30">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-3 text-[13px] font-semibold text-cream-50">Ready when you are</p>
    </div>
  );
}
