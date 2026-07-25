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
  '/counsel/forms': <TemplateIcon />,
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
            {/* Duotone gold glyphs (soft gold body + burnished gold line) — a
                crafted, on-brand set. No per-row colour tile (that read cheap).
                The active row shows at full strength; others sit slightly back. */}
            <span
              className={`inline-flex h-[18px] w-[18px] flex-none items-center justify-center transition-opacity ${
                active ? 'opacity-100' : 'opacity-80'
              }`}
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
                  className={`inline-flex h-[18px] w-[18px] flex-none items-center justify-center transition-opacity ${
                    active ? 'opacity-100' : 'opacity-80'
                  }`}
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

const GOLD_FILL = '#D5BB7E';
const GOLD_LINE = '#B9922F';

const SVG = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};
// Duotone: a soft gold filled body + a burnished gold stroke for the linework,
// so the whole rail reads as one crafted, on-brand set rather than flat
// outlines. `F` = the tinted body shape, `L` = the crisp detail strokes.
const F = { fill: GOLD_FILL, fillOpacity: 0.5, stroke: 'none' } as const;
const L = { fill: 'none', stroke: GOLD_LINE, strokeWidth: 1.7 } as const;

function Icon({ children }: { children: React.ReactNode }) {
  return <svg {...SVG}>{children}</svg>;
}

function DashIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="7" height="8.5" rx="1.5" {...F} />
      <rect x="14" y="3" width="7" height="5" rx="1.5" {...F} />
      <rect x="14" y="12.5" width="7" height="8.5" rx="1.5" {...F} />
      <rect x="3" y="16" width="7" height="5" rx="1.5" {...F} />
      <rect x="3" y="3" width="7" height="8.5" rx="1.5" {...L} />
      <rect x="14" y="3" width="7" height="5" rx="1.5" {...L} />
      <rect x="14" y="12.5" width="7" height="8.5" rx="1.5" {...L} />
      <rect x="3" y="16" width="7" height="5" rx="1.5" {...L} />
    </Icon>
  );
}
function SparkIcon() {
  return (
    <Icon>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" {...F} />
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" {...L} />
    </Icon>
  );
}
function MagnifyIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="7" {...F} />
      <circle cx="11" cy="11" r="7" {...L} />
      <path d="M21 21l-4.3-4.3" {...L} />
    </Icon>
  );
}
function CaseIcon() {
  return (
    <Icon>
      <rect x="3" y="7" width="18" height="13" rx="2" {...F} />
      <rect x="3" y="7" width="18" height="13" rx="2" {...L} />
      <path d="M9 7V5.5A2 2 0 0111 3.5h2a2 2 0 012 2V7M3 12h18" {...L} />
    </Icon>
  );
}
function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" {...F} />
      <path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5z" {...F} />
      <circle cx="12" cy="8" r="4" {...L} />
      <path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" {...L} />
    </Icon>
  );
}
function UsersIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.5" {...F} />
      <circle cx="17" cy="9" r="2.5" {...F} />
      <circle cx="9" cy="8" r="3.5" {...L} />
      <circle cx="17" cy="9" r="2.5" {...L} />
      <path d="M3 20c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3" {...L} />
      <path d="M15.5 15.2c2.9-.4 5.5 1.3 5.5 3.9" {...L} />
    </Icon>
  );
}
function DocIcon() {
  return (
    <Icon>
      <path d="M7 3.5h6L18 8v10.5A1.5 1.5 0 0116.5 20h-9A1.5 1.5 0 016 18.5v-13A1.5 1.5 0 017 3.5z" {...F} />
      <path d="M7 3.5h6L18 8v10.5A1.5 1.5 0 0116.5 20h-9A1.5 1.5 0 016 18.5v-13A1.5 1.5 0 017 3.5z" {...L} />
      <path d="M13 3.5V8h5M9 12.5h6M9 15.5h4" {...L} />
    </Icon>
  );
}
function SignIcon() {
  return (
    <Icon>
      <path d="M15 4l5 5-9.5 9.5H5.5V13z" {...F} />
      <path d="M15 4l5 5-9.5 9.5H5.5V13z" {...L} />
      <path d="M12.5 6.5l5 5" {...L} />
    </Icon>
  );
}
function ChatIcon() {
  return (
    <Icon>
      <path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-5.3A8 8 0 1121 12z" {...F} />
      <path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-5.3A8 8 0 1121 12z" {...L} />
    </Icon>
  );
}
function CalIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2.5" {...F} />
      <rect x="3" y="5" width="18" height="16" rx="2.5" {...L} />
      <path d="M3 10h18M8 3v4M16 3v4" {...L} />
    </Icon>
  );
}
function MailIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2.5" {...F} />
      <rect x="3" y="5" width="18" height="14" rx="2.5" {...L} />
      <path d="M4 7.5l8 5.5 8-5.5" {...L} />
    </Icon>
  );
}
function ImportIcon() {
  return (
    <Icon>
      <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15z" {...F} />
      <path d="M12 3v11M7.5 10l4.5 4.5L16.5 10" {...L} />
      <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" {...L} />
    </Icon>
  );
}
function GearIcon() {
  return (
    <Icon>
      <path d="M19.4 13a7.5 7.5 0 000-2l1.9-1.4-1.9-3.3-2.3.9a7.5 7.5 0 00-1.7-1l-.35-2.4h-3.8l-.35 2.4a7.5 7.5 0 00-1.7 1l-2.3-.9L3 9.6 4.9 11a7.5 7.5 0 000 2L3 14.4l1.9 3.3 2.3-.9a7.5 7.5 0 001.7 1l.35 2.4h3.8l.35-2.4a7.5 7.5 0 001.7-1l2.3.9 1.9-3.3z" {...F} />
      <circle cx="12" cy="12" r="2.8" {...L} />
    </Icon>
  );
}
function ChartIcon() {
  return (
    <Icon>
      <rect x="7" y="12" width="3" height="6" rx="1" {...F} />
      <rect x="11.5" y="9" width="3" height="9" rx="1" {...F} />
      <rect x="16" y="6" width="3" height="12" rx="1" {...F} />
      <path d="M4 4v16h16" {...L} />
      <path d="M7 12v6M12.5 9v9M17 6v12" {...L} />
    </Icon>
  );
}
function InboxIcon() {
  return (
    <Icon>
      <path d="M4 13l2.2-7A2 2 0 018.1 4.6h7.8A2 2 0 0117.8 6L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2z" {...F} />
      <path d="M4 13l2.2-7A2 2 0 018.1 4.6h7.8A2 2 0 0117.8 6L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2z" {...L} />
      <path d="M4 13h4l1.2 2h5.6l1.2-2h4" {...L} />
    </Icon>
  );
}
function ContractIcon() {
  return (
    <Icon>
      <path d="M7 3.5h6L18 8v10.5A1.5 1.5 0 0116.5 20h-9A1.5 1.5 0 016 18.5v-13A1.5 1.5 0 017 3.5z" {...F} />
      <path d="M7 3.5h6L18 8v10.5A1.5 1.5 0 0116.5 20h-9A1.5 1.5 0 016 18.5v-13A1.5 1.5 0 017 3.5z" {...L} />
      <path d="M13 3.5V8h5" {...L} />
      <path d="M8.5 16.4c.9-1 1.6.5 2.5 0s1.6.5 2.5 0" {...L} />
    </Icon>
  );
}
function ProjectIcon() {
  return (
    <Icon>
      <rect x="4" y="5" width="4.2" height="14" rx="1.2" {...F} />
      <rect x="10" y="5" width="4.2" height="9" rx="1.2" {...F} />
      <rect x="16" y="5" width="4.2" height="11" rx="1.2" {...F} />
      <rect x="4" y="5" width="4.2" height="14" rx="1.2" {...L} />
      <rect x="10" y="5" width="4.2" height="9" rx="1.2" {...L} />
      <rect x="16" y="5" width="4.2" height="11" rx="1.2" {...L} />
    </Icon>
  );
}
function TemplateIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="2.5" {...F} />
      <rect x="4" y="4" width="16" height="16" rx="2.5" {...L} />
      <path d="M4 9h16M9 9v11" {...L} />
    </Icon>
  );
}
function TimeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8" {...F} />
      <circle cx="12" cy="12" r="8" {...L} />
      <path d="M12 8v4.2l2.8 1.8" {...L} />
    </Icon>
  );
}
function BillingIcon() {
  return (
    <Icon>
      <path d="M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z" {...F} />
      <path d="M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z" {...L} />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" {...L} />
    </Icon>
  );
}
function TrustIcon() {
  return (
    <Icon>
      <path d="M12 3l7 3v5c0 5-3.4 8-7 9-3.6-1-7-4-7-9V6z" {...F} />
      <path d="M12 3l7 3v5c0 5-3.4 8-7 9-3.6-1-7-4-7-9V6z" {...L} />
      <path d="M8.8 12l2.1 2.1 4.3-4.3" {...L} />
    </Icon>
  );
}
function LeadIcon() {
  return (
    <Icon>
      <circle cx="10" cy="8" r="3.5" {...F} />
      <path d="M3.5 20c0-3.4 3-6 6.5-6 1 0 2 .2 2.8.6" {...F} />
      <circle cx="10" cy="8" r="3.5" {...L} />
      <path d="M3.5 20c0-3.4 3-6 6.5-6 1 0 2 .2 2.8.6" {...L} />
      <path d="M18 15v5M15.5 17.5h5" {...L} />
    </Icon>
  );
}
function ReferralIcon() {
  return (
    <Icon>
      <circle cx="6" cy="7" r="2.6" {...F} />
      <circle cx="18" cy="17" r="2.6" {...F} />
      <circle cx="6" cy="7" r="2.6" {...L} />
      <circle cx="18" cy="17" r="2.6" {...L} />
      <path d="M8 8.7l8 6.6" {...L} />
    </Icon>
  );
}
function HelpIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" {...F} />
      <circle cx="12" cy="12" r="8.5" {...L} />
      <path d="M9.6 9.2a2.4 2.4 0 014.7.7c0 1.7-2.3 2-2.3 3.4M12 16.4h.01" {...L} />
    </Icon>
  );
}
