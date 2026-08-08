import { redirect } from 'next/navigation';
import { getGuestContext } from '@/lib/counsel-guest';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Guest access · Advottic', robots: { index: false } };
}

/**
 * Calm holding page for a guest with no matter yet assigned (e.g. a firm
 * provisioned the account moments before adding them to a case). A guest WITH a
 * matter is sent straight to it.
 */
export default async function GuestHomePage() {
  const guest = await getGuestContext();
  if (!guest) redirect('/sign-in');
  if (guest.caseIds.length > 0) {
    redirect(`/counsel/cases/${guest.caseIds[0]}`);
  }

  return (
    <div className="max-w-lg mx-auto mt-10 text-center">
      <h1 className="text-2xl text-cream-100">
        <T>You&rsquo;re signed in</T>
      </h1>
      <p className="text-sm text-cream-100/70 mt-3">
        <T>
          Your guest access is active, but you have not been added to a matter
          yet. Once the firm adds you, it will appear here automatically. You can
          close this tab in the meantime.
        </T>
      </p>
    </div>
  );
}
