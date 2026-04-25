'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker (public/sw.js). Mounted once at the
 * layout level. Skipped on localhost dev to avoid stale-cache surprises
 * during development.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Skip in dev: HMR + a service-worker cache layer is a recipe for ghost
    // assets. Production-only is the right scope.
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* a registration failure is never user-facing - swallow */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
  }, []);
  return null;
}
