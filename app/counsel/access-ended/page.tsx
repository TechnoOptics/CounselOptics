import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext, listMyFirms } from '@/lib/firm-storage';
import { callerHasFirmRole, FIRM_ADMIN_ROLES } from '@/lib/firm-authz';
import { LocaleProvider, T } from '@/components/i18n/LocaleProvider';
import { getLocaleCookie } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Access has ended',
  robots: { index: false, follow: false },
};

/**
 * Where an organization whose access has ended lands.
 *
 * This page renders its OWN shell and resolves its own signed-in user, and
 * app/counsel/layout.tsx short-circuits before its firm gates for exactly this
 * path. That is deliberate and it is the load-bearing half of the allowlist:
 * a page inside the gated set would redirect to itself forever, and an
 * organization that can never land is an organization that can never reach the
 * data this whole design exists to preserve. It also means a Hub employee sent
 * here from app/portal/layout.tsx arrives instead of being bounced onward by
 * the counsel firm-membership gate.
 *
 * There is no access check on this page, on purpose. It says the same thing to
 * an organization that is still active, which is harmless, and it can never
 * refuse anybody the one route out.
 *
 * The copy is a correctness requirement rather than a style preference.
 * Nothing here says or implies that anything will be deleted, because under
 * this design nothing is: the organization keeps its data and can download it.
 */
export default async function CounselAccessEndedPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/access-ended');

  // Same resolution the counsel layout uses: the active firm, falling back to
  // the first membership when profiles.active_firm_id is unset.
  const active = (await getActiveFirmContext()) ?? (await listMyFirms())[0] ?? null;

  // Owner and admin only, through lib/firm-authz.ts rather than a fourth
  // membership check. An organization-wide export holds every matter, document
  // and client name the firm has; in a departing paralegal's hands that is a
  // data loss incident, not an offboarding feature.
  const canExport = active
    ? await callerHasFirmRole(active.firm.id, FIRM_ADMIN_ROLES)
    : false;

  const locale = await getLocaleCookie();

  return (
    <LocaleProvider initialLocale={locale}>
      <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
        <div className="popup-panel max-w-lg w-full p-8 space-y-4">
          {active ? (
            <p className="eyebrow" data-no-translate>
              {active.firm.name}
            </p>
          ) : null}
          <h1 className="font-display text-2xl font-medium text-cream-100">
            <T>Your organization&rsquo;s access has ended</T>
          </h1>
          <p className="text-sm text-cream-100/75 leading-relaxed">
            {canExport ? (
              <T>
                You can still download everything your organization has in
                Advottic. Your data is not being deleted.
              </T>
            ) : (
              <T>
                An owner or an administrator at your organization can download
                your data. Speak to them if you need something from here.
              </T>
            )}
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {canExport ? (
              <Link
                href="/api/firm/export"
                className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
              >
                <T>Download your organization&rsquo;s data</T>
              </Link>
            ) : null}
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="btn w-full text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5 justify-center"
              >
                <T>Sign out</T>
              </button>
            </form>
          </div>
        </div>
      </div>
    </LocaleProvider>
  );
}
