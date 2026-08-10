import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext, listMyFirms } from '@/lib/firm-storage';
import { setActiveFirmAction } from '@/lib/firm-actions';
import { callerFirmRoleLookup, FIRM_ADMIN_ROLES } from '@/lib/firm-authz';
import { ACCESS_ENDED_PATH } from '@/lib/firm-access';
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
/**
 * The way out for someone who belongs to more than one organization.
 *
 * THE LOCKOUT THIS CLOSES. The counsel layout gates on the ACTIVE firm, so
 * once that one is export_only every /counsel/* route redirects here, and this
 * page renders its own shell with no CounselHeader. The firm switcher and the
 * profile menu both live inside CounselHeader and nowhere else, so an attorney
 * whose current organization lapsed lost every route to the paying
 * organization they are also a member of. Signing out did not help either,
 * because profiles.active_firm_id persists across sessions. The only ways back
 * were an HQ restore and a hand-written POST.
 *
 * It is the same argument that already put /counsel/accept-invite in
 * ALWAYS_ALLOWED: an attorney whose organization has lapsed can still open an
 * invitation from one that pays. That reasoning was never extended to the
 * attorney who is ALREADY a member, which is the more common case and the one
 * with no pending invitation to rescue it.
 *
 * WHY IT IS NOT A HOLE. The gate is PER ORGANIZATION, so switching is not an
 * escape from it. The list offered below comes from listMyFirms, which reads
 * firm_members through the caller's own RLS-scoped client, and
 * setActiveFirmAction independently re-confirms the membership server-side
 * before it writes. So the only destinations are organizations the caller
 * genuinely belongs to, and the lapsed organization stays exactly as closed as
 * it was: nothing here grants any access to it, and if the destination is also
 * export_only the layout evaluates its own state and sends them straight back
 * to this page.
 */
async function switchOrganizationAction(formData: FormData) {
  'use server';
  const firmId = String(formData.get('firmId') ?? '');
  // The membership check is setActiveFirmAction's, not this line's. This only
  // avoids a pointless round trip on an empty submission.
  if (!firmId) redirect(ACCESS_ENDED_PATH);
  const result = await setActiveFirmAction(firmId);
  // A refusal lands them back here rather than on a blank page. There is
  // nothing to explain: the only refusals are a membership they do not have,
  // which the list cannot produce, and a write that failed.
  redirect(result.ok ? '/counsel' : ACCESS_ENDED_PATH);
}

export default async function CounselAccessEndedPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/access-ended');

  // Same resolution the counsel layout uses: the active firm, falling back to
  // the first membership when profiles.active_firm_id is unset.
  const myFirms = await listMyFirms();
  const active = (await getActiveFirmContext()) ?? myFirms[0] ?? null;

  // Every OTHER organization this person belongs to. Read from their own
  // memberships, so this can never name one they are not in.
  const otherFirms = myFirms
    .map((m) => m.firm)
    .filter((f) => f.id !== active?.firm.id);

  // Owner and admin only, through lib/firm-authz.ts rather than a fourth
  // membership check. An organization-wide export holds every matter, document
  // and client name the firm has; in a departing paralegal's hands that is a
  // data loss incident, not an offboarding feature.
  //
  // The LOOKUP form, not callerHasFirmRole, and this page is the reason the
  // lookup exists. Failing closed on the privilege is right: a read we could
  // not complete must never produce an export button. But this is the one page
  // whose entire job is handing the data back, and telling an owner to go ask
  // an owner because a membership read blipped leaves them with no download
  // link, no explanation and nothing to click. So the three answers are kept
  // apart: you may export, you may not, and we could not tell.
  const lookup = active
    ? await callerFirmRoleLookup(active.firm.id)
    : ({ ok: true, role: null } as const);
  const roleUnknown = !lookup.ok;
  const canExport =
    lookup.ok && lookup.role !== null && FIRM_ADMIN_ROLES.includes(lookup.role);

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
          <h1 className="text-2xl font-medium text-cream-100">
            <T>Your organization&rsquo;s access has ended</T>
          </h1>
          <p className="text-sm text-cream-100/75 leading-relaxed">
            {roleUnknown ? (
              <T>
                We could not check what you can do here just now. Your data is
                not being deleted. Try again in a moment.
              </T>
            ) : canExport ? (
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
            {/* The way back in. Firm plans on Advottic are sold by talking to
                someone, not by self-serve checkout: every firm tier on
                /pricing routes to /counsel/request, and there is no firm
                branch in /api/stripe/checkout by design. Without this link an
                organization that WANTS to keep paying leaves here with three
                options, all of which are ways out.

                Gated on canExport, which is FIRM_ADMIN_ROLES, because that is
                who can actually act on it. A plain member is already told
                above to speak to their owner, and offering them a sales
                conversation they cannot start would be a control with nothing
                behind it.

                Safe to link: /counsel/request is one of the self-shelled
                routes the counsel layout short-circuits before the membership
                and access gates, so an organization whose access has ended
                lands on it rather than being bounced back here. A link that
                loops would be worse than no link at all.

                Secondary styling on purpose. Getting their data out is the
                urgent thing at this moment; this is the calm second option,
                not a pitch. */}
            {canExport ? (
              <Link
                href="/counsel/request"
                className="btn border border-cream-100/15 text-cream-100/85 hover:bg-cream-100/5 justify-center"
              >
                <T>Talk to us about restoring access</T>
              </Link>
            ) : null}
            {/* Neutral retry, and only on the branch that could not tell. A
                member who genuinely holds no admin role is not offered it,
                because for them there is nothing to retry.

                A PLAIN ANCHOR, not next/link, and the difference is the whole
                point of the control. next/link is client JavaScript doing a
                same-route soft navigation, which the App Router client cache
                can serve from what it already has; a retry that re-renders
                the same failed answer is a button that does nothing. A plain
                anchor is a full document request, so callerFirmRoleLookup
                actually runs again. */}
            {roleUnknown ? (
              <a
                href={ACCESS_ENDED_PATH}
                className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
              >
                <T>Try again</T>
              </a>
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
          {/* See switchOrganizationAction above for why this is here and why
              it is not a way around the gate. */}
          {otherFirms.length > 0 ? (
            <div className="space-y-2 border-t border-cream-100/10 pt-4">
              <p className="text-sm text-cream-100/75 leading-relaxed">
                <T>
                  You also work with other organizations on Advottic. You can
                  switch to one of them.
                </T>
              </p>
              {otherFirms.map((firm) => (
                <form key={firm.id} action={switchOrganizationAction}>
                  <input type="hidden" name="firmId" value={firm.id} />
                  <button
                    type="submit"
                    className="btn w-full justify-center border border-cream-100/15 text-cream-100/85 hover:bg-cream-100/5"
                  >
                    <span data-no-translate>{firm.name}</span>
                  </button>
                </form>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </LocaleProvider>
  );
}
