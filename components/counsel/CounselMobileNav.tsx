'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Firm } from '@/lib/firm-types';
import type { MenuSection } from '@/lib/menu-config';
import { isCounselItemActive, tenantHref } from '@/lib/counsel-routing';

/**
 * Mobile navigation for the Counsel workspace.
 *
 * The Counsel sidebar is `hidden md:block`, and the header carries no
 * nav links, so below 768px the entire Counsel IA (Cases, Clients,
 * Trust, Signing, ...) was unreachable except by typing URLs - a
 * dead-end on the app's primary (Capacitor phone) platform. This is the
 * `md:hidden` counterpart: a hamburger that opens a slide-over drawer
 * listing the same firm-customized menu the sidebar renders. Mirrors
 * the pattern the Portal shell already uses.
 */
export function CounselMobileNav({
  firm,
  sections,
  tenantMode = false,
  canSettings = false,
}: {
  firm: Firm;
  sections: MenuSection[];
  tenantMode?: boolean;
  canSettings?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '';

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-cream-100/85 hover:bg-cream-100/10 ring-1 ring-cream-100/10"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-forest-950/70 backdrop-blur-sm"
          />
          <nav
            className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-forest-950 border-r border-forest-700/50 shadow-2xl overflow-y-auto pt-[var(--safe-top)] pb-[calc(var(--safe-bottom)+16px)]"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-forest-700/40">
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cream-100/70 truncate">
                {firm.name}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-cream-100/70 hover:bg-cream-100/10"
                aria-label="Close menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="px-2 py-3 space-y-1">
              {sections.map((sec) => (
                <div key={sec.section} className="pb-1">
                  <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[0.16em] font-semibold text-cream-100/60">
                    {sec.section}
                  </p>
                  {sec.items.map((item) => {
                    const active = isCounselItemActive(item.href, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={tenantHref(item.href, tenantMode)}
                        prefetch={false}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] rounded-md text-sm ${
                          active
                            ? 'bg-cream-100/10 text-cream-100 font-semibold ring-1 ring-cream-100/15'
                            : 'text-cream-100/85 hover:bg-cream-100/5'
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full flex-none"
                          style={{ backgroundColor: firm.accentColor, opacity: active ? 1 : 0.6 }}
                          aria-hidden
                        />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
              {canSettings && (
                <div className="pt-2 mt-2 border-t border-forest-700/40">
                  <Link
                    href={tenantHref('/counsel/settings', tenantMode)}
                    prefetch={false}
                    onClick={() => setOpen(false)}
                    aria-current={
                      isCounselItemActive('/counsel/settings', pathname) ? 'page' : undefined
                    }
                    className="flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] rounded-md text-sm text-cream-100/85 hover:bg-cream-100/5"
                  >
                    <span
                      className="h-2 w-2 rounded-full flex-none"
                      style={{ backgroundColor: firm.accentColor, opacity: 0.6 }}
                      aria-hidden
                    />
                    Firm settings
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
