import { redirect } from 'next/navigation';
import { getGuestContext } from '@/lib/counsel-guest';
import { GuestPasswordForm } from '@/components/counsel/GuestPasswordForm';
import { T } from '@/components/i18n/LocaleProvider';
// Shared with both account pages, not copied. See app/profile/mfa-settings.tsx.
import { MfaSettings } from '@/app/profile/mfa-settings';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Profile settings · Advottic', robots: { index: false } };
}

/**
 * Guest profile settings. Minimal by design: a guest can see their identity,
 * change their password if this is a firm-provisioned account, and turn on
 * two-factor authentication. There is nothing else for a guest to configure
 * (no platform or firm settings).
 *
 * Two-factor lives HERE rather than on /counsel/profile, and the guest path
 * allowlist in lib/counsel-guest.ts is deliberately left as it was.
 *
 * A guest is an outside attorney with scoped access to one live matter, which
 * is exactly the account a second factor is for, so the control has to be
 * reachable from inside their own shell. But /counsel/profile is the FIRM
 * account page: it is headed with the firm's name, it describes how the reader
 * appears "on the firm's work product", and it links to API tokens where a
 * firm owner or admin mints read+write integration tokens bound to the firm.
 * Allowlisting that path would hand a non-member the firm's account surface to
 * close a two-factor gap, which is a wider grant than the gap needs.
 *
 * /counsel/guest/profile is already inside the allowlist ('/counsel/guest/*'),
 * already in the guest account menu, and already the page a guest changes
 * their password on. Adding the control here changes no gate, so it cannot
 * open the redirect loop that adding a path to one allowlist while another
 * redirect still bounces the caller would.
 *
 * MfaSettings is the same component both other account pages render. It is
 * self-contained: it talks to Supabase Auth's MFA API from the browser with
 * the caller's own session and enrolls a factor on that session's user, so it
 * needs no firm context and grants no firm read.
 */
export default async function GuestProfilePage() {
  const guest = await getGuestContext();
  if (!guest) redirect('/sign-in');

  return (
    <div className="max-w-md mx-auto mt-6 space-y-6">
      <header>
        <h1 className="font-display text-2xl text-cream-100">
          <T>Profile settings</T>
        </h1>
        <p className="text-sm text-cream-100/70 mt-2">
          <T>Your guest access details.</T>
        </p>
      </header>

      <section className="card p-5 space-y-2">
        <Row label="Name" value={guest.displayName ?? <T>Not set</T>} />
        <Row label="Sign-in" value={guest.email ?? <T>Not set</T>} />
        {guest.firm && <Row label="Working with" value={guest.firm.name} />}
      </section>

      {guest.provisioned && (
        <section className="card p-6">
          <h2 className="text-sm font-semibold text-cream-100 mb-1">
            <T>Change password</T>
          </h2>
          <p className="text-[12px] text-cream-100/60 mb-4">
            <T>Update the password you use to sign in.</T>
          </p>
          <GuestPasswordForm submitLabel="Update password" />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-cream-100">
            <T>How you sign in</T>
          </h2>
          <p className="text-[12px] text-cream-100/60">
            <T>
              A second step at sign-in protects the matter you have been given
              access to. You can turn it on yourself.
            </T>
          </p>
        </div>
        <MfaSettings />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-cream-100/55">
        <T>{label}</T>
      </span>
      <span className="text-sm text-cream-100/90 truncate" data-no-translate>
        {value}
      </span>
    </div>
  );
}
