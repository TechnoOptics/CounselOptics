'use client';

import { useEffect, useRef } from 'react';

/**
 * Keep a multi-step card visually anchored when its content
 * changes. Callers attach the returned ref to the card root
 * (the element whose top should land at a consistent viewport
 * position on every step change).
 *
 * Behavior on each step transition:
 *
 *   - If the card top is already inside the viewport, do nothing.
 *     The user is looking at it already - we don't yank.
 *
 *   - If the card top has scrolled off the top of the viewport,
 *     scroll the card so its top lands ~64 px below the visible
 *     header (instant, not animated, to avoid the "wait, where
 *     did I go" sensation).
 *
 *   - If the card is below the viewport (ie the new card is
 *     taller and pushed itself down on a re-layout), bring it
 *     into view at the top.
 *
 * The contract: the parent re-renders the same DOM root with
 * different children when `step` changes. We don't unmount /
 * remount; React preserves the ref across step changes, so
 * scroll math is stable.
 *
 * Usage:
 *   const cardRef = useStepAnchor(step);
 *   return <section ref={cardRef} className="card scroll-mt-20">
 *     {step === 'a' ? <A/> : <B/>}
 *   </section>;
 */
export function useStepAnchor<T extends HTMLElement = HTMLElement>(
  step: unknown,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    // Wait one paint so the new step content has its layout.
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      // Anchor offset: ~64px to clear our sticky header.
      const targetTop = 64;
      const scrolledAbove = rect.top < 0;
      const scrolledBelow = rect.top > window.innerHeight - 80;
      const farFromAnchor = Math.abs(rect.top - targetTop) > 240;

      // Re-anchor only when the card is materially off where it
      // should be. Avoids scroll thrash during minor reflows.
      if (scrolledAbove || scrolledBelow || farFromAnchor) {
        const absoluteTarget =
          window.scrollY + rect.top - targetTop;
        window.scrollTo({
          top: Math.max(0, absoluteTarget),
          behavior: 'instant' as ScrollBehavior,
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [step]);

  return ref;
}
