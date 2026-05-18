'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children as a direct child of <body> via a portal.
 *
 * Why this exists: a `position: fixed` overlay is positioned relative
 * to the nearest ancestor that has a `transform` / `filter` /
 * `perspective` (or `contain: paint/layout`), NOT the viewport. The
 * app wraps page content in `.route-fade` and `.animate-fade-up`,
 * both of which set a `transform` - so a pop-up rendered inside a
 * page (PermissionsPrimer, the tour, etc.) had its `fixed inset-0`
 * overlay sized/offset to that scrolled wrapper instead of the
 * screen, and `items-center` couldn't truly center it.
 *
 * Portaling to <body> escapes every transformed ancestor, so
 * `fixed inset-0 flex items-center justify-center` is finally
 * viewport-true everywhere. The mount guard keeps SSR / first paint
 * safe (no `document` on the server, no hydration mismatch).
 */
export function PopupPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
