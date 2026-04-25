'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

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
      <p className="mt-4 px-2 text-[10.5px] uppercase tracking-[0.18em] font-semibold text-ink-400">
        Need a human?
      </p>
      <a
        href="https://wa.me/19253001600"
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 flex items-center gap-2 px-2 text-xs text-ink-500 hover:text-forest-900 transition-colors"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        WhatsApp +1 (925) 300-1600
      </a>
    </aside>
  );
}

/**
 * Compact horizontal nav shown below the header on small screens (foldables
 * folded, phones). Same items as the desktop sidebar.
 */
export function MobileNav() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Primary"
      className="md:hidden border-b border-forest-700/30 bg-forest-900/65 backdrop-blur"
    >
      <div className="mx-auto max-w-6xl px-4 py-1.5 flex items-center gap-1 text-sm overflow-x-auto">
        {ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                active
                  ? 'bg-forest-700/60 text-cream-100 ring-1 ring-gold-400/40'
                  : 'text-cream-100/85 hover:text-cream-100 hover:bg-forest-800'
              }`}
            >
              <span className={active ? 'text-gold-400' : 'text-cream-100/60'}>
                {item.icon()}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
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
