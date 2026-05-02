import Link from 'next/link';
import { UserMenu } from '@/components/UserMenu';

type Perspective = 'overview' | 'consumer' | 'counsel' | 'operations';

const CRUMBS: { id: Perspective; label: string; href: string }[] = [
  { id: 'overview', label: 'Overview', href: '/admin' },
  { id: 'consumer', label: 'Consumer', href: '/admin/consumer' },
  { id: 'counsel', label: 'Counsel', href: '/admin/counsel' },
  { id: 'operations', label: 'Operations', href: '/admin/health' },
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
    <header className="sticky top-0 z-20 bg-[#0a1714]/90 backdrop-blur">
      <div className="px-6 sm:px-10 lg:px-16 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin"
            className="font-display text-[18px] tracking-tight text-cream-100 hover:opacity-90 truncate"
          >
            Advottic <span className="text-cream-100/60">HQ</span>
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
