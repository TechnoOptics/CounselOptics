import Link from 'next/link';
import Image from 'next/image';
import { UserMenu } from '@/components/UserMenu';

type Perspective =
  | 'overview'
  | 'consumer'
  | 'counsel'
  | 'operations'
  | 'security';

const CRUMBS: { id: Perspective; label: string; href: string }[] = [
  { id: 'overview', label: 'Overview', href: '/admin' },
  { id: 'consumer', label: 'Consumer', href: '/admin/consumer' },
  { id: 'counsel', label: 'Counsel', href: '/admin/counsel' },
  { id: 'operations', label: 'Operations', href: '/admin/health' },
  // Promoted from a sub-tab under Operations to its own top-level
  // entry so it lives one click from anywhere in HQ. Security Center
  // is the founder's threat + posture cockpit and is checked daily.
  { id: 'security', label: 'Security Center', href: '/admin/security-center' },
];

/**
 * HQ shell header. Top crumb row picks the perspective; the layout
 * renders the sub-tabs underneath when the active perspective is not
 * the overview.
 */
export function HqHeader({
  perspective,
  pathname: _pathname,
}: {
  perspective: Perspective;
  pathname: string;
}) {
  return (
    // pt-[var(--safe-top)] extends the dark header background up
    // through the iOS notch / dynamic island and Android punch-hole on
    // mobile. With viewport-fit=cover (set globally), the page renders
    // under those cutouts, so without this padding the body's lighter
    // background bleeds through behind the camera area. var(--safe-top)
    // (not raw env()) so Android 15+ edge-to-edge also resolves - see
    // globals.css.
    <header className="sticky top-0 z-20 bg-[#0a1714]/90 backdrop-blur pt-[var(--safe-top)]">
      <div className="px-6 sm:px-10 lg:px-16 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin"
            aria-label="Advottic HQ home"
            className="inline-flex items-center gap-2 min-w-0 group"
          >
            <Image
              src="/advottic-wordmark.png"
              alt="Advottic"
              width={14494}
              height={1699}
              priority
              className="h-6 sm:h-7 w-auto max-w-[52vw] object-contain flex-none block group-hover:opacity-90 transition-opacity"
            />
            <span
              className="hidden sm:inline-block px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.2em] text-cream-100/65 ring-1 ring-cream-100/20"
              aria-hidden
            >
              HQ
            </span>
          </Link>
          <span className="hidden sm:inline-block h-4 w-px bg-white/10" aria-hidden />
          <nav className="hidden sm:flex items-center gap-0.5">
            {CRUMBS.map((c) => {
              const active = c.id === perspective;
              return (
                <Link
                  key={c.id}
                  href={c.href}
                  className={`px-2.5 py-1 rounded-md text-[12.5px] font-medium transition-colors ${
                    active
                      ? 'bg-white/10 text-cream-100'
                      : 'text-cream-100/65 hover:bg-white/5 hover:text-cream-100'
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <UserMenu />
        </div>
      </div>
      <nav className="sm:hidden px-4 py-2 flex items-center gap-1 overflow-x-auto">
        {CRUMBS.map((c) => {
          const active = c.id === perspective;
          return (
            <Link
              key={c.id}
              href={c.href}
              className={`px-2.5 py-1 rounded-md text-[12px] font-medium whitespace-nowrap ${
                active
                  ? 'bg-white/10 text-cream-100'
                  : 'text-cream-100/65 hover:bg-white/5'
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>
      <div className="header-glow-line" aria-hidden />
    </header>
  );
}
