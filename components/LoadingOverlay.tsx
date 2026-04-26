'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

const MIN_VISIBLE_MS = 3000;

/**
 * Full-screen loading veil. The Advottic gold mark sits dead-center of
 * the viewport regardless of screen size (uses `fixed inset-0` which
 * pins to the viewport, not to body padding or safe-area insets), with
 * a soft aurora pulse. Renders nothing when `show` is false. Z-index
 * sits above the Bella launcher (z-30) and the consent modal (z-40)
 * but below toasts. The icon stays vertically and horizontally
 * centered via the inner flex column - true center on every breakpoint.
 */
export function LoadingOverlay({ show, label }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      // `fixed inset-0` covers the viewport. `flex items-center
      // justify-center` centers the inner column. `min-h-screen w-screen`
      // is belt + suspenders for older mobile browsers that mishandle
      // `inset-0` when the URL bar resizes the visual viewport.
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
