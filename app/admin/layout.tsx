import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isCurrentUserAdmin, isSupabaseConfigured } from '@/lib/supabase/server';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Advottic HQ - the founder/owner cockpit that owns BOTH the consumer
 * Advottic app AND Advottic Counsel. Three nav groups:
 *   - Overview: cross-product KPIs and feedback stream
 *   - Consumer: user management, cases, subscriptions
 *   - Counsel: firms, requests, outbound invitations
 *   - Operations: health, raw counts
 */
export default async function HqLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Advottic HQ</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          The HQ console requires Supabase. See <code className="font-mono">SETUP.md</code>.
        </p>
      </div>
    );
  }

  const admin = await isCurrentUserAdmin();
  if (!admin) {
    redirect('/cases');
  }

  if (!isServiceRoleConfigured()) {
    return (
      <div className="max-w-2xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Advottic HQ</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          You're an admin, but the server is missing the{' '}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> environment variable. Add
          it (Supabase Dashboard, Project Settings, API, "service_role" key) to enable HQ.
          The service-role key must never be exposed to the browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Advottic HQ</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
            Business cockpit
          </h1>
          <p className="text-sm text-ink-500 dark:text-cream-100/60 mt-1 max-w-2xl">
            Founder console for the consumer app and Advottic Counsel.
            Manage users, firms, billing, requests, and feedback in one place.
          </p>
        </div>
      </header>

      <nav className="border-b border-ink-200 dark:border-forest-700/40 -mx-1">
        <div className="flex flex-col gap-2 pb-1">
          <NavGroup label="Overview">
            <HqTab href="/admin">Dashboard</HqTab>
            <HqTab href="/admin/feedback">Feedback</HqTab>
          </NavGroup>
          <NavGroup label="Consumer">
            <HqTab href="/admin/users">Users</HqTab>
            <HqTab href="/admin/cases">Cases</HqTab>
          </NavGroup>
          <NavGroup label="Counsel">
            <HqTab href="/admin/firms">Active firms</HqTab>
            <HqTab href="/admin/counsel-requests">Access requests</HqTab>
            <HqTab href="/admin/invitations">Outbound invites</HqTab>
          </NavGroup>
          <NavGroup label="Operations">
            <HqTab href="/admin/health">Health</HqTab>
          </NavGroup>
        </div>
      </nav>
      <div>{children}</div>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-400 dark:text-cream-100/45 px-2 min-w-[78px]">
        {label}
      </span>
      {children}
    </div>
  );
}

function HqTab({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-[13px] font-medium text-ink-600 dark:text-cream-100/70 hover:text-ink-950 dark:hover:text-cream-100 hover:bg-ink-50/60 dark:hover:bg-forest-800/40 rounded-md transition-colors"
    >
      {children}
    </Link>
  );
}
