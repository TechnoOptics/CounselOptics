'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Firm, FirmMember } from '@/lib/firm-types';
import { isCounselItemActive, tenantHref } from '@/lib/counsel-routing';
import { applyMenuConfig, readMenuConfig } from '@/lib/menu-config';

// Icons stay here (React) keyed by href; the menu DATA + the firm's
// hide/rename/reorder customization live in lib/menu-config.ts so the
// settings editor and this server-rendered rail share one source of
// truth. Unknown href -> a neutral default glyph.
const ICONS: Record<string, React.ReactNode> = {
  '/counsel': <DashIcon />,
  '/counsel/analytics': <DashIcon />,
  '/counsel/aid': <SparkIcon />,
  '/counsel/calendar': <CalIcon />,
  '/counsel/import': <ImportIcon />,
  '/counsel/intake': <UserIcon />,
  '/counsel/templates': <DocIcon />,
  '/counsel/letters': <MailIcon />,
  '/counsel/analyze': <MagnifyIcon />,
  '/counsel/cases': <CaseIcon />,
  '/counsel/documents': <DocIcon />,
  '/counsel/contracts': <DocIcon />,
  '/counsel/projects': <DocIcon />,
  '/counsel/signing': <SignIcon />,
  '/counsel/clients': <UserIcon />,
  '/counsel/employees': <UsersIcon />,
  '/counsel/team': <UsersIcon />,
  '/counsel/chat': <ChatIcon />,
  '/counsel/meetings': <CalIcon />,
  '/counsel/leads': <UsersIcon />,
  '/counsel/referrals': <UsersIcon />,
  '/counsel/time': <DashIcon />,
  '/counsel/billing': <SignIcon />,
  '/counsel/trust': <SignIcon />,
  '/counsel/help': <ChatIcon />,
};

// `isCounselItemActive` and `tenantHref` live in lib/counsel-routing.ts
// so the URL logic can be unit-tested without bundling React. The
// regression script in scripts/test/counsel-routing.mjs runs in CI and
// guards against the V3/V4/V5 audit's recurring "Firm settings
// dead-click" finding (CR-5 / CR-28).

