import { redirect } from 'next/navigation';
import { getGuestContext, guestFallbackPath } from '@/lib/counsel-guest';
import { GuestPasswordForm } from '@/components/counsel/GuestPasswordForm';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Set your password · Advottic', robots: { index: false } };
}

/**
 * First-login force-change wall for a firm-provisioned guest. The counsel
 * layout parks a guest with must_change_password here and lets them reach
 * nothing else until it is done. Once set, we send them to their matter.
 */
export default async function GuestPasswordPage() {
  const guest = await getGuestContext();
  if (!guest) redirect('/sign-in');
  // A guest who has already changed their password (or was email-invited and
  // never needed one) doesn't belong on the wall.
  if (!guest.mustChangePassword) redirect(guestFallbackPath(guest));

  // After a successful change, must_change_password is false, so the fallback
  // resolves to their matter.
  const next =
    guest.caseIds.length > 0 ? `/counsel/cases/${guest.caseIds[0]}` : '/counsel/guest';

  return (
    <div className="max-w-md mx-auto mt-6">
      <h1 className="text-2xl text-cream-100">
        <T>Set your password</T>
      </h1>
      <p className="text-sm text-cream-100/70 mt-2 mb-6">
        <T>
          Your firm created this guest access with a temporary password. Choose
          your own password to continue. You will use it to sign in from now on.
        </T>
      </p>
      <div className="card p-6">
        <GuestPasswordForm submitLabel="Set password and continue" redirectTo={next} />
      </div>
    </div>
  );
}
