import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { FirmType } from '@/lib/firm-types';
import { GrantOnboardingWizard } from './grant-wizard';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Welcome to Advottic Counsel',
  description:
    'Set up your firm using your single-use invitation link from Advottic.',
  robots: { index: false, follow: false },
};

/**
 * Token-gated entry point for new firms. The Advottic team mints a
 * grant token, emails it to the applicant, and the link they click
 * lands here with ?grant=<token>. We validate the token, ensure the
 * signed-in user matches the email it was issued to, then run the
 * normal onboarding wizard (with the org name and firm type
 * pre-filled from the grant).
 *
 * Without a valid grant, redirect to /counsel/request - there is no
 * other way into Counsel.
 */
export default async function CounselWelcomePage({
  searchParams,
}: {
  searchParams?: { grant?: string };
}) {
  const token = (searchParams?.grant ?? '').trim();
  if (!token) redirect('/counsel/request');

  if (!isSupabaseConfigured()) redirect('/counsel/request');
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/counsel/welcome?grant=${token}`)}`);
  }

  const admin = createAdminSupabase();
  if (!admin) redirect('/counsel/request');

  const { data } = await admin
    .from('firm_access_grants')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  const grant = data as
    | {
        id: string;
        email: string;
        organization_name: string;
        firm_type: FirmType;
        expires_at: string;
        accepted_at: string | null;
      }
    | null;

  if (!grant) {
    return (
      <Status
        title="Invitation not found"
        body="This link doesn't match an active invitation. The Advottic team can issue a new one - email contact@advottic.com."
      />
    );
  }
  if (grant.accepted_at) {
    return (
      <Status
        title="Already used"
        body="This invitation link has already been used to set up a workspace. If you need to invite a teammate, ask the workspace owner to send an invite from Counsel team settings."
      />
    );
  }
  if (Date.parse(grant.expires_at) < Date.now()) {
    return (
      <Status
        title="Invitation expired"
        body="This invitation link has expired. Email contact@advottic.com and we'll issue a new one."
      />
    );
  }
  if (grant.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return (
      <Status
        title="Wrong account"
        body={`This invitation was sent to ${grant.email}. Sign out and sign back in with that email to continue.`}
        showSignOut
      />
    );
  }

  return (
    <div className="dark counsel-shell min-h-screen text-cream-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6 animate-fade-up">
        <GrantOnboardingWizard
          grantToken={token}
          defaultName={grant.organization_name}
          defaultEmail={user.email ?? null}
          defaultFirmType={grant.firm_type}
        />
      </div>
    </div>
  );
}

function Status({
  title,
  body,
  showSignOut,
}: {
  title: string;
  body: string;
  showSignOut?: boolean;
}) {
  return (
    <div className="dark counsel-shell min-h-screen text-cream-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full card p-8 text-center space-y-3">
        <p className="text-[10px] uppercase tracking-[0.32em] font-semibold text-gold-300">
          Counsel onboarding
        </p>
        <h1 className="font-display text-2xl font-medium tracking-[-0.01em]">{title}</h1>
        <p className="text-sm text-cream-100/80 leading-relaxed">{body}</p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Link href="/counsel/request" className="btn-secondary text-sm">
            Request access
          </Link>
          {showSignOut && (
            <form action="/auth/sign-out" method="post">
              <button type="submit" className="btn-ghost text-sm">
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
