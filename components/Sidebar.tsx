'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SearchTrigger } from './SearchPalette';

type NavItem = {
  label: string;
  href: string;
  // For active matching: exact match on `href`, or the pathname starts with `prefix`.
  prefix?: string;
  // Filter param to match against searchParams.filter (used by "Shared with me").
  filter?: string;
  icon: () => React.ReactElement;
};

const ITEMS: NavItem[] = [
  { label: 'New case', href: '/cases/new', icon: PlusIcon },
  { label: 'Cases', href: '/cases', prefix: '/cases', icon: CasesIcon },
  { label: 'Shared with me', href: '/cases?filter=shared', filter: 'shared', icon: ShareIcon },
  { label: 'Find counsel', href: '/find-counsel', prefix: '/find-counsel', icon: ScalesIcon },
  { label: 'File exhibits', href: '/file-exhibits', prefix: '/file-exhibits', icon: FileIcon },
  { label: 'Public defender', href: '/public-defender', prefix: '/public-defender', icon: GavelIcon },
  { label: 'Billing', href: '/billing', prefix: '/billing', icon: CardIcon },
];

function useActive() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const filter = params?.get('filter') ?? null;

  return (item: NavItem) => {
    // /cases?filter=shared has its own active state separate from /cases
    if (item.filter) {
      return pathname === '/cases' && filter === item.filter;
    }
    if (item.href === '/cases') {
      // "Cases" is active for /cases itself OR /cases/<id> - but NOT when filter=shared
      // and NOT for /cases/new (that's its own item).
      if (pathname === '/cases/new') return false;
      if (pathname === '/cases' && filter === 'shared') return false;
      return pathname === '/cases' || pathname.startsWith('/cases/');
    }
    if (item.href === pathname) return true;
    if (item.prefix && pathname.startsWith(item.prefix + '/')) return true;
    return false;
  };
}

/**
 * Desktop / tablet sidebar. Hidden on small screens (mobile, narrow folded
 * foldables) where SidebarMobile renders a horizontal scroll bar instead.
 */
export function Sidebar() {
  const isActive = useActive();
  return (
    <aside
      aria-label="Primary"
      // top offset = sticky header height (top-row ~60px + a bit of breathing room).
      // Layout has self-start so the sticky body anchors against the parent flex item.
      className="hidden md:block sticky top-20 self-start w-[200px] lg:w-[224px] flex-none"
    >
      <nav className="rounded-2xl bg-gradient-to-b from-forest-900 via-forest-900 to-forest-950 ring-1 ring-forest-700/40 shadow-card text-cream-100 p-3 space-y-1">
        {ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-forest-700/60 text-cream-100 ring-1 ring-gold-400/40'
                  : 'text-cream-100/80 hover:text-cream-100 hover:bg-forest-800/70'
              }`}
            >
              <span className={active ? 'text-gold-400' : 'text-cream-100/60'}>
                {item.icon()}
              </span>
              <span className="truncate">{item.label}</span>
              {active && (
                <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-gold-400" />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * Hamburger button + slide-down dropdown for small screens. Replaces the old
 * horizontal-scroll mobile nav. The dropdown closes on item click, escape,
 * route change, or click-outside.
 */
export function MobileNav() {
  const isActive = useActive();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Find the active item to label the closed button.
  const activeItem = ITEMS.find(isActive) ?? null;

  return (
    <div
      ref={wrapperRef}
      className="md:hidden border-b border-forest-700/30 bg-forest-900/65 backdrop-blur relative"
    >
      <div className="mx-auto max-w-6xl px-4 py-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Toggle navigation"
          className="inline-flex items-center gap-2 rounded-md bg-forest-800/70 hover:bg-forest-800 text-cream-100 px-3 py-2 ring-1 ring-forest-700/40 transition-colors"
        >
          {open ? <CloseIcon /> : <BurgerIcon />}
          <span className="text-[13px] font-medium">
            {activeItem ? activeItem.label : 'Menu'}
          </span>
        </button>
        {/* Search lives in this lower row on mobile so the top header
            stays uncluttered between the wordmark and the avatar. */}
        <SearchTrigger className="ml-auto" />
      </div>

      {open && (
        <nav
          role="menu"
          aria-label="Primary"
          className="absolute left-0 right-0 top-full z-30 px-3 pb-3 animate-fade-up"
        >
          <ul className="rounded-xl bg-forest-900 ring-1 ring-forest-700/40 shadow-card-hover overflow-hidden divide-y divide-forest-700/30">
            {ITEMS.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href + item.label}>
                  <Link
                    href={item.href}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                      active
                        ? 'bg-forest-800 text-cream-100'
                        : 'text-cream-100/85 hover:text-cream-100 hover:bg-forest-800/70'
                    }`}
                  >
                    <span className={active ? 'text-gold-400' : 'text-cream-100/60'}>
                      {item.icon()}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {active && (
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

function BurgerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------- Icons ----------------------

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CasesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11l8-4M8 13l8 4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ScalesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v16M5 7h14M5 7L3 13a3 3 0 006 0L7 7m10 0l-2 6a3 3 0 006 0l-2-6M7 20h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function GavelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4l6 6m-3-3l-7 7m-2-2l-3 3a2 2 0 1 0 2.8 2.8l3-3M4 20h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
