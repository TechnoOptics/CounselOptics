import Link from 'next/link';
import Image from 'next/image';
import type { Firm } from '@/lib/firm-types';
import { T } from '@/components/i18n/LocaleProvider';
import { CounselGuestMenu } from './CounselGuestMenu';

/**
 * Header for the case-scoped Counsel GUEST shell. Mirrors the co-brand of the
 * full CounselHeader (Advottic wordmark + the firm's mark/name) so the guest
 * sees the firm they're working with, but carries NONE of the workspace
 * navigation - a guest can only reach their own matter(s). The only home link
 * is the guest landing, and the account menu is the stripped CounselGuestMenu.
 */
export function CounselGuestHeader({
  firm,
  homeHref,
  displayName,
  email,
}: {
  firm: Firm | null;
  homeHref: string;
  displayName: string;
  email: string;
}) {
  return (
    <header className="bg-forest-950/95 backdrop-blur-md sticky top-0 z-30 pt-[var(--safe-top)]">
      <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={homeHref}
            className="inline-flex items-center gap-2 min-w-0 group"
            aria-label="Home"
          >
            <Image
              src="/advottic-wordmark.png"
              alt="Advottic"
              width={14494}
              height={1699}
              priority
              className="h-6 sm:h-7 w-auto max-w-[35vw] block group-hover:opacity-90 transition-opacity"
            />
          </Link>
          {firm && (
            <>
              <span className="hidden sm:inline-block h-5 w-px bg-cream-100/15" aria-hidden />
              <div className="flex items-center gap-2 min-w-0">
                {firm.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={firm.logoUrl}
                    alt=""
                    className="h-7 w-auto max-w-[120px] object-contain flex-none"
                  />
                ) : (
                  <span
                    className="h-7 w-7 rounded-md inline-flex items-center justify-center text-white font-semibold text-xs shadow-sm flex-none"
                    style={{ backgroundColor: firm.accentColor || '#0f2d24' }}
                    aria-hidden
                  >
                    {firm.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span
                  className="text-sm font-semibold text-cream-100 truncate max-w-[36vw] sm:max-w-[24ch]"
                  data-no-translate
                >
                  {firm.name}
                </span>
              </div>
            </>
          )}
          <span className="hidden sm:inline-flex badge bg-forest-800 text-cream-100/85 text-[10px]">
            <T>Guest</T>
          </span>
        </div>
        <CounselGuestMenu
          displayName={displayName}
          email={email}
          initials={computeInitials(displayName || email)}
        />
      </div>
      <div className="header-glow-line" aria-hidden />
    </header>
  );
}

function computeInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'CO';
  if (clean.includes('@')) return clean.slice(0, 2).toUpperCase();
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
  return letters.slice(0, 2).toUpperCase() || clean.slice(0, 2).toUpperCase();
}
