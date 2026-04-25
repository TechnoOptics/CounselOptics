import Link from 'next/link';
import Image from 'next/image';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';

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
    <Link
      href="/profile"
      className="flex items-center gap-2.5 pl-2 pr-1 py-1 rounded-full hover:bg-ink-100 transition-colors"
      aria-label="Open profile"
      title={displayName}
    >
      <span className="hidden md:inline text-sm text-ink-700 max-w-[160px] truncate">
        {displayName}
      </span>
      <Avatar avatarUrl={avatarUrl} initials={initials} />
    </Link>
  );
}

function Avatar({
  avatarUrl,
  initials,
}: {
  avatarUrl: string | null;
  initials: string;
}) {
  if (avatarUrl) {
    return (
      <span className="relative inline-block h-8 w-8 overflow-hidden rounded-full border border-ink-200 bg-ink-100">
        {/* Using <img> to avoid next/image host configuration for arbitrary OAuth avatar URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-950 text-white text-[12px] font-semibold tracking-tight">
      {initials}
    </span>
  );
}

function computeInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'CO';
  if (clean.includes('@')) {
    return clean.slice(0, 2).toUpperCase();
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
  return letters.slice(0, 2).toUpperCase() || clean.slice(0, 2).toUpperCase();
}
