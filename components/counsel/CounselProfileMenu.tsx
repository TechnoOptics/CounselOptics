import { getCurrentUser } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import type { Firm, FirmMember } from '@/lib/firm-types';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import type { LocaleCode } from '@/lib/i18n/locales';
import { getCounselTheme } from '@/lib/counsel-theme';
import { CounselProfileMenuClient } from './CounselProfileMenuClient';

/**
 * Server wrapper for the Counsel header's consolidated account menu.
 * The active firm / membership / memberships already live on the
 * header (the layout resolves them once), so we take them as props and
 * only fetch the signed-in user's own profile for the avatar + name.
 */
export async function CounselProfileMenu({
  firm,
  membership,
  memberships,
  tenantMode,
  locale,
}: {
  firm: Firm | null;
  membership: FirmMember | null;
  memberships: Array<{ firm: Firm; membership: FirmMember }>;
  tenantMode: boolean;
  locale: LocaleCode;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const profile = await getProfile().catch(() => null);

  const displayName =
    profile?.displayName ||
    (user.user_metadata?.full_name as string | undefined) ||
    user.email ||
    'Account';
  const avatarUrl =
    profile?.avatarUrl ||
    (user.user_metadata?.avatar_url as string | undefined) ||
    null;

  const canPreview = membership?.role === 'owner' || membership?.role === 'admin';

  // Read here rather than threading a prop down from the layout: this is
  // already a server component, the cookie is the single source of the
  // answer, and the header has no other use for it.
  const theme = await getCounselTheme();

  return (
    <CounselProfileMenuClient
      email={user.email ?? ''}
      displayName={displayName}
      avatarUrl={avatarUrl}
      initials={computeInitials(displayName)}
      isAdmin={Boolean(profile?.isAdmin)}
      organization={profile?.organization ?? null}
      activeFirmId={firm?.id ?? null}
      activeFirmName={firm?.name ?? null}
      roleLabel={membership ? FIRM_ROLE_LABEL[membership.role] : null}
      canPreview={canPreview}
      memberships={memberships.map((m) => ({
        firmId: m.firm.id,
        firmName: m.firm.name,
        accentColor: m.firm.accentColor,
      }))}
      tenantMode={tenantMode}
      locale={locale}
      theme={theme}
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
