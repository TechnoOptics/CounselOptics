import Link from 'next/link';
import { headers } from 'next/headers';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { listMyFirms } from '@/lib/firm-storage';
import { UserMenuClient } from './UserMenuClient';

export async function UserMenu() {
  if (!isSupabaseConfigured()) {
    return (
      <span
        className="text-xs text-ink-400 hidden sm:inline"
        title="Running in local mode - configure Supabase to enable auth."
      >
        Local mode
      </span>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="inline-flex items-center gap-1 rounded-md bg-cream-200 hover:bg-cream-100 text-forest-900 font-semibold text-[12px] sm:text-sm px-2.5 sm:px-4 py-1 sm:py-1.5 shadow-sm ring-1 ring-cream-100/30 transition-colors whitespace-nowrap"
      >
        Sign in
        <ArrowIcon />
      </Link>
    );
  }

  const [profile, myFirms] = await Promise.all([
    getProfile().catch(() => null),
    listMyFirms().catch(() => []),
  ]);

  const displayName =
    profile?.displayName ||
    (user.user_metadata?.full_name as string | undefined) ||
    user.email ||
    'Account';
  const avatarUrl =
    profile?.avatarUrl || (user.user_metadata?.avatar_url as string | undefined) || null;
  const initials = computeInitials(displayName);

  // Suppress consumer-side links (My cases, Billing) when the user
  // is inside /counsel/*. Counsel users are working on behalf of an
  // organization and should not be tempted back into the personal
  // portal from inside their professional workspace.
  const pathname = headers().get('x-pathname') ?? '';
  const isCounselMode = pathname === '/counsel' || pathname.startsWith('/counsel/');

  return (
    <UserMenuClient
      email={user.email ?? ''}
      displayName={displayName}
      avatarUrl={avatarUrl}
      initials={initials}
      isAdmin={Boolean(profile?.isAdmin)}
      organization={profile?.organization ?? null}
      firmMemberships={myFirms.map((m) => ({
        firmId: m.firm.id,
        firmName: m.firm.name,
        accentColor: m.firm.accentColor,
      }))}
      isCounselMode={isCounselMode}
    />
  );
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
