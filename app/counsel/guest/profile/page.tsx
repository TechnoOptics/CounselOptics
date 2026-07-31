import { redirect } from 'next/navigation';
import { getGuestContext } from '@/lib/counsel-guest';
import { GuestPasswordForm } from '@/components/counsel/GuestPasswordForm';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Profile settings · Advottic', robots: { index: false } };
}

/**
 * Guest profile settings. Minimal by design: a guest can see their identity,
 * and - if this is a firm-provisioned account - change their password. There is
 * nothing else for a guest to configure (no platform or firm settings).
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
