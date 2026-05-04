import Link from 'next/link';
import Image from 'next/image';
import type { Firm, FirmMember } from '@/lib/firm-types';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import { CounselFirmSwitcher } from './CounselFirmSwitcher';
import { UserMenu } from '@/components/UserMenu';

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
}: {
  firm: Firm | null;
  membership: FirmMember | null;
  memberships: Array<{ firm: Firm; membership: FirmMember }>;
}) {
  return (
    // pt-[env(safe-area-inset-top)] extends the dark header background up
    // through the iOS notch / dynamic island and Android punch-hole on
    // mobile. With viewport-fit=cover (set globally), the page renders
    // under those cutouts, so without this padding the body's lighter
    // background bleeds through behind the camera area.
    <header className="border-b border-forest-700/50 bg-forest-950/95 backdrop-blur-md sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/counsel"
            className="inline-flex items-center gap-2 min-w-0 group"
            aria-label="Advottic Counsel home"
          >
            {/* Advottic wordmark anchors the brand identity across every
                portal. The firm's own logo + name appear as a secondary
                context pill to the right - co-branded, with Advottic
                primary so the platform identity stays recognizable
                even when the firm has heavy custom theming. */}
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
              Counsel
            </span>
          </Link>
          <span className="hidden sm:inline-block h-5 w-px bg-cream-100/15" aria-hidden />
          <div className="flex items-center gap-2 min-w-0">
            {firm?.logoUrl ? (
              <Image
                src={firm.logoUrl}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-md object-cover ring-1 ring-forest-700/60 flex-none"
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
              {firm ? firm.name : 'Set up your firm'}
            </span>
          </div>
          {membership && (
            <span className="hidden sm:inline-flex badge bg-forest-800 text-cream-100/85 text-[10px]">
              {FIRM_ROLE_LABEL[membership.role]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <CounselFirmSwitcher
              activeFirmId={firm?.id ?? null}
              memberships={memberships}
            />
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
