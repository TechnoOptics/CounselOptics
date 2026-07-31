'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setActiveFirmAction, enterPortalPreviewAction } from '@/lib/firm-actions';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { TokenBalanceGauge } from '@/components/TokenBalanceGauge';
import { T } from '@/components/i18n/LocaleProvider';
import type { LocaleCode } from '@/lib/i18n/locales';

/**
 * Consolidated account menu for the Counsel header. Everything that
 * used to sit loose across the top bar - the firm/owner switcher, the
 * "View as" persona preview, and the language picker - now lives inside
 * this one dropdown. The header bar shows nothing but the initials
 * avatar that opens it.
 *
 * Accessibility: the trigger carries aria-haspopup + aria-expanded; the
 * panel is a role="menu" that traps focus while open (Tab / Shift+Tab
 * cycle within it), closes on Escape or an outside click, and returns
 * focus to the trigger on close.
 */

export type FirmMembershipLite = {
  firmId: string;
  firmName: string;
  accentColor: string;
};

export type CounselProfileMenuClientProps = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  initials: string;
  isAdmin: boolean;
  organization: string | null;
  /** The active firm's name + role, for the header of the menu. */
  activeFirmId: string | null;
  activeFirmName: string | null;
  roleLabel: string | null;
  /** True when the signed-in member is an owner/admin of the active
   *  firm - gates the "View as" persona preview. */
  canPreview: boolean;
  /** Firms the user belongs to. Drives the "Switch firm" list. */
  memberships: FirmMembershipLite[];
  /** On a tenant subdomain the URL pins the firm, so firm switching is
   *  suppressed exactly as it was in the old header. */
  tenantMode: boolean;
  locale: LocaleCode;
};

