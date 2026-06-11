'use client';

import { useEffect, useRef } from 'react';

/**
 * Mobile-first modal shell. Replaces the ad-hoc `fixed inset-0`
 * pattern scattered across components with a single, well-behaved
 * dialog.
 *
 * What this gets right that homemade modals miss:
 *
 *   1. Body-scroll lock. Pages behind the modal can't be
 *      accidentally scrolled by touch on mobile.
 *
 *   2. Anchored to the visual viewport, not the document. Uses
 *      `100dvh` (dynamic viewport height) plus the visualViewport
 *      API on iOS / Android to track the keyboard and re-center
 *      the modal as it opens. No more "modal is below the
 *      keyboard, user has to scroll" bug.
 *
 *   3. Auto-focuses the dialog on mount so screen readers + the
 *      ESC key both work, without requiring callers to manage a
 *      ref.
 *
 *   4. Scroll-on-overflow. When the dialog content is taller than
 *      the viewport, the dialog itself scrolls (not the page), so
 *      a small phone never sees a clipped modal.
 *
 *   5. Backdrop-only close. Clicking inside the panel never
 *      bubbles to close - we already had this in TopUpModal but
 *      formalize it here so every consumer gets it free.
 *
 * Usage:
 *   <Dialog onClose={...} ariaLabel="Top up tokens">
 *     <header>...</header>
 *     <div>...content...</div>
 *     <footer>...</footer>
 *   </Dialog>
 */
export function Dialog({
  onClose,
  ariaLabel,
  children,
  /** Tighter max-width for narrow forms; defaults to 2xl. */
  size = 'md',
}: {
  onClose: () => void;
  ariaLabel?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Body scroll lock + ESC handler + focus trap entry. Runs once
  // on mount, undoes on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    // Compensate for the disappearing scrollbar so content doesn't
    // shift on desktop.
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);

    // Focus the panel so ARIA + ESC both work. requestAnimationFrame
    // gives the DOM one tick to paint the dialog before we focus it.
    const raf = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [onClose]);

  // visualViewport tracking. iOS keyboards push the layout viewport
  // up but leave the document height the same; without this the
  // dialog can land BEHIND the keyboard and the user has to scroll
  // an invisible viewport to see it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (containerRef.current) {
        containerRef.current.style.height = `${vv.height}px`;
        containerRef.current.style.transform = `translateY(${vv.offsetTop}px)`;
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const maxW = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-2xl';

  return (
    <div
      ref={containerRef}
      role="presentation"
      // Backdrop. fixed + 100dvh so the overlay always covers the
      // visible viewport, even when the page is scrolled. The
      // visualViewport effect overrides this height when an on-screen
      // keyboard appears.
      className="fixed inset-x-0 top-0 z-[60] bg-forest-950/70 backdrop-blur overflow-y-auto"
      style={{ height: '100dvh' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Inner flex centering. min-h-full lets the panel grow taller
          than the viewport when its content is long; py-4 + safe-area
          insets keep the panel away from device edges + dynamic island
          / camera cutouts. */}
      <div
        className="min-h-full flex items-center justify-center px-4 py-4"
        style={{
          paddingTop: 'max(1rem, var(--safe-top))',
          paddingBottom: 'max(1rem, var(--safe-bottom))',
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={`w-full ${maxW} rounded-2xl bg-white dark:bg-forest-900 ring-1 ring-white/10 shadow-2xl outline-none focus:outline-none`}
          // Stop click-through to backdrop so panel content doesn't close.
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
