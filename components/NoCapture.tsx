'use client';

import { useEffect } from 'react';

/**
 * Best-effort capture deterrent.
 *
 * Blocks:
 *   - The right-click context menu (so "Save image as..." is gone).
 *   - Ctrl/Cmd+S, Ctrl/Cmd+P, Ctrl/Cmd+Shift+S (browser save shortcuts).
 *   - F12 + the devtools combos (Ctrl/Cmd+Shift+I / J / C). Determined
 *     users will still open devtools through the browser menu, but the
 *     keyboard reflex stops working.
 *   - Print Screen (the JS handler suppresses the keypress; on Windows
 *     this also clears the clipboard image because the OS captures
 *     before our handler runs but we re-clear afterward).
 *   - Drag-and-drop of any element (images dragged to the desktop are
 *     a common accidental leak).
 *
 * IMPORTANT - these are deterrents, not real protection. There is no
 * web API that can stop an OS-level screenshot, a screen recorder, a
 * second phone pointed at the monitor, or a determined user with
 * devtools. Pair this with the trace watermark on sensitive surfaces
 * so any image that does leak is traceable to a specific account.
 */
export function NoCapture() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      // Allow context menu inside form fields so paste / spellcheck
      // still works for legitimate input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      // `e.key` is normally always a string, but some WebView / hardware
      // keyboard / IME keydown events (seen in the iOS WKWebView) deliver
      // it undefined. Calling .toLowerCase() on that threw an uncaught
      // "Cannot read properties of undefined (reading 'toLowerCase')" -
      // harmless in a handler, but it was the app's most frequent crash
      // report, so guard it.
      if (typeof key !== 'string') return;
      const lower = key.toLowerCase();
      const cmd = e.metaKey || e.ctrlKey;
      // Save / print / Save-as.
      if (cmd && (lower === 's' || lower === 'p')) {
        e.preventDefault();
        return;
      }
      // F12 devtools.
      if (key === 'F12') {
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd+Shift+I/J/C devtools.
      if (cmd && e.shiftKey && (lower === 'i' || lower === 'j' || lower === 'c')) {
        e.preventDefault();
        return;
      }
      // Print Screen. The OS takes the screenshot first, but we can
      // proactively clear the clipboard right after as a small extra
      // friction. Only attempt if the API is available.
      if (key === 'PrintScreen') {
        e.preventDefault();
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          navigator.clipboard.writeText('').catch(() => {
            // No clipboard write permission, nothing to do.
          });
        }
        return;
      }
    };

    const onDragStart = (e: DragEvent) => {
      // Disable drag for everything by default. Form-field text drags
      // are rare and not worth a special case.
      e.preventDefault();
    };

    const onCopy = (e: ClipboardEvent) => {
      // Allow copy from form fields, block elsewhere.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // Append a watermark sentence so pasted text comes with attribution.
      const sel = window.getSelection()?.toString() ?? '';
      if (!sel) return;
      e.preventDefault();
      const stamp = `\n\nCopied from Advottic at ${new Date().toISOString()}`;
      e.clipboardData?.setData('text/plain', sel + stamp);
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('copy', onCopy);
    };
  }, []);

  return null;
}
