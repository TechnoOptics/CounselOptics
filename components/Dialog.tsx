'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll } from '@/lib/scroll-lock';

/** Focusable descendants of the panel, in tab order. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);
}

/**
 * Which of the opener's classes the portal root re-states.
 *
 * The shell identity (`counsel-shell` / `enterprise-shell`), the `.dark`
 * beside it and `.accent-scope` are what every counsel and enterprise style
 * rule keys off, and the portal has left all three behind in the DOM.
 *
 * `.dark` on <html> is NOT a substitute for any of them, which is the thing
 * to keep hold of. Since lib/counsel-theme-values.ts made <html> follow the
 * shell's theme, the two agree - but <html> wears `surface-counsel`, never
 * `counsel-shell`, and every light repaint in app/globals.css is written
 * `.counsel-shell:not(.dark) .text-cream-100 { ... }`. A selector that names
 * the shell cannot match a subtree that left the shell behind. Measured on
 * current main without this: the counsel customizer still opens at 1.04:1 in
 * light, and its panel is still consumer forest green rather than the firm's
 * neutral black in dark.
 *
 * Exported for tests/dialog-shell-scope.test.ts, which is the only way to
 * hold this still: vitest runs in environment: 'node' with no DOM.
 */
export function carriedShellClasses(hostClasses: readonly string[]): string {
  const host = new Set(hostClasses);
  return ['counsel-shell', 'enterprise-shell', 'accent-scope', 'dark'].filter(
    (c) => host.has(c),
  ).join(' ');
}

