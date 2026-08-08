import Link from 'next/link';
import { updateProfileAction } from '@/lib/actions';
import { PERSONAL_PROFILE_HREF } from '@/lib/counsel-account-routes';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { PanelCard } from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
// The account controls are SHARED with the consumer profile at
// /app/profile, not copied. Only the shell and the choice of sections
// differ. If one of these grows a feature, both surfaces get it.
import { AvatarUpload } from '@/app/profile/avatar-upload';
import { MfaSettings } from '@/app/profile/mfa-settings';
import { PhoneVerifyForm } from '@/app/profile/phone-verify-form';
import { AccountActions } from '@/app/profile/account-actions';
import { BiometricSettings } from '@/components/BiometricSettings';

export type AccountPanelProps = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  organization: string;
  avatarUrl: string | null;
  firmName: string | null;
  firmRoleLabel: string | null;
  verifiedPhone: string | null;
  phoneVerifiedAt: string | null;
  phoneVerifyConfigured: boolean;
};

/**
 * Everything on the firm-side account page below the auth check.
 *
 * Presentation is split from the fetch so the page owns the session and
 * this owns the markup, the same split used by TokensPanel and
 * FeedbackPanel. It also means the markup can be rendered from a
 * fixture, which is the only way to look at this surface without a
 * signed-in firm account.
 */
export function AccountPanel(props: AccountPanelProps) {
  return (
    /*
      A configuration surface: the page header, then one card per thing
      that can be set, each with the uppercase letterspaced header the
      detail pattern uses. No metric strip and no segmented views - an
      account page has no metrics, and its cards are settings that are
      all in force at once rather than views of one set.
    */
    <div className="max-w-2xl space-y-4 animate-fade-up">
      <PageHeader
        className="mb-6"
        eyebrow={
          props.firmName ? (
            <span data-no-translate>{props.firmName}</span>
          ) : (
            <T>Account</T>
          )
        }
        title={<T>Your account</T>}
        subtitle={
          <T>
            How you appear on the firm&rsquo;s work product, and how you sign
            in.
          </T>
        }
      />

      <PanelCard title={<T>Signed in as</T>}>
        <div className="space-y-5">
          <div>
            <p
              className="truncate font-semibold text-foreground"
              data-no-translate
            >
              {props.displayName || props.email}
            </p>
            <p className="truncate text-sm text-muted" data-no-translate>
              {props.email}
            </p>
            {props.firmName ? (
              <p
                className="mt-1 truncate text-[12px] text-muted"
                data-no-translate
              >
                {props.firmName}
                {props.firmRoleLabel ? ` · ${props.firmRoleLabel}` : ''}
              </p>
            ) : null}
          </div>
          <AvatarUpload userId={props.userId} currentUrl={props.avatarUrl} />
          <p className="text-xs text-muted">
            <T>
              Upload a photo, or leave it and Advottic uses the picture from the
              account you signed in with.
            </T>
          </p>
        </div>
      </PanelCard>

      <PanelCard title={<T>Details</T>}>
      <form action={updateProfileAction} className="space-y-5">
        <div>
          <p className="text-[13.5px] font-semibold text-foreground">
            <T>Name and title</T>
          </p>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            <T>
              These appear in the firm header and on the cover page of exported
              matter packets and exhibits.
            </T>
          </p>
        </div>

        <div>
          <label className="label" htmlFor="displayName">
            <T>Display name</T>
          </label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={props.displayName}
            className="input"
            data-no-translate
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="role">
              <T>Title</T>
            </label>
            <input
              id="role"
              name="role"
              defaultValue={props.role}
              className="input"
              data-no-translate
            />
            <p className="text-xs text-muted mt-1.5">
              <T>For example: Partner, Associate, Paralegal.</T>
            </p>
          </div>
          <div>
            <label className="label" htmlFor="organization">
              <T>Organization</T>
            </label>
            <input
              id="organization"
              name="organization"
              defaultValue={props.organization}
              className="input"
              data-no-translate
            />
            <p className="text-xs text-muted mt-1.5">
              <T>Leave blank to use the firm name.</T>
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            <T>Save changes</T>
          </button>
        </div>
      </form>
      </PanelCard>

      {/* Security is a band of three cards rather than one PanelCard,
          because MfaSettings, BiometricSettings and PhoneVerifyForm are
          SHARED with the consumer profile and each frames itself. Putting
          them inside a card would draw a border around three borders, and
          stripping theirs would restyle a surface this page does not own.
          So the band gets the shared section heading instead. */}
      <section className="space-y-4 pt-2">
        <div>
          <SectionTitle>
            <T>How you sign in</T>
          </SectionTitle>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            <T>
              Two-factor authentication protects every matter you can reach.
              Firms handling privileged material are expected to have it on.
            </T>
          </p>
        </div>
        <MfaSettings />
        {/* Biometric unlock is kept, unlike theme, language, Safe Witness,
            Wear OS, install and the Pro upsell, because it is not a consumer
            feature: it is a second way of signing in to THIS account, which
            is what this section is. The iOS and Android shells load
            advottic.com remotely, so an attorney who signs in there lands in
            /counsel and can use it. The card renders nothing at all on the
            web, where most firm work happens, so it costs a desktop reader
            no space. */}
        <BiometricSettings framed />
        <PhoneVerifyForm
          verifiedPhone={props.verifiedPhone}
          verifiedAt={props.phoneVerifiedAt}
          configured={props.phoneVerifyConfigured}
        />
      </section>

      <PanelCard title={<T>Integrations</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>API tokens</T>
        </p>
        <p className="mb-4 mt-1 text-sm leading-relaxed text-muted">
          <T>
            Issue a token so another system can read and file work through
            the Advottic API. Owners and admins can scope a token to the
            firm.
          </T>
        </p>
        <Link href="/counsel/profile/api-tokens" className="btn-secondary">
          <T>Manage tokens</T>
        </Link>
      </PanelCard>

      {/* The way back. /counsel/profile is a strict subset of the consumer
          profile, and /profile now redirects a firm member here, so without
          this link the sections this page drops would have no route at all.
          PERSONAL_PROFILE_HREF is the URL that opts out of that redirect and
          is stable enough to bookmark. */}
      <PanelCard title={<T>Personal account</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Your own Advottic settings</T>
        </p>
        <p className="mb-4 mt-1 text-sm leading-relaxed text-muted">
          <T>
            Theme, language, Safe Witness contacts and paired devices belong
            to you rather than to the firm, so they stay on your personal
            profile in the main app.
          </T>
        </p>
        <Link href={PERSONAL_PROFILE_HREF} className="btn-secondary">
          <T>Open personal settings</T>
        </Link>
      </PanelCard>

      <AccountActions />
    </div>
  );
}
