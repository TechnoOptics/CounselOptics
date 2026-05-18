'use client';

import { useEffect, type RefObject } from 'react';
import { focusWhenReady } from '@/lib/focus-when-ready';

/**
 * Lightweight modal-lifecycle hook for components that don't want
 * the full Dialog wrapper (eg. ConsentModal, CookieBanner,
 * BiometricEnrollPrompt all have custom backdrops + click-out
 * rules). Pull this hook in to get:
 *
 *   - Body scroll lock while open
 *   - ESC handler that calls onClose
 *   - Scrollbar-width compensation so the page doesn't shift
 *   - Moves focus onto the panel (pass `focusRef`) so keyboard /
 *     screen-reader focus AND visual attention land on the pop-up,
 *     not the page behind the dimmed backdrop
 *
 * Pass `enabled=false` to short-circuit (eg. while the modal is
 * mounted but in a closed state).
 */
export function useModalLifecycle({
  enabled = true,
  onClose,
  focusRef,
}: {
  enabled?: boolean;
  onClose?: () => void;
  focusRef?: RefObject<HTMLElement | null>;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    // Focus the panel after it has painted/animated in (rAF), so the
    // pop-up is the focal point. tabIndex={-1} on the panel makes it
    // programmatically focusable without entering the tab order.
    if (focusRef) {
      // Retry across frames: the panel renders through a portal whose
      // mount-guard delays it a render, so it may not exist yet.
      focusWhenReady(focusRef);
    }

    let listener: ((e: KeyboardEvent) => void) | null = null;
    if (onClose) {
      listener = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', listener);
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      if (listener) window.removeEventListener('keydown', listener);
    };
  }, [enabled, onClose, focusRef]);
}
