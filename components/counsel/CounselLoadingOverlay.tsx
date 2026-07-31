'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Firm/enterprise loading veil. Identical in behaviour to the consumer
 * LoadingOverlay, but hard-locked to the counsel shell's premium near-black,
 * never the cream/green consumer theme.
 *
 * Why a separate component: the overlay portals to document.body so a
 * `transform` ancestor can't pull it off-viewport (see LoadingOverlay). But
 * document.body is OUTSIDE the `.counsel-shell` wrapper, where `--forest-950`
 * is remapped to near-black. Out there `bg-forest-950` resolves to the default
 * GREEN forest, which is exactly the wrong-theme flash firm users saw. So this
 * paints its background from an explicit near-black literal (rgb 8 8 8, the
 * same value the shell remaps to) instead of a shell-scoped Tailwind class.
 */
export function CounselLoadingOverlay({ show, label }: { show: boolean; label?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Safety hatch: never strand the user on an opaque veil (matches
  // LoadingOverlay's 12s force-hide).
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
      className="fixed inset-0 z-[60] flex min-h-screen w-screen items-center justify-center backdrop-blur-sm animate-fade-in pointer-events-auto"
      // Explicit near-black (the shell's remapped --forest-950 = 8 8 8), so the
      // veil is firm-dark even portaled outside .counsel-shell.
      style={{ backgroundColor: 'rgba(8, 8, 8, 0.92)' }}
    >
      <div className="relative flex flex-col items-center justify-center gap-5">
        <span className="loading-mark inline-flex items-center justify-center">
          <Image src="/advottic-mark.png" alt="" width={96} height={96} priority className="select-none" />
        </span>
        {label && (
          <p className="max-w-xs text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-cream-100/85">
            {label}
          </p>
        )}
      </div>
    </div>
  );

  if (!mounted || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
