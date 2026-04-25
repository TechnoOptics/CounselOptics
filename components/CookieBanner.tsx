'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'co-cookie-ack';

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const ack = localStorage.getItem(STORAGE_KEY);
      if (!ack) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-forest-900/95 backdrop-blur-md text-cream-200 border-t border-forest-700/40 shadow-card-hover">
      <div className="mx-auto max-w-6xl px-6 py-3.5 flex flex-wrap items-center gap-4 justify-between">
        <p className="text-xs leading-relaxed flex-1 min-w-[260px]">
          Advottic uses essential cookies only - to keep you signed in. No advertising or
          third-party tracking. Read our{' '}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/terms" className="underline">
            Terms
          </Link>
          .
        </p>
        <button
          onClick={dismiss}
          className="text-xs font-semibold tracking-tight bg-cream-200 text-forest-900 hover:bg-cream-100 rounded-md px-3.5 py-2 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
