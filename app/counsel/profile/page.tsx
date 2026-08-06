import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { isPhoneVerifyConfigured } from '@/lib/phone-verify';
import { AccountPanel } from './account-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your account · Counsel' };

/**
 * The account page for a member of a firm.
 *
 * It exists because /profile is a CONSUMER page in two separate ways.
 * First it is themed for the consumer app: it renders under the root
 * layout, which paints the cream-and-forest chrome, the consumer
 * sidebar and the marketing footer, so opening it from the firm header
 * dropped an attorney into what looked like a different product.
 * Second, and less obvious, most of what it holds is not for them:
 * Safe Witness contacts, Wear OS pairing, "install the app", the
 * sign-up arbitration record, and a Pro upsell for receiving documents
 * FROM law firms. An attorney at a firm is the sender, not the
 * recipient.
 *
 * So this is not a re-skin. It is the same account, shown with the
 * sections that apply to somebody working a matter: who they are on
 * exported work product, how they sign in, and their data rights. The
 * controls themselves are imported from /app/profile so there is one
 * implementation of each.
 *
 * Theme and language are deliberately absent. The firm workspace is
 * always dark by design (see .counsel-shell in globals.css) so a theme
 * picker here would be a control that does nothing, and the language
 * picker already sits in the header menu one click away.
 */
export default async function CounselAccountPage() {
  if (!isSupabaseConfigured()) redirect('/counsel');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/profile');

  const [profile, ctx] = await Promise.all([
    getProfile().catch(() => null),
    getActiveFirmContext(),
  ]);

  const fallbackName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    '';

  return (
    <AccountPanel
      userId={user.id}
      email={user.email ?? ''}
      displayName={profile?.displayName ?? fallbackName ?? ''}
      role={profile?.role ?? ''}
      organization={profile?.organization ?? ''}
      avatarUrl={
        profile?.avatarUrl ||
        (user.user_metadata?.avatar_url as string | undefined) ||
        null
      }
      firmName={ctx?.firm.name ?? null}
      firmRoleLabel={ctx?.membership.role ?? null}
      verifiedPhone={profile?.phoneNumber ?? null}
      phoneVerifiedAt={profile?.phoneVerifiedAt ?? null}
      phoneVerifyConfigured={isPhoneVerifyConfigured()}
    />
  );
}
