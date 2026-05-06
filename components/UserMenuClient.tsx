'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

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
        <span className="hidden md:inline text-sm text-cream-100 max-w-[160px] truncate">
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
          <div className="px-4 py-3 border-b border-ink-100">
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
            {/* Consumer-side links are hidden when the user is inside
                /counsel/* - those surfaces (personal billing, personal
                case list) are not relevant in the organizational
                workspace. */}
            {!props.isCounselMode && (
              <>
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
          </div>
          {props.isAdmin && !props.isHqMode && (
            <div className="border-t border-ink-100 py-1.5">
              <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                Founder console
              </p>
              {/*
                Hard <a> instead of <Link>. Crossing from the consumer
                shell into /admin (a different layout chrome) needs a
                full document load so middleware can re-run and forward
                the new x-pathname header to the root layout. With a
                soft Next.js navigation the root layout stays mounted
                with the previous chrome until any subsequent click
                triggers a re-render.
              */}
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
            </div>
          )}
          {(props.firmMemberships?.length ?? 0) > 0 && !props.isCounselMode && (
            <div className="border-t border-ink-100 py-1.5">
              <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                Counsel mode
              </p>
              {props.firmMemberships!.map((m) => (
                /* Same chrome-crossing reason as the HQ link above:
                   /counsel uses its own root layout. Force a hard load. */
                <a
                  key={m.firmId}
                  href="/counsel"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-800 hover:bg-cream-50 hover:text-forest-900 transition-colors"
                >
                  <span
                    className="h-5 w-5 rounded inline-flex items-center justify-center text-white text-[11px] font-semibold flex-none"
                    style={{ backgroundColor: m.accentColor }}
                    aria-hidden
                  >
                    {m.firmName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">Switch to {m.firmName}</span>
                  <span aria-hidden className="text-ink-400">
                    →
                  </span>
                </a>
              ))}
            </div>
          )}
          {/* Counsel is invitation-only - no self-service signup
              from the consumer-side menu. Existing members see the
              "Counsel mode" submenu above (jumps to /counsel).
              Everyone else can apply via the public /counsel/request
              form, which is reachable from marketing surfaces. */}
          <form action="/auth/sign-out" method="post" className="border-t border-ink-100">
            <button
              type="submit"
              className="w-full text-left px-4 py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
            >
              Sign out
            </button>
          </form>
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
