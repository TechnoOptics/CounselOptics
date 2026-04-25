import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isCurrentUserAdmin, isSupabaseConfigured } from '@/lib/supabase/server';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          The admin dashboard requires Supabase. See <code className="font-mono">SETUP.md</code>.
        </p>
      </div>
    );
  }

  // Consent is handled by the layout's popup modal; no redirect here.
  const admin = await isCurrentUserAdmin();
  if (!admin) {
    redirect('/cases');
  }

  if (!isServiceRoleConfigured()) {
    return (
      <div className="max-w-2xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          You're an admin, but the server is missing the{' '}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> environment variable. Add
          it (Supabase Dashboard → Project Settings → API → "service_role" key) to enable the
          admin views. Service role key must never be exposed to the browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-950">Operations</h1>
      </div>
      <nav className="border-b border-ink-200 -mx-1">
        <div className="flex items-stretch gap-0.5 overflow-x-auto">
          <AdminTab href="/admin">Dashboard</AdminTab>
          <AdminTab href="/admin/users">Users</AdminTab>
          <AdminTab href="/admin/cases">All cases</AdminTab>
        </div>
      </nav>
      <div>{children}</div>
    </div>
  );
}

function AdminTab({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-4 py-2.5 text-sm font-medium text-ink-600 hover:text-ink-950 hover:bg-ink-50/60 rounded-md transition-colors"
    >
      {children}
    </Link>
  );
}
