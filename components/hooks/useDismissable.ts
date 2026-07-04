'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared dismiss behavior for popovers / dropdowns / menus: closes on
 * Escape and on a click outside the returned container ref. Attach the
 * ref to the element that wraps both the trigger and the popup.
 *
 *   const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
 *   return <div ref={ref}>…</div>;
 *
 * Keeps keyboard + outside-click behavior consistent across every menu
 * instead of each one hand-rolling (or forgetting) it. (Audit UI/UX M1.)
 */
export function useDismissable<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onPointer(e: MouseEvent | TouchEvent) {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onClose();
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open, onClose]);
  return ref;
}
