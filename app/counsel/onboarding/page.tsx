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
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up py-2 sm:py-6">
      <header>
        <p className="eyebrow mb-2">Counsel onboarding</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Set up your firm.
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Two minutes. You can change everything later from firm settings.
        </p>
      </header>
      <OnboardingWizard
        defaultName=""
        defaultEmail={user.email ?? null}
      />
      <p className="text-xs text-ink-500 dark:text-cream-100/55">
        Already invited to a firm?{' '}
        <Link href="/counsel/accept-invite" className="underline hover:text-forest-900 dark:hover:text-cream-100">
          Open an invitation
        </Link>{' '}
        instead.
      </p>
    </div>
  );
}