export function CounselSidebar({
  firm,
  membership,
  pathname,
  tenantMode = false,
}: {
  firm: Firm;
  membership: FirmMember;
  /**
   * Effective pathname forwarded by the layout via the x-pathname
   * header. Audit W20 V3 CR-14: previously the sidebar had no
   * active-state highlight at all, and the hover treatment looked
   * identical to what a user expected the current page to look like.
   * Now: hover is a soft tint (cream-50 / forest-800), active is a
   * filled pill with a left-border accent + bold label - visually
   * distinct enough to never be confused.
   */
  pathname: string;
  /**
   * True when the page is being served from a tenant subdomain
   * (enterprise.advottic.com, <slug>.advottic.com). In that mode the
   * URL bar elides the /counsel prefix, so the sidebar hrefs need to
   * elide it too - otherwise every link bounces through a Step-1
   * 307 redirect. Audit V5 CR-5/CR-28.
   */
  tenantMode?: boolean;
}) {
  // The pathname prop is forwarded from the server layout for the
  // initial SSR pass (so the right item is highlighted on first
  // paint with no flicker). Once we're in the browser, the App
  // Router's layout DOES NOT re-render on segment changes, so the
  // prop is frozen at first load. usePathname() updates live on
  // every soft navigation, so we prefer it - falling back to the
  // SSR prop only when usePathname returns null (very brief, during
  // hydration). This fixes the "highlight stuck on previous page"
  // bug after clicking another sidebar item.
  const livePathname = usePathname() ?? pathname;
  // Per-firm customization (hide / rename / reorder). Falls back to
  // the full default menu when the firm has not customized anything.
  const sections = applyMenuConfig(readMenuConfig(firm.metadata));
  return (
    <nav className="card p-3 sticky top-24 space-y-0.5">
      <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 px-2 pt-1 pb-2">
        {firm.name}
      </p>
      {sections.map((sec) => (
        <div key={sec.section} className="pb-1">
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-400 dark:text-cream-100/40 px-2 pt-3 pb-1">
            {sec.section}
          </p>
          {sec.items.map((item) => {
            const active = isCounselItemActive(item.href, livePathname);
            const href = tenantHref(item.href, tenantMode);
            return (
          // Audit V3 CR-28 / V5 CR-5+CR-28: prefetch={false} + the
          // tenantHref mapping together avoid the dead-click symptom.
          // The tenantHref keeps the click off the redirect entirely;
          // prefetch={false} keeps the apex case (no rewrite) honest
          // by not caching a stale prefetch when middleware logic
          // changes. Cost: ~one server round-trip per navigation,
          // invisible at the latencies this site operates at.
          <Link
            key={item.href}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            data-testid={`counsel-sidebar-${item.href.replace(/^\//, '').replace(/\//g, '-') || 'root'}`}
            className={
              active
                ? 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-semibold text-forest-900 dark:text-cream-100 bg-forest-900/10 dark:bg-cream-100/10 ring-1 ring-forest-900/15 dark:ring-cream-100/15 border-l-2 border-forest-900 dark:border-gold-400 transition-colors'
                : 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-ink-800 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/60 hover:text-forest-900 dark:hover:text-cream-100 transition-colors'
            }
          >
            <span
              className="h-5 w-5 rounded inline-flex items-center justify-center text-white flex-none"
              style={{ backgroundColor: firm.accentColor, opacity: active ? 1 : 0.85 }}
              aria-hidden
            >
              {ICONS[item.href] ?? <DocIcon />}
            </span>
            <span className="flex-1">{item.label}</span>
          </Link>
            );
          })}
        </div>
      ))}
      {(membership.role === 'owner' || membership.role === 'admin') && (
        <>
          <div className="my-2 border-t border-ink-100 dark:border-forest-700/40" />
          {(() => {
            const active = isCounselItemActive('/counsel/settings', livePathname);
            const href = tenantHref('/counsel/settings', tenantMode);
            return (
              <Link
                href={href}
                prefetch={false}
                data-testid="counsel-sidebar-settings"
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-semibold text-forest-900 dark:text-cream-100 bg-forest-900/10 dark:bg-cream-100/10 ring-1 ring-forest-900/15 dark:ring-cream-100/15 border-l-2 border-forest-900 dark:border-gold-400 transition-colors'
                    : 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-ink-800 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/60 hover:text-forest-900 dark:hover:text-cream-100 transition-colors'
                }
              >
                <span
                  className="h-5 w-5 rounded inline-flex items-center justify-center text-white flex-none"
                  style={{ backgroundColor: firm.accentColor, opacity: active ? 1 : 0.85 }}
                  aria-hidden
                >
                  <GearIcon />
                </span>
                <span>Firm settings</span>
              </Link>
            );
          })()}
        </>
      )}
    </nav>
  );
}

const SVG = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function DashIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg {...SVG}>
      <path d="M12 3l1.8 5L19 9.8 14 12l-2 5-2-5-5-2.2L10 8z" />
    </svg>
  );
}
function MagnifyIcon() {
  return (
    <svg {...SVG}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function CaseIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...SVG}>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 21c0-3 3-5 6-5s6 2 6 5" />
      <path d="M14 21c0-2 2-4 5-4s5 2 5 4" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg {...SVG}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
function SignIcon() {
  return (
    <svg {...SVG}>
      <path d="M15 4l5 5L9 20H4v-5z" />
      <path d="M12 7l5 5" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg {...SVG}>
      <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}
function ImportIcon() {
  return (
    <svg {...SVG}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a7.97 7.97 0 000-6l2-1.2-2-3.4-2.3.8a8 8 0 00-5.2-3L11.5 0h-3l-.4 2.2a8 8 0 00-5.2 3l-2.3-.8-2 3.4 2 1.2a7.97 7.97 0 000 6l-2 1.2 2 3.4 2.3-.8a8 8 0 005.2 3L8.5 24h3l.4-2.2a8 8 0 005.2-3l2.3.8 2-3.4z" />
    </svg>
  );
}