export function CounselProfileMenuClient(props: CounselProfileMenuClientProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger so keyboard users are not dropped
    // at the top of the document after the panel unmounts.
    triggerRef.current?.focus();
  }, []);

  // Outside-click closes the panel (no focus bounce - the pointer is
  // already elsewhere).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Focus the first item on open + trap Tab within the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = focusables()[0];
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  }, [open, close]);

  function switchFirm(firmId: string) {
    if (firmId === props.activeFirmId) {
      close();
      return;
    }
    startTransition(async () => {
      const res = await setActiveFirmAction(firmId);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function preview(mode: 'employee' | 'vendor') {
    if (!props.activeFirmId) return;
    startTransition(async () => {
      // Server action redirects into /portal.
      await enterPortalPreviewAction(props.activeFirmId as string, '', mode);
    });
  }

  const showFirmSwitch = !props.tenantMode && props.memberships.length > 1;
  const showHq = props.isAdmin;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        title={props.email}
        className="flex items-center rounded-full p-0.5 hover:ring-2 hover:ring-gold-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 transition-shadow"
      >
        {props.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.avatarUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover border border-gold-500/40"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-forest-900 text-[12.5px] font-semibold tracking-tight border border-forest-700/30 shadow-sm"
            data-no-translate
          >
            {props.initials}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 mt-2 w-72 rounded-xl border border-forest-200 bg-white shadow-card-hover overflow-hidden z-50 max-h-[calc(100vh-5rem)] overflow-y-auto"
        >
          {/* Identity */}
          <div className="px-4 py-3 border-b border-ink-100" data-no-translate>
            <p className="font-semibold text-ink-950 text-sm truncate">{props.displayName}</p>
            <p className="text-xs text-ink-500 truncate">{props.email}</p>
            {props.activeFirmName && (
              <p className="text-xs text-ink-500 truncate mt-0.5">
                {props.activeFirmName}
                {props.roleLabel ? ` · ${props.roleLabel}` : ''}
              </p>
            )}
            {props.isAdmin && (
              <span className="badge bg-forest-900 text-cream-200 mt-2">Admin</span>
            )}
          </div>

          {/* Token balance */}
          <div className="px-4 py-3 border-b border-ink-100">
            <TokenBalanceGauge
              initial={{ combined: 0, firmPool: null, personal: 0, monthlyGrant: 0 }}
            />
          </div>

          {/* Switch firm (multi-firm members, shared-portal only) */}
          {showFirmSwitch && (
            <div className="border-b border-ink-100 py-1.5" role="group" aria-label="Switch firm">
              <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                <T>Switch firm</T>
              </p>
              {props.memberships.map((m) => {
                const active = m.firmId === props.activeFirmId;
                return (
                  <button
                    key={m.firmId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    disabled={pending}
                    onClick={() => switchFirm(m.firmId)}
                    className={`w-full text-left flex items-center gap-2.5 px-4 py-2 text-sm transition-colors disabled:opacity-60 ${
                      active
                        ? 'bg-cream-50 text-forest-900 font-semibold'
                        : 'text-ink-800 hover:bg-cream-50 hover:text-forest-900'
                    }`}
                  >
                    <span
                      className="h-5 w-5 rounded inline-flex items-center justify-center text-white text-[11px] font-semibold flex-none"
                      style={{ backgroundColor: m.accentColor }}
                      aria-hidden
                    >
                      {m.firmName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate" data-no-translate>
                      {m.firmName}
                    </span>
                    {active && (
                      <CheckIcon />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* View as (owner/admin persona preview) */}
          {props.canPreview && props.activeFirmId && (
            <div className="border-b border-ink-100 py-1.5" role="group" aria-label="View as">
              <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                <T>View as</T>
              </p>
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => preview('employee')}
                className="w-full text-left flex items-start gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors disabled:opacity-60"
              >
                <BadgeIcon />
                <span>
                  <span className="block font-medium"><T>Employee</T></span>
                  <span className="block text-[11px] text-ink-500 leading-snug">
                    <T>The in-house Hub your staff use.</T>
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => preview('vendor')}
                className="w-full text-left flex items-start gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors disabled:opacity-60"
              >
                <GlobeIcon />
                <span>
                  <span className="block font-medium"><T>External vendor</T></span>
                  <span className="block text-[11px] text-ink-500 leading-snug">
                    <T>What an outside collaborator sees.</T>
                  </span>
                </span>
              </button>
            </div>
          )}

          {/* Language */}
          <div className="border-b border-ink-100 px-4 py-2.5">
            <p className="pb-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
              <T>Language</T>
            </p>
            <LanguageSwitcher initialLocale={props.locale} />
          </div>

          {/* Account links */}
          <div className="py-1">
            <MenuLink href="/profile" onClick={() => setOpen(false)}>
              <T>Profile &amp; settings</T>
            </MenuLink>
            <MenuLink href="/feedback" onClick={() => setOpen(false)}>
              <T>Send feedback</T>
            </MenuLink>
          </div>

          {/* Switch portal: only the staff HQ portal. The consumer/personal
              dashboard link is intentionally NOT offered from the firm side:
              nothing in the firm workspace routes a user into the personal
              view. */}
          {showHq && (
            <div className="border-t border-ink-100 py-1.5">
              <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                <T>Switch portal</T>
              </p>
              {showHq && (
                <a
                  href="/admin"
                  onClick={() => setOpen(false)}
                  role="menuitem"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
                >
                  <span
                    className="h-5 w-5 rounded inline-flex items-center justify-center text-[11px] font-semibold flex-none text-forest-950"
                    style={{
                      background:
                        'linear-gradient(135deg, #f5edd6 0%, #d5bb7e 50%, #c9a96e 100%)',
                    }}
                    aria-hidden
                  >
                    HQ
                  </span>
                  <span className="flex-1 truncate font-medium">Advottic HQ</span>
                  <span aria-hidden className="text-ink-400">→</span>
                </a>
              )}
            </div>
          )}

          {/* Session */}
          <div className="border-t border-ink-100">
            <form action="/auth/sign-out" method="post">
              <input type="hidden" name="next" value="/sign-in?switch=1" />
              <button
                type="submit"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
              >
                <T>Switch account</T>
              </button>
            </form>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
              >
                <T>Sign out</T>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="block px-4 py-2.5 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
    >
      {children}
    </Link>
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
  className: 'flex-none mt-0.5 text-forest-700',
};

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
function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-none text-forest-700"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
