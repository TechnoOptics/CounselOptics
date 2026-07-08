import Link from 'next/link';
import Image from 'next/image';
import type { Firm, FirmMember } from '@/lib/firm-types';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import { CounselMobileNav } from './CounselMobileNav';
import { CounselProfileMenu } from './CounselProfileMenu';
import {
  applyMenuConfig,
  readMenuConfig,
  withHiddenHrefs,
  TIME_BILLING_HREFS,
} from '@/lib/menu-config';
import { ExternalLink } from '@/components/ExternalLink';
import { T } from '@/components/i18n/LocaleProvider';
import type { LocaleCode } from '@/lib/i18n/locales';

/**
 * Top bar for /counsel/*. Renders the firm logo + name on the left,
 * a firm switcher in the middle (when the user belongs to more than
 * one firm), and a "Back to personal view" link on the right.
 *
 * The header background is intentionally NOT tinted with the firm's
 * accent color. The accent is reserved for buttons + emphasis so the
 * UI always reads as "Advottic with this firm's accent" rather than
 * trying to be a wholesale white-label.
 */
export function CounselHeader({
  firm,
  membership,
  memberships,
  tenantMode = false,
  locale = 'en',
  hideTimeBilling = false,
}: {
  firm: Firm | null;
  membership: FirmMember | null;
  memberships: Array<{ firm: Firm; membership: FirmMember }>;
  /** The user's chosen UI language (#14), for the header switcher. */
  locale?: LocaleCode;
  /** Firm hid the Time & Billing group - keep it out of the mobile nav
   *  too, so the phone experience matches the sidebar. */
  hideTimeBilling?: boolean;
  /**
   * When true, the URL bar already contains the firm's identity
   * (<slug>.advottic.com), so the firm IS the brand. The header flips
   * its hierarchy: firm logo + firm name primary on the left, the
   * Advottic wordmark demoted to a quiet "powered by" mark on the
   * right side. The firm switcher is hidden in tenant mode regardless
   * of how many firms the user belongs to - the URL pins the context.
   *
   * When false (default), the header uses the shared
   * enterprise.advottic.com co-brand: Advottic wordmark primary on
   * the left, firm logo + name as a secondary context pill, with the
   * firm switcher visible if the user belongs to more than one firm.
   */
  tenantMode?: boolean;
}) {
  // Full white-label: the firm uploaded its own logo AND opted to
  // hide the Advottic mark in settings. We then lead with the firm's
  // brand exactly like tenant mode and drop the "powered by" mark.
  const ownBrand =
    Boolean(firm?.logoUrl) &&
    (firm?.metadata as Record<string, unknown> | undefined)
      ?.hideAdvotticLogo === true;
  const brandFirst = tenantMode || ownBrand;
  // Per-firm product label (default "Advottic Enterprise"). The chip
  // next to the wordmark shows the short form ("Enterprise").
  const brandName =
    String(
      (firm?.metadata as Record<string, unknown> | undefined)
        ?.brandName ?? '',
    ).trim() || 'Advottic Enterprise';
  const brandChip =
    brandName.replace(/^advottic\s+/i, '').trim() || brandName;
  // Mobile nav data (the sidebar is hidden below md). Same firm-
  // customized menu the sidebar renders.
  const mobileSections = firm
    ? applyMenuConfig(
        withHiddenHrefs(
          readMenuConfig(firm.metadata),
          hideTimeBilling ? TIME_BILLING_HREFS : [],
        ),
      )
    : [];
  const canSettings =
    membership?.role === 'owner' || membership?.role === 'admin';
  return (
    // pt-[var(--safe-top)] extends the dark header background up
    // through the iOS notch / dynamic island and Android punch-hole on
    // mobile. With viewport-fit=cover (set globally), the page renders
    // under those cutouts, so without this padding the body's lighter
    // background bleeds through behind the camera area. var(--safe-top)
    // (not raw env()) so Android 15+ edge-to-edge also resolves - see
    // globals.css.
    <header className="bg-forest-950/95 backdrop-blur-md sticky top-0 z-30 pt-[var(--safe-top)]">
      <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between gap-3">
        {firm && (
          <CounselMobileNav
            firm={firm}
            sections={mobileSections}
            tenantMode={tenantMode}
            canSettings={canSettings}
          />
        )}
        {brandFirst ? (
          // Firm IS the brand - either a <slug>.advottic.com tenant
          // URL, or the firm turned on full white-label in settings.
          // Big firm logo + name on the left, no Advottic mark.
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={tenantMode ? '/' : '/counsel'}
              className="inline-flex items-center gap-3 min-w-0 group"
              aria-label={`${firm?.name ?? 'Counsel'} home`}
            >
              {firm?.logoUrl ? (
                // Wordmarks are usually rectangular: fixed height, natural
                // width, capped so a wide logo shrinks to fit and is never
                // cropped. eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firm.logoUrl}
                  alt=""
                  className="h-9 w-auto max-w-[150px] object-contain flex-none"
                />
              ) : (
                <span
                  className="h-9 w-9 rounded-md inline-flex items-center justify-center text-white font-semibold text-sm shadow-sm flex-none"
                  style={{ backgroundColor: firm?.accentColor || '#0f2d24' }}
                  aria-hidden
                >
                  {firm ? firm.name.slice(0, 1).toUpperCase() : 'A'}
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-base font-semibold text-cream-100 truncate max-w-[40vw] sm:max-w-[28ch] leading-tight">
                  {firm?.name ?? 'Counsel'}
                </span>
                {membership && (
                  <span className="block text-[10px] uppercase tracking-[0.18em] font-semibold text-cream-100/55 leading-tight mt-0.5">
                    <T>{FIRM_ROLE_LABEL[membership.role]}</T>
                  </span>
                )}
              </span>
            </Link>
          </div>
        ) : (
          // Shared-portal mode (enterprise.advottic.com): Advottic
          // wordmark anchors brand, firm context lives in the
          // secondary pill cluster.
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/counsel"
              className="inline-flex items-center gap-2 min-w-0 group"
              aria-label={`${brandName} home`}
            >
              <Image
                src="/advottic-wordmark.png"
                alt="Advottic"
                width={14494}
                height={1699}
                priority
                className="h-6 sm:h-7 w-auto max-w-[35vw] block group-hover:opacity-90 transition-opacity"
              />
              <span
                className="hidden sm:inline-block px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-300 ring-1 ring-gold-300/30"
                aria-hidden
              >
                {brandChip}
              </span>
            </Link>
            <span className="hidden sm:inline-block h-5 w-px bg-cream-100/15" aria-hidden />
            <div className="flex items-center gap-2 min-w-0">
              {firm?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firm.logoUrl}
                  alt=""
                  className="h-7 w-auto max-w-[120px] object-contain flex-none"
                />
              ) : (
                <span
                  className="h-7 w-7 rounded-md inline-flex items-center justify-center text-white font-semibold text-xs shadow-sm flex-none"
                  style={{ backgroundColor: firm?.accentColor || '#0f2d24' }}
                  aria-hidden
                >
                  {firm ? firm.name.slice(0, 1).toUpperCase() : 'A'}
                </span>
              )}
              <span className="text-sm font-semibold text-cream-100 truncate max-w-[36vw] sm:max-w-[24ch]">
                {firm ? firm.name : <T>Set up your firm</T>}
              </span>
            </div>
            {membership && (
              <span className="hidden sm:inline-flex badge bg-forest-800 text-cream-100/85 text-[10px]">
                <T>{FIRM_ROLE_LABEL[membership.role]}</T>
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* "Powered by Advottic" mark in tenant mode - quiet, half
              opacity, on the right next to the account menu so the
              platform identity is acknowledged without competing with
              the firm's brand. */}
          {tenantMode && !ownBrand && (
            <ExternalLink
              href="https://advottic.com"
              className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-cream-100/60 hover:text-cream-100/75 transition-colors"
              aria-label="Powered by Advottic"
            >
              <span>Powered by</span>
              <Image
                src="/advottic-wordmark.png"
                alt="Advottic"
                width={14494}
                height={1699}
                className="h-4 w-auto opacity-70"
              />
            </ExternalLink>
          )}
          {/* Consolidated account menu. The firm/owner switcher, the
              "View as" persona preview, the language picker, and the
              token balance all live inside this one dropdown now - the
              header bar shows nothing but the initials avatar. */}
          <CounselProfileMenu
            firm={firm}
            membership={membership}
            memberships={memberships}
            tenantMode={tenantMode}
            locale={locale}
          />
        </div>
      </div>
      {/* Decorative glow strip under the header. On a tenant subdomain
          (tenantMode=true) it picks up the firm's accent color via the
          --firm-accent CSS variable that the counsel layout sets from
          firms.accent_color. On the shared enterprise.advottic.com
          portal it falls through to the regular gold strip so the
          surface stays in the Advottic brand family.
          Text colors stay hard-coded cream/gold in BOTH modes - the
          accent only paints the strip, never type, so a firm whose
          accent happens to match the dark forest background can still
          read every label. */}
      <div
        className={tenantMode ? 'header-glow-line-tenant' : 'header-glow-line'}
        aria-hidden
      />
    </header>
  );
}
