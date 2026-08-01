import Link from 'next/link';
import { headers } from 'next/headers';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { listMyFirms } from '@/lib/firm-storage';
import { isPrerenderedRender } from '@/lib/prerender';
import { HeaderArrowIcon, HeaderAuthProbe, HEADER_LINK_CLASS } from './HeaderAuthProbe';
import { UserMenuClient } from './UserMenuClient';
import type { LocaleCode } from '@/lib/i18n/locales';

export async function UserMenu({
  languageLocale,
}: { languageLocale?: LocaleCode } = {}) {
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
    // Already on the auth screen (which shows the OAuth options)?
    // A "Sign in" button in the header that points back to the page
    // you're on is dead weight - hide it there.
    const xPathname = headers().get('x-pathname');
    const pathname = xPathname ?? '';
    if (pathname === '/sign-in' || pathname.startsWith('/sign-in')) {
      return null;
    }
    // No x-pathname means there was no request: this is the build-time
    // prerender of a `force-static` route (guides, /es/*, glossary, tools,
    // templates), where cookies() is stubbed out and `user` is null even
    // for a signed-in reader. Let the client settle it instead of shipping
    // a "Sign in" button to someone who is already signed in. Checked AFTER
    // the /sign-in suppression so that a future static auth screen keeps it.
    if (isPrerenderedRender(xPathname)) {
      return <HeaderAuthProbe />;
    }
    return (
      <Link href="/sign-in" className={HEADER_LINK_CLASS}>
        Sign in
        <HeaderArrowIcon />
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
  // is inside /counsel/* OR inside the HQ console at /admin/*.
  // Counsel users are working on behalf of an organization, and HQ
  // admins are operating the business - neither should be tempted
  // back into the personal portal from inside their professional
  // workspace. The flag is named `isCounselMode` for legacy reasons;
  // it really means "in any non-consumer shell".
  const pathname = headers().get('x-pathname') ?? '';
  const isHqMode = pathname === '/admin' || pathname.startsWith('/admin/');
  const isCounselMode =
    pathname === '/counsel' ||
    pathname.startsWith('/counsel/') ||
    isHqMode;

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
      isHqMode={isHqMode}
      languageLocale={languageLocale}
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
