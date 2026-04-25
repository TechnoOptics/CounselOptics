import Link from 'next/link';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { UserMenuClient } from './UserMenuClient';

export async function UserMenu() {
  if (!isSupabaseConfigured()) {
    return (
      <span
        className="text-xs text-ink-400 hidden sm:inline"
        title="Running in local mode — configure Supabase to enable auth."
      >
        Local mode
      </span>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href="/sign-in" className="btn-ghost">
        Sign in
      </Link>
    );
  }

  const profile = await getProfile().catch(() => null);

  const displayName =
    profile?.displayName ||
    (user.user_metadata?.full_name as string | undefined) ||
    user.email ||
    'Account';
  const avatarUrl =
    profile?.avatarUrl || (user.user_metadata?.avatar_url as string | undefined) || null;
  const initials = computeInitials(displayName);

  return (
    <UserMenuClient
      email={user.email ?? ''}
      displayName={displayName}
      avatarUrl={avatarUrl}
      initials={initials}
      isAdmin={Boolean(profile?.isAdmin)}
      organization={profile?.organization ?? null}
    />
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
