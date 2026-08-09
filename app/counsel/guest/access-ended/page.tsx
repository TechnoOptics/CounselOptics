import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { listMyFirms } from '@/lib/firm-storage';
import {
  getGuestContext,
  guestFallbackPath,
  resolveEndedGuestAccess,
} from '@/lib/counsel-guest';
import { LocaleProvider, T } from '@/components/i18n/LocaleProvider';
import { getLocaleCookie } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Access has ended',
  robots: { index: false, follow: false },
};

/**
 * Where an outside attorney lands when a firm ends their access to a matter.
 *
 * They used to land on /counsel/request, which opens "Counsel is invitation
 * only" and asks them to tell us about their team. Someone who was working a
 * matter yesterday was shown a pitch, and nothing anywhere said their access
 * had ended. This page says the one thing they need to know and offers the one
 * thing they can do.
 *
 * It renders its OWN shell and app/counsel/layout.tsx short-circuits before
 * its gates for this path, for the same load-bearing reason
 * /counsel/access-ended does: a page inside the gated set would redirect to
 * itself. The cost of sitting outside the gates is that anyone can open the
 * URL, so the two people who should not read it are turned away here: a firm
 * member goes to the workspace, and a guest who still has a live matter goes
 * to it.
 *
 * There is no "ask for it back" control, because there is no such mechanism.
 * Re-granting access is the firm adding them to the matter again, which
 * happens on the firm's side and produces a fresh invitation.
 */
export default async function GuestAccessEndedPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/guest/access-ended');

  // Anyone who still has access is sent to it rather than told it ended.
  const myFirms = await listMyFirms();
  if (myFirms.length > 0) redirect('/counsel');
  const liveGuest = await getGuestContext();
  if (liveGuest) redirect(guestFallbackPath(liveGuest));

  const ended = await resolveEndedGuestAccess(user);
  const locale = await getLocaleCookie();

  return (
    <LocaleProvider initialLocale={locale}>
      <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
        <div className="popup-panel w-full max-w-lg space-y-4 p-8">
          {ended?.firmName ? (
            <p className="eyebrow" data-no-translate>
              {ended.firmName}
            </p>
          ) : null}
          <h1 className="text-2xl font-medium text-cream-100">
            <T>Your access to this matter has ended</T>
          </h1>
          <p className="text-sm leading-relaxed text-cream-100/75">
            {ended?.firmName ? (
              <T>
                The organization that invited you has ended your access, so the
                matter is no longer open to you here. Everything you added to it
                stays with them.
              </T>
            ) : (
              <T>
                Your access to the matter you were invited to has ended, so it
                is no longer open to you here. Everything you added to it stays
                with the organization that invited you.
              </T>
            )}
          </p>
          <p className="text-sm leading-relaxed text-cream-100/75">
            <T>
              If you were expecting to still have access, speak to the person at
              the organization who invited you. They can add you to the matter
              again.
            </T>
          </p>
          <form action="/auth/sign-out" method="post" className="pt-1">
            <button
              type="submit"
              className="btn w-full justify-center text-cream-100/70 hover:bg-cream-100/5 hover:text-cream-100"
            >
              <T>Sign out</T>
            </button>
          </form>
        </div>
      </div>
    </LocaleProvider>
  );
}
