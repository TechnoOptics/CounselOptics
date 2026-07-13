'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
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

  // Safety hatch: if the overlay has been "show=true" for more than
  // 12 seconds, the caller almost certainly forgot to flip it false
  // (or an OAuth redirect was interrupted, or the user resumed a
  // Capacitor WebView that had the overlay frozen mid-state). Hide
  // ourselves so the user is not stuck on an opaque blank screen.
  // 12s is well past any normal sign-in or form submission, and the
  // worst-case false positive (a genuinely slow request) results in
  // the page underneath becoming interactive again - far better than
  // a forever-loading veil.
  const [forceHide, setForceHide] = useState(false);
  useEffect(() => {
    if (!show) {
      setForceHide(false);
      return;
    }
    const t = setTimeout(() => setForceHide(true), 12_000);
    return () => clearTimeout(t);
  }, [show]);

  if (!show || forceHide) return null;

  const node = (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] min-h-screen w-screen flex items-center justify-center bg-white/92 dark:bg-forest-950/85 backdrop-blur-sm animate-fade-in pointer-events-auto"
    >
      <div className="relative flex flex-col items-center justify-center gap-5">
        {/* Inline SVG mark (not next/image) so the pulsing logo always renders,
            including inside the iOS WebView where the optimized image URL can
            fail and show a broken-image square. */}
        <span className="loading-mark inline-flex items-center justify-center text-gold-500">
          <BrandMark size={96} />
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
 * overlay automatically while the form action is pending.
 *
 * Critical detail: the overlay is rendered SYNCHRONOUSLY from the
 * `pending` flag, NOT via a useEffect-driven `show` state. Reason:
 * a server action that redirects on success can complete in well
 * under one paint cycle (~16 ms) on a fast connection, and a
 * useEffect-based mount needs an extra render to flip its state.
 * If the redirect resolves before that flip lands, the page
 * navigates away before the overlay ever paints and the user sees
 * the click do nothing for ~300 ms (which reads as "broken").
 *
 * We still hold the overlay for MIN_VISIBLE_MS *after* pending goes
 * false so it doesn't flicker on actions that resolve in-place
 * (validation errors, useFormState rejections that don't redirect).
 * That hold runs in an effect because it only matters when the
 * action stays on the same page.
 */
export function FormLoadingOverlay({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  const [holdUntil, setHoldUntil] = useState(0);

  useEffect(() => {
    if (pending) {
      setHoldUntil(Date.now() + MIN_VISIBLE_MS);
      return;
    }
    if (Date.now() < holdUntil) {
      const t = setTimeout(
        () => setHoldUntil(0),
        Math.max(0, holdUntil - Date.now()),
      );
      return () => clearTimeout(t);
    }
  }, [pending, holdUntil]);

  // Render synchronously from `pending`. Never wait for a useEffect
  // round-trip. The `holdUntil` keeps it visible after the action
  // resolves on the same page (no redirect) so it does not flicker.
  const show = pending || (holdUntil > 0 && Date.now() < holdUntil);
  return <LoadingOverlay show={show} label={label} />;
}
