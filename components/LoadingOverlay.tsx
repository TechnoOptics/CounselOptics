'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFormStatus } from 'react-dom';

const MIN_VISIBLE_MS = 3000;

/**
 * Full-screen loading veil. The Advottic gold mark sits dead-center of
 * the viewport regardless of screen size.
 *
 * Implementation note: we render through createPortal directly to
 * document.body. Without the portal, the overlay would mount inside
 * whichever React tree placed it - which on Next App Router routes
 * is inside `app/template.tsx`'s `route-fade` wrapper. That wrapper
 * applies a CSS transform during the page-fade animation, and any
 * non-`none` `transform` creates a containing block for descendant
 * `position: fixed` elements. Result: `fixed inset-0` would pin to
 * the route wrapper (the main content area) instead of the viewport,
 * and the icon would land off-center inside that subtree. Portaling
 * to body sidesteps the containing-block trap entirely.
 */
export function LoadingOverlay({ show, label }: { show: boolean; label?: string }) {
  // Portals only work after hydration on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!show) return null;

  const node = (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] min-h-screen w-screen flex items-center justify-center bg-white/92 dark:bg-forest-950/85 backdrop-blur-sm animate-fade-in pointer-events-auto"
    >
      <div className="relative flex flex-col items-center justify-center gap-5">
        <span className="loading-mark inline-flex items-center justify-center">
          <Image
            src="/advottic-mark.png"
            alt=""
            width={96}
            height={96}
            priority
            className="select-none"
          />
        </span>
        {label && (
          <p className="text-[11px] uppercase tracking-[0.3em] font-semibold text-forest-900 dark:text-cream-100/85 text-center max-w-xs">
            {label}
          </p>
        )}
      </div>
    </div>
  );

  // Pre-hydration: render in place. Post-hydration: portal to body
  // so transform ancestors do not pull the overlay off-viewport.
  if (!mounted || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

/**
 * Wired version: drops in inside any <form action={...}> and toggles the
 * overlay automatically while the form action is pending. Enforces a
 * 1-second minimum visible duration so the veil reads as a deliberate
 * transition rather than a flicker, and so the destination page has a
 * moment to start its own first paint before the veil clears.
 */
export function FormLoadingOverlay({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  const [show, setShow] = useState(false);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (pending) {
      setShow(true);
      startedAtRef.current = Date.now();
      return;
    }
    if (!show) return;
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (remaining === 0) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(false), remaining);
    return () => clearTimeout(t);
  }, [pending, show]);

  return <LoadingOverlay show={show} label={label} />;
}
