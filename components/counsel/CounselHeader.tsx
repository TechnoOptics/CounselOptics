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
    <header className="border-b border-forest-700/50 bg-forest-950/95 backdrop-blur-md sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/counsel"
            className="flex items-center gap-2.5 min-w-0 group"
            aria-label="Counsel home"
          >
            {firm?.logoUrl ? (
              <Image
                src={firm.logoUrl}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-md object-cover ring-1 ring-ink-200 dark:ring-forest-700/60"
              />
            ) : (
              <span
                className="h-8 w-8 rounded-md inline-flex items-center justify-center text-white font-semibold text-sm shadow-sm"
                style={{ backgroundColor: firm?.accentColor || '#0f2d24' }}
                aria-hidden
              >
                {firm ? firm.name.slice(0, 1).toUpperCase() : 'A'}
              </span>
            )}
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-[0.18em] font-semibold text-gold-300 leading-none">
                Counsel
              </span>
              <span className="block text-sm font-semibold text-cream-100 truncate max-w-[40vw] sm:max-w-[28ch]">
                {firm ? firm.name : 'Set up your firm'}
              </span>
            </span>
          </Link>
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
