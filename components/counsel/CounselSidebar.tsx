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
import {
  BillingIcon,
  CalIcon,
  CaseIcon,
  ChartIcon,
  ChatIcon,
  ContractIcon,
  DocIcon,
  GearIcon,
  HelpIcon,
  ImportIcon,
  InboxIcon,
  IntakeIcon,
  KeyIcon,
  LeadIcon,
  MagnifyIcon,
  MailIcon,
  ProjectIcon,
  ReferralIcon,
  SignIcon,
  SparkIcon,
  TemplateIcon,
  TimeIcon,
  TrustIcon,
  UserIcon,
  UsersIcon,
  DashIcon,
} from '@/components/counsel/icons';

// Icons are keyed by href; the glyph geometry itself lives in
// components/counsel/icons.tsx, and the menu DATA + the firm's
// hide/rename/reorder customization live in lib/menu-config.ts so the
// settings editor and this server-rendered rail share one source of
// truth. Unknown href -> a neutral default glyph.
const ICONS: Record<string, React.ReactNode> = {
  '/counsel': <DashIcon />,
  '/counsel/analytics': <ChartIcon />,
  '/counsel/aid': <SparkIcon />,
  '/counsel/calendar': <CalIcon />,
  '/counsel/import': <ImportIcon />,
  '/counsel/inbox': <InboxIcon />,
  '/counsel/intake': <IntakeIcon />,
  '/counsel/templates': <TemplateIcon />,
  '/counsel/forms': <DocIcon />,
  '/counsel/policies': <ContractIcon />,
  '/counsel/letters': <MailIcon />,
  '/counsel/analyze': <MagnifyIcon />,
  '/counsel/cases': <CaseIcon />,
  '/counsel/documents': <DocIcon />,
  '/counsel/contracts': <ContractIcon />,
  '/counsel/projects': <ProjectIcon />,
  '/counsel/signing': <SignIcon />,
  '/counsel/clients': <UserIcon />,
  '/counsel/employees': <UsersIcon />,
  '/counsel/access': <KeyIcon />,
  '/counsel/team': <UsersIcon />,
  '/counsel/chat': <ChatIcon />,
  '/counsel/leads': <LeadIcon />,
  '/counsel/referrals': <ReferralIcon />,
  '/counsel/time': <TimeIcon />,
  '/counsel/billing': <BillingIcon />,
  '/counsel/trust': <TrustIcon />,
  '/counsel/help': <HelpIcon />,
};

// Nav row treatment. The active row carries exactly three signals:
// background tint, a border, and a heavier weight. It used to stack a
// fourth (a ring on top of a left border), which read as two competing
// outlines on the same 1px edge.
//
// `border border-transparent` on the idle row is load-bearing: without
// it the row gains a border only when it becomes active and every
// sibling shifts a pixel on navigation.
const NAV_ROW_BASE =
  'flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-sm transition-colors border';
const NAV_ROW_ACTIVE = `${NAV_ROW_BASE} font-semibold text-forest-900 dark:text-gold-200 bg-forest-900/10 dark:bg-gold-500/15 border-forest-900/20 dark:border-gold-500/30`;
const NAV_ROW_IDLE = `${NAV_ROW_BASE} border-transparent text-ink-800 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/60 hover:text-forest-900 dark:hover:text-cream-100`;

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
            className={active ? NAV_ROW_ACTIVE : NAV_ROW_IDLE}
          >
            {/* Duotone gold glyphs (soft gold body + burnished gold line), a
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
                className={active ? NAV_ROW_ACTIVE : NAV_ROW_IDLE}
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
