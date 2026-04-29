import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isCurrentUserAdmin, isSupabaseConfigured } from '@/lib/supabase/server';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';
import { HqHeader } from '@/components/hq/HqHeader';

export const dynamic = 'force-dynamic';

type Perspective = 'overview' | 'consumer' | 'counsel' | 'operations';

const CONSUMER_PATHS = new Set([
  '/admin/consumer',
  '/admin/users',
  '/admin/cases',
  '/admin/feedback',
]);
const COUNSEL_PATHS = new Set([
  '/admin/counsel',
  '/admin/firms',
  '/admin/counsel-requests',
  '/admin/invitations',
]);
const OPERATIONS_PATHS = new Set(['/admin/health', '/admin/crashes']);

function detectPerspective(pathname: string): Perspective {
  if (pathname === '/admin') return 'overview';
  if (CONSUMER_PATHS.has(pathname) || pathname.startsWith('/admin/consumer/')) return 'consumer';
  if (COUNSEL_PATHS.has(pathname) || pathname.startsWith('/admin/counsel/')) return 'counsel';
  if (OPERATIONS_PATHS.has(pathname)) return 'operations';
  return 'overview';
}

/**
 * Advottic HQ shell. The founder's executive cockpit, premium dark.
 * Lives at /admin/* and explicitly does NOT inherit consumer chrome
 * (header, sidebar, footer, Bella, trial banner) - app/layout.tsx
 * detects /admin/* and skips them.
 *
 * Two-tier nav:
 *   - Top crumbs: Overview / Consumer / Counsel / Operations
 *   - Subnav: only the relevant tabs for the current perspective
 *
 * The /admin landing has no subnav - just the dashboard with the
 * "pick your side" entry cards.
 */
export default async function HqLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <ShellFrame>
        <div className="max-w-xl mx-auto card p-8 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-cream-100">
            Advottic HQ
          </h1>
          <p className="text-sm text-cream-100/70 leading-relaxed">
            HQ requires Supabase. See <code className="font-mono">SETUP.md</code>.
          </p>
        </div>
      </ShellFrame>
    );
  }
  const admin = await isCurrentUserAdmin();
  if (!admin) redirect('/cases');
  if (!isServiceRoleConfigured()) {
    return (
      <ShellFrame>
        <div className="max-w-2xl mx-auto card p-8 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-cream-100">
            Advottic HQ
          </h1>
          <p className="text-sm text-cream-100/70 leading-relaxed">
            You're an admin, but the server is missing the{' '}
            <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>. Add it
            (Supabase Dashboard, Project Settings, API, "service_role" key) to enable
            HQ. The service-role key must never reach the browser.
          </p>
        </div>
      </ShellFrame>
    );
  }

  const pathname = headers().get('x-pathname') ?? '/admin';
  const perspective = detectPerspective(pathname);

  return (
    <ShellFrame>
      <HqHeader perspective={perspective} pathname={pathname} />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6 sm:py-8">
        {perspective !== 'overview' && (
          <PerspectiveSubnav perspective={perspective} pathname={pathname} />
        )}
        <div>{children}</div>
      </main>
      <footer className="border-t border-white/5 bg-black/40 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 text-[11px] text-cream-100/50 flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-semibold text-cream-100">Advottic HQ</span> ·
            Business cockpit
          </p>
          <p>Powered by Techno Optics LLC</p>
        </div>
      </footer>
    </ShellFrame>
  );
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark hq-shell min-h-screen flex flex-col text-cream-100">
      {children}
    </div>
  );
}

function PerspectiveSubnav({
  perspective,
  pathname,
}: {
  perspective: Exclude<Perspective, 'overview'>;
  pathname: string;
}) {
  const tabs: { href: string; label: string }[] =
    perspective === 'consumer'
      ? [
          { href: '/admin/consumer', label: 'Overview' },
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/cases', label: 'Cases' },
          { href: '/admin/feedback', label: 'Feedback' },
        ]
      : perspective === 'counsel'
        ? [
            { href: '/admin/counsel', label: 'Overview' },
            { href: '/admin/firms', label: 'Firms' },
            { href: '/admin/counsel-requests', label: 'Requests' },
            { href: '/admin/invitations', label: 'Invitations' },
          ]
        : [
            { href: '/admin/health', label: 'System health' },
            { href: '/admin/crashes', label: 'Crash reports' },
          ];

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-white/5 -mx-1 pb-1">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
              active
                ? 'bg-white/8 text-cream-100'
                : 'text-cream-100/65 hover:text-cream-100 hover:bg-white/5'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
