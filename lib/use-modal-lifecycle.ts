'use client';

import { useEffect } from 'react';

/**
 * Lightweight modal-lifecycle hook for components that don't want
 * the full Dialog wrapper (eg. ConsentModal, CookieBanner,
 * BiometricEnrollPrompt all have custom backdrops + click-out
 * rules). Pull this hook in to get:
 *
 *   - Body scroll lock while open
 *   - ESC handler that calls onClose
 *   - Scrollbar-width compensation so the page doesn't shift
 *
 * Pass `enabled=false` to short-circuit (eg. while the modal is
 * mounted but in a closed state).
 */
export function useModalLifecycle({
  enabled = true,
  onClose,
}: {
  enabled?: boolean;
  onClose?: () => void;
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
  }, [enabled, onClose]);
}
