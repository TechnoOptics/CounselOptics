import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { listMyFirms } from '@/lib/firm-storage';
import { OnboardingWizard } from './onboarding-wizard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Set up your firm',
  description:
    'Create a new firm on Advottic Counsel. Pick a name, accent color, jurisdictions, and practice areas in two minutes.',
};

/**
 * /counsel/onboarding - first-run wizard for firms.
 *
 * Reachable when a signed-in user has no firms yet. If they
 * already belong to one, redirect to the dashboard.
 */
export default async function CounselOnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/onboarding');
  const myFirms = await listMyFirms();
  if (myFirms.length > 0) redirect('/counsel');
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-up py-2 sm:py-6">
      <OnboardingWizard
        defaultName=""
        defaultEmail={user.email ?? null}
      />
      <p className="text-xs text-cream-100/55 text-center">
        Already invited to a firm?{' '}
        <Link href="/counsel/accept-invite" className="underline hover:text-cream-100">
          Open an invitation
        </Link>{' '}
        instead.
      </p>
    </div>
  );
}
