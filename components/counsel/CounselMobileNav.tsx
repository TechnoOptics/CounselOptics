'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Firm } from '@/lib/firm-types';
import { lockScroll } from '@/lib/scroll-lock';
import type { MenuSection } from '@/lib/menu-config';
import { isCounselItemActive, tenantHref } from '@/lib/counsel-routing';
import { useT } from '@/components/i18n/LocaleProvider';

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
 *
 * The drawer is PORTALLED to document.body, and that is load-bearing.
 * CounselHeader renders this component inside a `backdrop-blur-md`
 * bar, and an element with a backdrop-filter becomes the containing
 * block for its position:fixed descendants. Rendered in place, the
 * drawer's `fixed inset-0` resolved against the header instead of the
 * viewport: the panel collapsed to the height of the header bar
 * (~145px), every nav row landed outside the visible box, and the
 * scrim could not dim the page behind it. On a phone that left the
 * whole workspace unnavigable. The portal keeps the header's intended
 * blur and puts the dialog back on the viewport where it belongs.
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
  const t = useT();
  const [open, setOpen] = useState(false);
  // Portals need a document, so nothing renders until after hydration.
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname() ?? '';
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<Element | null>(null);

  useEffect(() => setMounted(true), []);

  // Browser back/forward does not remount this component, so without it the
  // drawer stayed open over the page the user just navigated to.
  useEffect(() => setOpen(false), [pathname]);

  // Close on Escape, keep Tab inside the dialog, and lock body scroll
  // while it is open. Focus moves into the panel on open and returns to
  // the hamburger on close, so a keyboard or screen-reader user is never
  // left behind the scrim.
  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement;
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    // Land on the close button rather than the first nav row, so the way
    // out is the first thing announced.
    focusables()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        // `!inside` covers focus sitting on the scrim button, which is in the
        // dialog but outside the panel: without it, Tab escaped to browser UI.
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);

    // Crossing 768px with the drawer open would hide it (`md:hidden`) while
    // `open` stayed true, so this effect never cleaned up and the scroll lock
    // stayed on a page with no visible control to release it. Rotating a
    // phone into landscape was enough to freeze it until a reload.
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    onWide();
    wide.addEventListener('change', onWide);
    // Lock the page behind the drawer. `document.body` alone is not enough
    // here: globals.css puts `overflow-x: clip` on <html>, and a root element
    // whose overflow is not `visible` stops the body's overflow propagating
    // to the viewport - so the page kept scrolling under the open drawer.
    // That reasoning now lives in lib/scroll-lock.ts, which every overlay
    // in the app shares.
    const unlockScroll = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
      unlockScroll();
      const previous = lastFocusedRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      } else {
        triggerRef.current?.focus();
      }
    };
  }, [open]);

  const drawer = (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('Navigation')}
    >
      <button
        type="button"
        aria-label={t('Close menu')}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-forest-950/70 backdrop-blur-sm"
      />
      <nav
        ref={panelRef}
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
            aria-label={t('Close menu')}
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
  );

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-cream-100/85 hover:bg-cream-100/10 ring-1 ring-cream-100/10"
        aria-label={t('Open menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && mounted && createPortal(drawer, document.body)}
    </div>
  );
}
