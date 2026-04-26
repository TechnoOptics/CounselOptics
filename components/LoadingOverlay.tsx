'use client';

import Image from 'next/image';
import { useFormStatus } from 'react-dom';

/**
 * Full-screen loading veil. The Advottic gold mark pulses with a soft
 * gold aurora; the rest of the page dims behind a translucent forest
 * scrim. Renders nothing when `show` is false. Z-index sits above the
 * Bella launcher (z-30) and the consent modal (z-40) but below toasts.
 */
export function LoadingOverlay({ show, label }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-white/92 dark:bg-forest-950/85 backdrop-blur-sm animate-fade-in pointer-events-auto"
    >
      <div className="relative flex flex-col items-center gap-5">
        <span className="loading-mark inline-flex items-center justify-center">
          <Image
            src="/advottic-mark.png"
            alt=""
            width={96}
            height={96}
            priority
            className="select-none"
          />
        </span>
        {label && (
          <p className="text-[11px] uppercase tracking-[0.3em] font-semibold text-forest-900 dark:text-cream-100/85">
            {label}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Wired version: drops in inside any <form action={...}> and toggles the
 * overlay automatically while the form action is pending. Use alongside
 * a regular submit button.
 */
export function FormLoadingOverlay({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  return <LoadingOverlay show={pending} label={label} />;
}
