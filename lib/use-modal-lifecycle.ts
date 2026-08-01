'use client';

import { useEffect, type RefObject } from 'react';
import { focusWhenReady } from '@/lib/focus-when-ready';
import { lockScroll } from '@/lib/scroll-lock';

/**
 * Lightweight modal-lifecycle hook for components that don't want
 * the full Dialog wrapper (eg. ConsentModal, CookieBanner,
 * BiometricEnrollPrompt all have custom backdrops + click-out
 * rules). Pull this hook in to get:
 *
 *   - Page scroll lock while open (root element included)
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
    // Locks <html> as well as <body> - see lib/scroll-lock.ts for why a
    // body-only lock silently does nothing in this app. Also handles
    // scrollbar-width compensation.
    const unlockScroll = lockScroll();

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
      unlockScroll();
      if (listener) window.removeEventListener('keydown', listener);
    };
  }, [enabled, onClose, focusRef]);
}
