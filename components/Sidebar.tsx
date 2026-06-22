'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SearchTrigger } from './SearchPalette';
import {
  applyMenuPreferences,
  type MenuPreferences,
} from '@/lib/menu-prefs';
import { saveMenuPreferencesAction } from '@/lib/actions';

type NavItem = {
  /** Stable id used by the customization layer. Uses href so an
   *  existing preference row stays valid as long as the route does. */
  id: string;
  label: string;
  href: string;
  // For active matching: exact match on `href`, or the pathname starts with `prefix`.
  prefix?: string;
  // Filter param to match against searchParams.filter (used by "Shared with me").
  filter?: string;
  // When true, hide this item inside the iOS app (App Store Guideline
  // 3.1.1 - no non-Apple purchase entry points). The CSS rule in
  // globals.css (.is-ios-app [data-hide-on-ios]) removes it on iOS only.
  hideOnIos?: boolean;
  icon: () => React.ReactElement;
};

const ITEMS: NavItem[] = [
  { id: '/cases/new', label: 'New case', href: '/cases/new', icon: PlusIcon },
  { id: '/cases', label: 'Cases', href: '/cases', prefix: '/cases', icon: CasesIcon },
  { id: '/cases?filter=shared', label: 'Shared with me', href: '/cases?filter=shared', filter: 'shared', icon: ShareIcon },
  // Action Center: hub for the four time-sensitive tools (War Room,
  // Deadline Radar, Decode a Document, Safe Witness). Placed near
  // the top because what's on it is "what needs me right now."
  // The standalone pages still work at their original URLs; this is
  // just the front door.
  { id: '/action-center', label: 'Action center', href: '/action-center', prefix: '/action-center', icon: ActionCenterIcon },
  { id: '/find-counsel', label: 'Find counsel', href: '/find-counsel', prefix: '/find-counsel', icon: ScalesIcon },
  { id: '/file-exhibits', label: 'File exhibits', href: '/file-exhibits', prefix: '/file-exhibits', icon: FileIcon },
  { id: '/public-defender', label: 'Public defender', href: '/public-defender', prefix: '/public-defender', icon: GavelIcon },
  { id: '/contracts', label: 'Contracts', href: '/contracts', prefix: '/contracts', icon: FileIcon },
  { id: '/vault', label: 'Vault', href: '/vault', prefix: '/vault', icon: FileIcon },
  { id: '/billing', label: 'Billing', href: '/billing', prefix: '/billing', icon: CardIcon },
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
 *
 * `initialPrefs` carries the user's saved customization for the
 * consumer portal: hidden item ids + reordered ids. Loaded server-
 * side in app/layout.tsx and passed in. Edit mode is fully
 * client-side until "Save" hits the saveMenuPreferencesAction
 * server action.
 */
export function Sidebar({
  initialPrefs,
}: {
  initialPrefs?: MenuPreferences;
}) {
  const isActive = useActive();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Draft state mirrors the saved prefs until the user clicks
  // Save. Cancel resets back to initialPrefs.
  const initialOrder = useMemo(() => {
    const o = initialPrefs?.order ?? [];
    const known = new Set(ITEMS.map((i) => i.id));
    const filtered = o.filter((id) => known.has(id));
    for (const it of ITEMS) if (!filtered.includes(it.id)) filtered.push(it.id);
    return filtered;
  }, [initialPrefs]);
  const initialHidden = useMemo(
    () => new Set(initialPrefs?.hidden ?? []),
    [initialPrefs],
  );
  const [draftOrder, setDraftOrder] = useState<string[]>(initialOrder);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(initialHidden);

  const byId = useMemo(() => new Map(ITEMS.map((i) => [i.id, i])), []);

  // Visible items when NOT editing - apply saved prefs.
  const visibleItems = useMemo(
    () => applyMenuPreferences(ITEMS, initialPrefs),
    [initialPrefs],
  );

  function moveUp(index: number) {
    if (index <= 0) return;
    setDraftOrder((arr) => {
      const next = arr.slice();
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }
  function moveDown(index: number) {
    setDraftOrder((arr) => {
      if (index >= arr.length - 1) return arr;
      const next = arr.slice();
      [next[index + 1], next[index]] = [next[index], next[index + 1]];
      return next;
    });
  }
  function toggleHidden(id: string) {
    setDraftHidden((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveMenuPreferencesAction('consumer', {
        hidden: Array.from(draftHidden),
        order: draftOrder,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
    });
  }
  function cancel() {
    setDraftOrder(initialOrder);
    setDraftHidden(initialHidden);
    setError(null);
    setEditing(false);
  }

  return (
    <aside
      aria-label="Primary"
      // top offset = sticky header height (top-row ~60px + a bit of breathing room).
      // Layout has self-start so the sticky body anchors against the parent flex item.
      className="hidden md:block sticky top-20 self-start w-[200px] lg:w-[224px] flex-none"
    >
      <nav className="rounded-2xl bg-gradient-to-b from-forest-900 via-forest-900 to-forest-950 ring-1 ring-forest-700/40 shadow-card text-cream-100 p-3 space-y-1">
        {/* Edit affordance. Default state: pencil icon. Edit state:
            up/down arrows + visibility eye on each row + Save / Cancel
            controls at the bottom. The pencil is intentionally small
            and gold so it reads as a tool, not a primary nav item. */}
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-0.5 mb-1 border-b border-forest-700/40">
          <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-cream-100/55">
            {editing ? 'Edit menu' : 'Menu'}
          </p>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit menu order and visibility"
              title="Reorder or hide items"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-cream-100/55 hover:text-gold-300 hover:bg-forest-700/50 transition-colors"
            >
              <PencilIcon />
            </button>
          ) : (
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="text-[11px] text-cream-100/55 hover:text-cream-100 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>

        {editing
          ? draftOrder.map((id, idx) => {
              const item = byId.get(id);
              if (!item) return null;
              const hidden = draftHidden.has(id);
              return (
                <div
                  key={id}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm ${
                    hidden
                      ? 'opacity-50 bg-forest-800/30'
                      : 'bg-forest-800/40'
                  }`}
                >
                  <span className="text-cream-100/60 flex-none">
                    {item.icon()}
                  </span>
                  <span className="flex-1 truncate text-[12.5px]">
                    {item.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0 || pending}
                    aria-label={`Move ${item.label} up`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-cream-100/55 hover:text-cream-100 hover:bg-forest-700/50 disabled:opacity-25"
                  >
                    <UpIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(idx)}
                    disabled={idx === draftOrder.length - 1 || pending}
                    aria-label={`Move ${item.label} down`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-cream-100/55 hover:text-cream-100 hover:bg-forest-700/50 disabled:opacity-25"
                  >
                    <DownIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleHidden(id)}
                    disabled={pending}
                    aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                    title={hidden ? 'Show' : 'Hide'}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-cream-100/55 hover:text-cream-100 hover:bg-forest-700/50"
                  >
                    {hidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              );
            })
          : visibleItems.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  {...(item.hideOnIos ? { 'data-hide-on-ios': true } : {})}
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

        {editing && (
          <div className="pt-2 mt-2 border-t border-forest-700/40 space-y-1.5">
            {error && (
              <p className="text-[11px] text-rose-300 leading-snug px-1">{error}</p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </nav>
    </aside>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 3.5l4 4-11.5 11.5H5v-4l11.5-11.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function UpIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.5 6.2A12 12 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.6M6 6.5C3 8.6 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * Hamburger button + slide-down dropdown for small screens. Replaces the old
 * horizontal-scroll mobile nav. The dropdown closes on item click, escape,
 * route change, or click-outside.
 */
export function MobileNav({
  initialPrefs,
}: {
  initialPrefs?: MenuPreferences;
}) {
  const isActive = useActive();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  // Apply the same per-portal customization as the desktop Sidebar
  // so hiding "Vault" on desktop ALSO hides it in the mobile dropdown.
  // Reorder + hide are read-only on mobile; editing happens on desktop.
  const visibleItems = useMemo(
    () => applyMenuPreferences(ITEMS, initialPrefs),
    [initialPrefs],
  );

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

  // Find the active item to label the closed button. Read from the
  // master ITEMS list so the label still appears even if the user
  // hid the item from the menu (they navigated to it via URL).
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
            {visibleItems.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.id} {...(item.hideOnIos ? { 'data-hide-on-ios': true } : {})}>
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

function ActionCenterIcon() {
  // A radar burst: concentric arcs over a centered dot. Reads as
  // "things happening right now / urgency tracker" - matches what
  // the Action Center is for.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12v0M8.5 12a3.5 3.5 0 0 1 7 0M5 12a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
