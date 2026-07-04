'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setActiveFirmAction } from '@/lib/firm-actions';
import type { Firm, FirmMember } from '@/lib/firm-types';

/**
 * Tiny dropdown that lets a user with multiple firm memberships swap
 * which one is active. Backed by setActiveFirmAction which writes
 * `profiles.active_firm_id` server-side and revalidates.
 */
export function CounselFirmSwitcher({
  activeFirmId,
  memberships,
}: {
  activeFirmId: string | null;
  memberships: Array<{ firm: Firm; membership: FirmMember }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const active = memberships.find((m) => m.firm.id === activeFirmId);

  // Close on Escape (keyboard a11y for the popup).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function pick(firmId: string) {
    setOpen(false);
    startTransition(async () => {
      const res = await setActiveFirmAction(firmId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-700 dark:text-cream-100/85 hover:text-forest-900 dark:hover:text-cream-100 px-2.5 py-1.5 rounded-md hover:bg-ink-50 dark:hover:bg-forest-800/60 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-medium truncate max-w-[14ch]">
          {active ? active.firm.name : 'Switch firm'}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
        <ul
          role="listbox"
          className="absolute right-0 mt-1 w-56 rounded-lg bg-white dark:bg-forest-900 border border-ink-200 dark:border-forest-700/60 shadow-card-hover overflow-hidden z-40"
        >
          {memberships.map((m) => (
            <li key={m.firm.id}>
              <button
                type="button"
                onClick={() => pick(m.firm.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-cream-50 dark:hover:bg-forest-800/70 flex items-center gap-2 ${
                  m.firm.id === activeFirmId
                    ? 'bg-cream-50 dark:bg-forest-800/40 font-semibold'
                    : ''
                }`}
              >
                <span
                  className="h-5 w-5 rounded-md inline-flex items-center justify-center text-white text-[11px] font-semibold flex-none"
                  style={{ backgroundColor: m.firm.accentColor }}
                  aria-hidden
                >
                  {m.firm.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{m.firm.name}</span>
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
