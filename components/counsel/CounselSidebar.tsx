'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Firm, FirmMember } from '@/lib/firm-types';
import { isCounselItemActive, tenantHref } from '@/lib/counsel-routing';
import {
  applyMenuConfig,
  readMenuConfig,
  withHiddenHrefs,
  TIME_BILLING_HREFS,
} from '@/lib/menu-config';
import { T } from '@/components/i18n/LocaleProvider';

// Icons stay here (React) keyed by href; the menu DATA + the firm's
// hide/rename/reorder customization live in lib/menu-config.ts so the
// settings editor and this server-rendered rail share one source of
// truth. Unknown href -> a neutral default glyph.
const ICONS: Record<string, React.ReactNode> = {
  '/counsel': <DashIcon />,
  '/counsel/analytics': <ChartIcon />,
  '/counsel/aid': <SparkIcon />,
  '/counsel/calendar': <CalIcon />,
  '/counsel/import': <ImportIcon />,
  '/counsel/intake': <InboxIcon />,
  '/counsel/templates': <TemplateIcon />,
  '/counsel/letters': <MailIcon />,
  '/counsel/analyze': <MagnifyIcon />,
  '/counsel/cases': <CaseIcon />,
  '/counsel/documents': <DocIcon />,
  '/counsel/contracts': <ContractIcon />,
  '/counsel/projects': <ProjectIcon />,
  '/counsel/signing': <SignIcon />,
  '/counsel/clients': <UserIcon />,
  '/counsel/employees': <UsersIcon />,
  '/counsel/team': <UsersIcon />,
  '/counsel/chat': <ChatIcon />,
  '/counsel/meetings': <CalIcon />,
  '/counsel/leads': <LeadIcon />,
  '/counsel/referrals': <ReferralIcon />,
  '/counsel/time': <TimeIcon />,
  '/counsel/billing': <BillingIcon />,
  '/counsel/trust': <TrustIcon />,
  '/counsel/help': <HelpIcon />,
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
  hideTimeBilling = false,
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
  /**
   * True when the firm turned off the Time & Billing group in settings
   * (firm_settings.hide_time_billing). Drops Time / Billing / Trust
   * from the rail.
   */
  hideTimeBilling?: boolean;
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
  // When the firm hid Time & Billing, fold those hrefs into the hidden
  // set so the whole Finance group drops out.
  const sections = applyMenuConfig(
    withHiddenHrefs(
      readMenuConfig(firm.metadata),
      hideTimeBilling ? TIME_BILLING_HREFS : [],
    ),
  );
  return (
    <nav className="card p-3 space-y-0.5">
      <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 px-2 pt-1 pb-2">
        {firm.name}
      </p>
      {sections.map((sec) => (
        <div key={sec.section} className="pb-1">
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-400 dark:text-cream-100/60 px-2 pt-3 pb-1">
            <T>{sec.section}</T>
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
            <span className="flex-1"><T>{item.label}</T></span>
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
                <span><T>Firm settings</T></span>
              </Link>
            );
          })()}
        </>
      )}
    </nav>
  );
}

const SVG = {
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
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

/** Analytics — bars with a trend line. */
function ChartIcon() {
  return (
    <svg {...SVG}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-5M12 20v-9M16 20v-6" />
      <path d="M7 11l4-4 3 2 4-5" opacity="0.65" />
    </svg>
  );
}

/** Intake — an inbox tray with an incoming item. */
function InboxIcon() {
  return (
    <svg {...SVG}>
      <path d="M4 13v5a2 2 0 002 2h12a2 2 0 002-2v-5" />
      <path d="M4 13l2.2-7a2 2 0 011.9-1.4h7.8A2 2 0 0117.8 6L20 13" />
      <path d="M4 13h4l1.2 2h5.6L16 13h4" />
    </svg>
  );
}

/** Contract — a page with a signature flourish. */
function ContractIcon() {
  return (
    <svg {...SVG}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 16.5c.9-1 1.6.6 2.5 0s1.6.6 2.5 0" opacity="0.8" />
    </svg>
  );
}

/** Projects — a small kanban of columns. */
function ProjectIcon() {
  return (
    <svg {...SVG}>
      <rect x="4" y="5" width="4.2" height="14" rx="1" />
      <rect x="10" y="5" width="4.2" height="9" rx="1" />
      <rect x="16" y="5" width="4.2" height="11" rx="1" />
    </svg>
  );
}

/** Templates — a page with a laid-out placeholder header + column. */
function TemplateIcon() {
  return (
    <svg {...SVG}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 9v11" />
    </svg>
  );
}

/** Time — a clock. */
function TimeIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.2l2.8 1.8" />
    </svg>
  );
}

/** Billing — an invoice with a torn base + lines. */
function BillingIcon() {
  return (
    <svg {...SVG}>
      <path d="M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" opacity="0.8" />
    </svg>
  );
}

/** Trust — a shield with a check (protected client funds). */
function TrustIcon() {
  return (
    <svg {...SVG}>
      <path d="M12 3l7 3v5c0 5-3.4 8-7 9-3.6-1-7-4-7-9V6z" />
      <path d="M9 12l2 2 4-4" opacity="0.85" />
    </svg>
  );
}

/** Leads — a person with a plus. */
function LeadIcon() {
  return (
    <svg {...SVG}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.4 3-6 6.5-6 1 0 2 .2 2.8.6" />
      <path d="M18 15v5M15.5 17.5h5" opacity="0.85" />
    </svg>
  );
}

/** Referrals — two nodes linked (a hand-off). */
function ReferralIcon() {
  return (
    <svg {...SVG}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8 8.6l8 6.8" opacity="0.75" />
      <path d="M14.5 6.5H18v3.5" opacity="0.75" />
    </svg>
  );
}

/** Help — a question mark in a ring. */
function HelpIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.2a2.4 2.4 0 014.7.7c0 1.7-2.3 2-2.3 3.4" />
      <path d="M12 16.4h.01" strokeWidth="2" />
    </svg>
  );
}
