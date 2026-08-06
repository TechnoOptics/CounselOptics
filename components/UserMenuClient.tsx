'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import type { LocaleCode } from '@/lib/i18n/locales';
import { accentOn } from '@/lib/accent-text';

export type UserMenuProps = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  initials: string;
  isAdmin: boolean;
  organization: string | null;
  /** Firms the user is a member of. Empty array hides the
   *  "Switch to firm view" submenu so consumer-only users never see
   *  it. Populated by getMyFirms() server-side in UserMenu. */
  firmMemberships?: Array<{
    firmId: string;
    firmName: string;
    accentColor: string;
  }>;
  /** True when the request originates inside /counsel/* OR /admin/*.
   *  Hides the consumer-side links (My cases, Billing) and the
   *  "Set up another firm" prompt because the user is already in
   *  their professional workspace. */
  isCounselMode?: boolean;
  /** True when the request originates inside /admin/* specifically.
   *  Hides the "Advottic HQ" entry since it would link the page to
   *  itself. */
  isHqMode?: boolean;
  /** When set (consumer i18n is on), render the language selector inside the
   *  menu instead of the top header, where it overlapped the Advottic wordmark
   *  on narrow mobile widths. */
  languageLocale?: LocaleCode;
};

export function UserMenuClient(props: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 pl-2 pr-1 py-1 rounded-full hover:bg-forest-800 transition-colors"
        title={props.email}
      >
        <span
          className="hidden md:inline text-sm text-cream-100 max-w-[160px] truncate"
          data-no-translate
        >
          {props.displayName}
        </span>
        {props.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full object-cover border border-gold-500/40"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-forest-900 text-[12px] font-semibold tracking-tight border border-forest-700/30 shadow-sm">
            {props.initials}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 rounded-xl border border-forest-200 bg-white shadow-card-hover overflow-hidden z-50"
        >
          <div className="px-4 py-3 border-b border-ink-100" data-no-translate>
            <p className="font-semibold text-ink-950 text-sm truncate">{props.displayName}</p>
            <p className="text-xs text-ink-500 truncate">{props.email}</p>
            {props.organization && (
              <p className="text-xs text-ink-500 truncate mt-0.5">{props.organization}</p>
            )}
            {props.isAdmin && (
              <span className="badge bg-forest-900 text-cream-200 mt-2">Admin</span>
            )}
          </div>
          <div className="py-1">
            <MenuLink href="/profile" onClick={() => setOpen(false)}>
              Profile & settings
            </MenuLink>
            {/* Consumer-side links (Billing, My cases) only render
                when actually inside the consumer shell. The "Switch
                portal" section below provides a one-click path back
                to the consumer side from counsel / HQ. */}
            {!props.isCounselMode && (
              <>
                {/* Billing is reachable on iOS: subscriptions are sold
                    through Apple In-App Purchase there (Guideline 3.1.1),
                    so this row is no longer gated. */}
                <MenuLink href="/billing" onClick={() => setOpen(false)}>
                  Billing & subscription
                </MenuLink>
                <MenuLink href="/cases" onClick={() => setOpen(false)}>
                  My cases
                </MenuLink>
              </>
            )}
            <MenuLink href="/feedback" onClick={() => setOpen(false)}>
              Send feedback
            </MenuLink>
            {props.languageLocale && (
              <div className="px-3 pt-2 mt-1 border-t border-ink-100">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">
                  Language
                </p>
                <LanguageSwitcher initialLocale={props.languageLocale} />
              </div>
            )}
          </div>

          {/* Switch-portal cluster. Surfaces every portal the user
              has access to, regardless of which one they're currently
              in. Lets contact@advottic.com (HQ admin + firm owner)
              and any multi-portal user jump between the consumer
              dashboard, the firm workspace(s), and the HQ console
              from a single menu - no re-signing in, no remembering
              which subdomain to type into the URL bar. */}
          {(() => {
            const showHq = props.isAdmin && !props.isHqMode;
            const firms = props.firmMemberships ?? [];
            // Consumer link only appears when we're NOT already in
            // consumer mode (isCounselMode covers BOTH counsel and HQ).
            const showConsumer = props.isCounselMode;
            const hasAny = showHq || firms.length > 0 || showConsumer;
            if (!hasAny) return null;
            return (
              <div className="border-t border-ink-100 py-1.5">
                <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                  Switch portal
                </p>
                {showConsumer && (
                  // Hard <a> - consumer vs counsel/HQ shells live on
                  // different layouts; the chrome only swaps on a
                  // full reload so middleware can re-emit x-pathname.
                  <a
                    href="/cases"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
                  >
                    <span
                      className="h-5 w-5 rounded inline-flex items-center justify-center text-cream-50 text-[11px] font-semibold flex-none bg-forest-900"
                      aria-hidden
                    >
                      A
                    </span>
                    <span className="flex-1 truncate">Consumer dashboard</span>
                    <span aria-hidden className="text-ink-400">
                      →
                    </span>
                  </a>
                )}
                {showHq && (
                  <a
                    href="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors group"
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
                    <span className="flex-1 truncate font-medium">
                      Advottic HQ
                    </span>
                    <span aria-hidden className="text-ink-400 group-hover:text-forest-700">
                      →
                    </span>
                  </a>
                )}
                {firms.map((m) => (
                  <a
                    key={m.firmId}
                    href="/counsel"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
                  >
                    <span
                      className="h-5 w-5 rounded inline-flex items-center justify-center text-[11px] font-semibold flex-none"
                      style={{
                        backgroundColor: m.accentColor,
                        color: accentOn(m.accentColor),
                      }}
                      aria-hidden
                    >
                      {m.firmName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate" data-no-translate>{m.firmName}</span>
                    <span aria-hidden className="text-ink-400">
                      →
                    </span>
                  </a>
                ))}
              </div>
            );
          })()}
          {/* Counsel is invitation-only - no self-service signup
              from the consumer-side menu. Existing members see the
              "Counsel mode" submenu above (jumps to /counsel).
              Everyone else can apply via the public /counsel/request
              form, which is reachable from marketing surfaces. */}
          <div className="border-t border-ink-100">
            {/* "Switch account" - signs the current session out and
                lands at /sign-in?switch=1 so the chooser stays open
                instead of auto-signing the user back in with their
                existing cookies. Pairs with prompt=select_account
                on the Google + Microsoft OAuth init so the provider
                also shows its account picker. Without both pieces,
                a browser that's already signed into a Google account
                can't escape that identity inside Advottic. */}
            <form action="/auth/sign-out" method="post">
              <input type="hidden" name="next" value="/sign-in?switch=1" />
              <button
                type="submit"
                className="w-full text-left px-4 py-2.5 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
              >
                Switch account
              </button>
            </form>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="w-full text-left px-4 py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
              >
                Sign out
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
      className="block px-4 py-2.5 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
    >
      {children}
    </Link>
  );
}
