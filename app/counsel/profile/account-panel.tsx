import Link from 'next/link';
import { updateProfileAction } from '@/lib/actions';
import { PERSONAL_PROFILE_HREF } from '@/lib/counsel-account-routes';
import { PageHeader } from '@/components/counsel/ui';
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
    <div className="max-w-2xl space-y-8 animate-fade-up">
      <PageHeader
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

      <section className="card p-6 space-y-5">
        <div>
          <p className="eyebrow mb-1">
            <T>Signed in as</T>
          </p>
          <p
            className="font-semibold text-forest-900 dark:text-cream-100 truncate"
            data-no-translate
          >
            {props.displayName || props.email}
          </p>
          <p
            className="text-sm text-ink-500 dark:text-cream-100/55 truncate"
            data-no-translate
          >
            {props.email}
          </p>
          {props.firmName ? (
            <p
              className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 truncate"
              data-no-translate
            >
              {props.firmName}
              {props.firmRoleLabel ? ` · ${props.firmRoleLabel}` : ''}
            </p>
          ) : null}
        </div>
        <AvatarUpload userId={props.userId} currentUrl={props.avatarUrl} />
        <p className="text-xs text-ink-500 dark:text-cream-100/55">
          <T>
            Upload a photo, or leave it and Advottic uses the picture from the
            account you signed in with.
          </T>
        </p>
      </section>

      <form action={updateProfileAction} className="card p-6 space-y-5">
        <div>
          <p className="eyebrow mb-1">
            <T>Details</T>
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Name and title</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
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
            <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1.5">
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
            <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1.5">
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

      <section className="space-y-4">
        <div>
          <p className="eyebrow mb-1">
            <T>Security</T>
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>How you sign in</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
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

      <section className="card p-6 space-y-3">
        <div>
          <p className="eyebrow mb-1">
            <T>Integrations</T>
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>API tokens</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
            <T>
              Issue a token so another system can read and file work through
              the Advottic API. Owners and admins can scope a token to the
              firm.
            </T>
          </p>
        </div>
        <div>
          <Link href="/counsel/profile/api-tokens" className="btn-secondary">
            <T>Manage tokens</T>
          </Link>
        </div>
      </section>

      {/* The way back. /counsel/profile is a strict subset of the consumer
          profile, and /profile now redirects a firm member here, so without
          this link the sections this page drops would have no route at all.
          PERSONAL_PROFILE_HREF is the URL that opts out of that redirect and
          is stable enough to bookmark. */}
      <section className="card p-6 space-y-3">
        <div>
          <p className="eyebrow mb-1">
            <T>Personal account</T>
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Your own Advottic settings</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
            <T>
              Theme, language, Safe Witness contacts and paired devices belong
              to you rather than to the firm, so they stay on your personal
              profile in the main app.
            </T>
          </p>
        </div>
        <div>
          <Link href={PERSONAL_PROFILE_HREF} className="btn-secondary">
            <T>Open personal settings</T>
          </Link>
        </div>
      </section>

      <AccountActions />
    </div>
  );
}
