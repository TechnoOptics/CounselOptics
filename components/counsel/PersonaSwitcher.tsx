'use client';

import { useEffect, useState, useTransition } from 'react';
import { enterPortalPreviewAction } from '@/lib/firm-actions';

/**
 * Owner/admin-only "view as" switcher.
 *
 * Lets a firm owner/admin drop into the exact experience their people
 * see, without a second account:
 *   - Legal team    : the real Counsel workspace they're already in.
 *   - Employee      : the in-house Hub (/portal) for staff.
 *   - External vendor: the outside-collaborator view of the Hub.
 *
 * Both previews reuse the existing portal-preview cookie machinery
 * (lib/persona.ts): they never touch another person's data - the
 * portal still scopes every query to the signed-in user - and they
 * can't escalate, since preview is only honoured for a firm the caller
 * actually owns/admins. A gold "Previewing as ..." banner + "Exit
 * preview" live in the portal shell (app/portal/layout.tsx).
 *
 * Only rendered for owner/admin, so this is never an access-control
 * surface for regular staff.
 */
export function PersonaSwitcher({ firmId }: { firmId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Close the menu on Escape (keyboard a11y for the popup).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function preview(mode: 'employee' | 'vendor') {
    setOpen(false);
    startTransition(async () => {
      // Server action redirects into /portal.
      await enterPortalPreviewAction(firmId, '', mode);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 min-h-[36px] text-[12.5px] text-cream-100/80 hover:text-cream-100 px-2.5 py-1.5 rounded-md hover:bg-cream-100/5 ring-1 ring-cream-100/10 transition-colors disabled:opacity-60"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Preview what your employees and vendors see"
      >
        <EyeIcon />
        <span className="hidden sm:inline font-medium">View as</span>
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
          {/* click-away scrim */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 mt-1 w-64 rounded-lg bg-forest-900 border border-forest-700/60 shadow-card-hover overflow-hidden z-40"
          >
            <p className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.18em] text-cream-100/60">
              Preview as
            </p>
            <div className="px-2 py-1 text-[12px] text-cream-100/85">
              <span className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-cream-100/5">
                <DotIcon />
                <span>
                  <span className="font-semibold text-cream-100">
                    Legal team
                  </span>
                  <span className="block text-[11px] text-cream-100/60">
                    You&rsquo;re here now
                  </span>
                </span>
              </span>
            </div>
            <div className="border-t border-forest-700/40 my-1" />
            <button
              type="button"
              role="menuitem"
              onClick={() => preview('employee')}
              disabled={pending}
              className="w-full text-left px-4 py-2.5 text-[12.5px] hover:bg-cream-100/5 flex items-start gap-2.5 disabled:opacity-60"
            >
              <BadgeIcon />
              <span>
                <span className="font-semibold text-cream-100 block">
                  Employee
                </span>
                <span className="block text-[11px] text-cream-100/50 leading-snug">
                  The in-house Hub your staff use.
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => preview('vendor')}
              disabled={pending}
              className="w-full text-left px-4 py-2.5 text-[12.5px] hover:bg-cream-100/5 flex items-start gap-2.5 disabled:opacity-60"
            >
              <GlobeIcon />
              <span>
                <span className="font-semibold text-cream-100 block">
                  External vendor
                </span>
                <span className="block text-[11px] text-cream-100/50 leading-snug">
                  What an outside collaborator sees.
                </span>
              </span>
            </button>
            <p className="px-4 py-2 text-[10.5px] text-cream-100/35 border-t border-forest-700/40 leading-snug">
              A safe preview. Exit any time from the banner.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'flex-none mt-0.5 text-gold-300',
};

function EyeIcon() {
  return (
    <svg {...ICON} className="flex-none text-gold-300">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function BadgeIcon() {
  return (
    <svg {...ICON}>
      <rect x="4" y="7" width="16" height="13" rx="2" />
      <path d="M9 7V5a3 3 0 016 0v2" />
      <path d="M12 12v4" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg {...ICON} className="flex-none mt-0.5 text-emerald-400">
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}