/**
 * Mobile-first modal shell. Replaces the ad-hoc `fixed inset-0`
 * pattern scattered across components with a single, well-behaved
 * dialog.
 *
 * What this gets right that homemade modals miss:
 *
 *   1. Page-scroll lock. Pages behind the modal can't be
 *      accidentally scrolled by touch on mobile. Locks the root
 *      element too, which this app requires - lib/scroll-lock.ts.
 *
 *   2. Anchored to the visual viewport, not the document. Uses
 *      `100dvh` (dynamic viewport height) plus the visualViewport
 *      API on iOS / Android to track the keyboard and re-center
 *      the modal as it opens. No more "modal is below the
 *      keyboard, user has to scroll" bug.
 *
 *   3. Auto-focuses the dialog once it is in the DOM, keeps Tab
 *      inside it while it is open, and hands focus back to whatever
 *      opened it on close - so screen readers and the ESC key both
 *      work without callers managing a ref.
 *
 *   4. Scroll-on-overflow. When the dialog content is taller than
 *      the viewport, the dialog itself scrolls (not the page), so
 *      a small phone never sees a clipped modal.
 *
 *   5. Backdrop close. A click outside the panel closes; a click
 *      inside it never does.
 *
 *   6. Theme scope. The portal root re-states the shell classes of
 *      whatever opened the dialog, because portaling to <body> leaves
 *      the counsel / enterprise shell behind - carriedShellClasses.
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
  /** Stack above full-screen viewers (evidence viewer z-100, document preview
   *  z-70). Default dialogs sit at z-60. */
  elevated = false,
}: {
  onClose: () => void;
  ariaLabel?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  elevated?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Body scroll lock + ESC + tab containment. Runs once on mount,
  // undoes on unmount.
  useEffect(() => {
    // Locks <html> as well as <body>, which is load-bearing here - see
    // lib/scroll-lock.ts. It also handles scrollbar-width compensation.
    const unlockScroll = lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // `aria-modal="true"` promises the rest of the document is inert.
      // Without this, Tab walked straight out of the panel into the page
      // behind it, which for a keyboard or screen-reader user means
      // operating a page they cannot see under an open modal.
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = panel.contains(active);
      if (e.shiftKey && (!inside || active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
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

  // Portal to <body> after mount: several pages wrap their content in a
  // transformed route-fade container, and a transform ancestor turns `fixed`
  // into "fixed to the content", so the modal then renders mid-page instead of
  // over the viewport. Portaling makes every dialog immune.
  const [mounted, setMounted] = useState(false);

  // THE PORTAL LEAVES THE SHELL BEHIND, and the shell is where the theme
  // lives. `.counsel-shell` / `.enterprise-shell` sit on a div inside the
  // route layout; <html> wears `surface-counsel` and `.dark`, and neither of
  // those is what the light repaint layer names. Every one of its rules is
  // written `.counsel-shell:not(.dark) .text-cream-100 { ... }`, so a subtree
  // that left the shell gets none of them. Measured on the customizer, on
  // main, with <html> already agreeing with the shell: 49 of 51 text runs
  // between 1.04:1 and 1.07:1 in light, and in dark a panel painted consumer
  // forest GREEN instead of the firm's neutral black, because `--forest-*` is
  // remapped by the shell too.
  //
  // So the portal root re-states its opener's context: the shell identity,
  // the `.dark` beside it, `.accent-scope`, and the two inline custom
  // properties that carry the firm's accent. The classes alone are not
  // enough - `--firm-accent` is an inline style on one element per page,
  // and a derivation that cannot see it silently hands every firm Advottic
  // gold (see the `.accent-scope` note in app/globals.css).
  //
  // Read from an anchor rendered IN PLACE, because by the time the portal
  // exists there is nothing left in the tree to ask.
  const [shellClass, setShellClass] = useState('');
  const [shellVars, setShellVars] = useState<React.CSSProperties>({});
  useEffect(() => {
    const host = anchorRef.current?.closest<HTMLElement>(
      '.counsel-shell, .enterprise-shell',
    );
    if (host) {
      setShellClass(carriedShellClasses(Array.from(host.classList)));
      const computed = getComputedStyle(host);
      const vars: Record<string, string> = {};
      for (const prop of ['--firm-accent', '--accent-on']) {
        const value = computed.getPropertyValue(prop).trim();
        if (value) vars[prop] = value;
      }
      setShellVars(vars as React.CSSProperties);
    }
    setMounted(true);
  }, []);

  // Focus entry, after the portal exists. This used to run on the FIRST
  // render, which is the pre-portal one: it focused a node that the very
  // next commit destroyed, so focus fell back to <body> and never entered
  // the dialog at all. Measured with a focusin/focusout trace.
  useEffect(() => {
    if (!mounted) return;
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  // Hand focus back to whatever opened the dialog. Without this a keyboard
  // user is dropped at the top of the document on every close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const maxW = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-2xl';

  const node = (
    <div
      ref={containerRef}
      role="presentation"
      // Backdrop. fixed + 100dvh so the overlay always covers the
      // visible viewport, even when the page is scrolled. The
      // visualViewport effect overrides this height when an on-screen
      // keyboard appears.
      className={`fixed inset-x-0 top-0 ${elevated ? 'z-[120]' : 'z-[60]'} bg-forest-950/70 backdrop-blur overflow-y-auto`}
      style={{ height: '100dvh' }}
      // Close on a click outside the panel. This asked for `e.target ===
      // e.currentTarget`, which the inner centering div below made
      // unreachable: that div is full-bleed, so every click on the "backdrop"
      // landed on IT and the backdrop was never its own target. Measured:
      // clicking beside the panel did nothing, in every dialog in the app,
      // while the comment above said otherwise. Containment is the honest
      // test - the panel's own handler still stops its clicks first.
      onClick={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      {/* The opener's theme scope, re-stated. `display: contents` on
          purpose: this must be an ANCESTOR for the cascade without being a
          BOX. The shell classes carry a page background of their own
          (`.counsel-shell:not(.dark)` paints #f6f6f7 plus a gold wash), so
          on any element that generates a box they would paint over the
          dialog. With no box they paint nothing, while descendant selectors
          and custom properties still reach the panel and its contents.
          It sits INSIDE the backdrop so the veil keeps the colour it has
          always had rather than being repainted by the light shell. */}
      <div className={shellClass} style={{ display: 'contents', ...shellVars }}>
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
    </div>
  );

  // The anchor is what the shell lookup above reads, so it renders in place
  // on every pass, including the pre-portal one.
  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden />
      {mounted && typeof document !== 'undefined'
        ? createPortal(node, document.body)
        : null}
    </>
  );
}
