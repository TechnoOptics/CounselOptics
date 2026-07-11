'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The stripped account menu for a case-scoped Counsel GUEST. Deliberately
 * minimal: a guest can change nothing about the platform or a firm, so the
 * dropdown offers ONLY "Profile settings" (their own account) and "Sign out".
 * No firm switcher, no persona preview, no admin, no token balance.
 */
export function CounselGuestMenu({
  displayName,
  email,
  initials,
}: {
  displayName: string;
  email: string;
  initials: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-9 rounded-full bg-forest-800 text-cream-100 text-xs font-semibold inline-flex items-center justify-center ring-1 ring-cream-100/15 hover:ring-cream-100/30 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl bg-forest-950 ring-1 ring-cream-100/10 shadow-xl p-2 z-40"
        >
          <div className="px-3 py-2 border-b border-cream-100/10 mb-1">
            <p className="text-sm font-semibold text-cream-100 truncate" data-no-translate>
              {displayName}
            </p>
            <p className="text-[11px] text-cream-100/55 truncate" data-no-translate>
              {email}
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-gold-300 mt-1">
              <T>Guest access</T>
            </p>
          </div>
          <Link
            href="/counsel/guest/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-cream-100/85 hover:bg-forest-800/60"
          >
            <T>Profile settings</T>
          </Link>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              role="menuitem"
              className="w-full text-left rounded-lg px-3 py-2 text-sm text-cream-100/85 hover:bg-forest-800/60"
            >
              <T>Sign out</T>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
