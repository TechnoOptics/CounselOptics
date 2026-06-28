'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { markTourCompletedAction } from '@/lib/actions';
import { PopupPortal } from './PopupPortal';
import { focusWhenReady } from '@/lib/focus-when-ready';

const STEPS = [
  {
    title: 'Cases organize everything',
    body: 'Each case file holds the parties, jurisdiction, posture, exhibits, and Advottic Review. Click "New case" in the header to start one.',
  },
  {
    title: 'Subject profile',
    body: 'When you create a case you can capture details about the person, business, agency, or entity at the center of it - address, contact info, identifying details, all kept on the case.',
  },
  {
    title: 'Exhibits with metadata',
    body: 'Upload evidence on the case detail page. Each upload becomes an auto-numbered exhibit with category, source, and incident date captured.',
  },
  {
    title: 'Advottic Review (Standard / Pro)',
    body: 'A thorough review that highlights possible issues, evidence gaps, and questions worth asking your attorney.',
  },
  {
    title: 'Collaborators (Pro)',
    body: 'Invite your attorney by email - they can read the case and add exhibits, but cannot modify the matter.',
  },
];

const SWIPE_THRESHOLD_PX = 50;

export function TourModal({ visible }: { visible: boolean }) {
  const [open, setOpen] = useState(visible);
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [direction, setDirection] = useState<'forward' | 'back' | null>(null);
  // touchStart captures the initial X so we can compute the swipe delta
  // on touchend. Using a ref so the value doesn't trigger re-renders.
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  // The dialog is re-keyed per step (slide animation), so it remounts
  // on every Next/Back. Re-focus it each time so keyboard/screen-reader
  // focus stays inside the modal and the card is the visual focal point
  // (the user explicitly wants focus set here, centered).
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Keyboard nav: left/right arrows + Esc to close. Listener owns the
  // entire window so users can drive the tour from a Bluetooth keyboard
  // on tablets / external monitors / accessibility setups.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
        setDirection('forward');
      } else if (e.key === 'ArrowLeft') {
        setStep((s) => Math.max(0, s - 1));
        setDirection('back');
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Set focus into the dialog when it opens and on every step change
  // (the card remounts per step via key={step}, which would otherwise
  // drop focus to <body>).
  useEffect(() => {
    if (open) focusWhenReady(dialogRef);
  }, [open, step]);

  if (!open) return null;

  function dismiss(opts: { saveCompleted?: boolean } = {}) {
    setOpen(false);
    if (opts.saveCompleted) {
      startTransition(async () => {
        try {
          await markTourCompletedAction();
        } catch {
          /* ignore */
        }
      });
    }
  }

  function goNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      setDirection('forward');
    }
  }

  function goBack() {
    if (step > 0) {
      setStep((s) => s - 1);
      setDirection('back');
    }
  }

  /**
   * Touch handlers for swipe-to-advance. Captures the start X/Y on
   * touchstart, then on touchend compares the horizontal delta against
   * the vertical delta - if the swipe is mostly horizontal AND past the
   * threshold, treat it as left/right navigation. Vertical-leaning
   * swipes are scrolls and ignored.
   */
  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(dy) > Math.abs(dx)) return; // ignore vertical-dominant swipes
    if (dx < 0) goNext();
    else goBack();
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <PopupPortal>
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-forest-950/40 backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome tour"
        aria-roledescription="walkthrough"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`relative w-full max-w-md bg-white dark:bg-forest-900 rounded-2xl shadow-card-hover overflow-hidden touch-pan-y select-none focus:outline-none ${
          direction === 'forward' ? 'animate-card-forward' : direction === 'back' ? 'animate-card-back' : ''
        }`}
        // Re-key on step so the slide animation re-fires cleanly when the
        // user swipes through several cards in a row. Without this, only
        // the first transition plays.
        key={step}
      >
        <div className="brand-mark px-5 sm:px-6 py-4 sm:py-5 text-cream-100">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold-400 font-semibold">
            Quick tour · Step {step + 1} of {STEPS.length}
          </p>
          <h2 className="text-base sm:text-lg font-semibold tracking-tight mt-1">{current.title}</h2>
        </div>
        <div className="px-5 sm:px-6 py-4 sm:py-5 pb-8">
          <p className="text-sm text-ink-700 dark:text-cream-100/85 leading-relaxed">{current.body}</p>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/70 mt-3 sm:hidden">
            Swipe left or right to move between steps
          </p>
          <div className="flex items-center justify-between mt-5 gap-2">
            <button
              type="button"
              onClick={() => dismiss({ saveCompleted: true })}
              className="text-xs text-ink-500 hover:text-ink-900 dark:text-cream-100/55 dark:hover:text-cream-100 underline"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="btn-secondary"
                  aria-label="Previous step"
                >
                  Back
                </button>
              )}
              {!isLast ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="btn-primary"
                  aria-label="Next step"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => dismiss({ saveCompleted: true })}
                  disabled={pending}
                  className="btn-primary"
                >
                  {pending ? 'Saving...' : 'Got it'}
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Progress dots. On mobile we keep them inside the safe-area
            with a bit more margin so the home-bar gesture doesn't eat
            them. Desktop sits absolute against the card border. */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pb-[var(--safe-bottom)]">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setDirection(i > step ? 'forward' : 'back');
                setStep(i);
              }}
              aria-label={`Jump to step ${i + 1}`}
              className={`h-1 rounded-full transition-all ${
                i === step ? 'w-6 bg-forest-900' : 'w-1.5 bg-ink-300 hover:bg-ink-400'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
    </PopupPortal>
  );
}
