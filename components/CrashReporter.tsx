'use client';

import { useEffect, useRef } from 'react';

/**
 * Listens for window 'error' and 'unhandledrejection' events and POSTs a
 * crash report to /api/crash. Lives in the root layout so every route is
 * covered. Silent: never shows anything to the user.
 *
 * Defenses:
 * - de-dupe by signature (message + first stack line) within a session
 * - never reports the same exception more than once per minute
 * - never reports errors triggered by ourselves (POST to /api/crash)
 */
export function CrashReporter() {
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function shouldReport(signature: string): boolean {
      const last = seenRef.current.get(signature) ?? 0;
      if (Date.now() - last < 60_000) return false;
      seenRef.current.set(signature, Date.now());
      return true;
    }

    function safeReport(payload: {
      message: string;
      stack: string | null;
      componentStack?: string | null;
    }) {
      const sig = `${payload.message}::${(payload.stack ?? '').split('\n')[0] ?? ''}`;
      if (!shouldReport(sig)) return;

      // Skip our own /api/crash failures so we cannot recurse.
      if (/api\/crash/.test(payload.message)) return;

      try {
        const body = JSON.stringify({
          ...payload,
          url:
            (typeof location !== 'undefined' &&
              location.pathname + (location.search || '')) ||
            null,
        });
        // sendBeacon is fire-and-forget and survives unload events. fetch
        // fallback for browsers that don't support beacon for application/json.
        if (
          'sendBeacon' in navigator &&
          typeof Blob !== 'undefined' &&
          navigator.sendBeacon('/api/crash', new Blob([body], { type: 'application/json' }))
        ) {
          return;
        }
        fetch('/api/crash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {
          /* swallow */
        });
      } catch {
        /* swallow */
      }
    }

    function onError(e: ErrorEvent) {
      safeReport({
        message: e.message || 'window.error',
        stack: e.error instanceof Error ? e.error.stack ?? null : null,
      });
    }

    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'unhandledrejection';
      safeReport({
        message,
        stack: reason instanceof Error ? reason.stack ?? null : null,
      });
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
