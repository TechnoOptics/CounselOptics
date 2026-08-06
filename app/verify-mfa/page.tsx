import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { listMyFirms } from '@/lib/firm-storage';
import { COUNSEL_ACCOUNT_EQUIVALENT } from '@/lib/counsel-account-routes';
import { BrandMark } from '@/components/BrandMark';
import { VerifyMfaForm } from './verify-mfa-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Verify your identity · Advottic' },
  robots: { index: false, follow: false },
};

/**
 * Step-up (AAL2) challenge page. Reached only when middleware's
 * MFA_AAL2_ENFORCEMENT gate (lib/supabase/middleware.ts) detects a
 * signed-in user with a verified TOTP factor whose current session is
 * still AAL1 - i.e. they enrolled 2FA but haven't completed the second
 * factor yet this session. Not itself listed in PROTECTED_PREFIXES (it
 * would create a redirect loop with the very check that sends users
 * here); enforces its own baseline "must be signed in" requirement.
 */
function sanitizeNext(raw: string | undefined, isFirmMember: boolean): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    // Nobody normally lands here without a `next` (middleware always sets
    // it), so this is the hand-typed case. Sending a firm member to the
    // consumer dashboard is the same wrong turn the account menu used to
    // take, so the bare default follows their workspace.
    return isFirmMember ? '/counsel' : '/cases';
  }
  return raw;
}

export default async function VerifyMfaPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const user = await getCurrentUser();
  // Resolved once and used twice: for the bare-default destination above and
  // for the "no verified factor" way out below, which used to be a hard link
  // at /profile and dropped an attorney into the consumer shell.
  const isFirmMember = user
    ? (await listMyFirms().catch(() => [])).length > 0
    : false;
  const next = sanitizeNext(searchParams?.next, isFirmMember);
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/verify-mfa?next=${next}`)}`);

  return (
    <div className="max-w-md mx-auto animate-fade-up">
      <div className="card-luminous p-8 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 text-gold-500 pointer-events-none animate-float opacity-[0.07] z-0"
        >
          <BrandMark size={180} />
        </div>
        <div className="relative z-10">
          <p className="eyebrow mb-3">Verify it&rsquo;s you</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-ink-950 leading-[1.05] mb-2">
            Enter your 2FA code
          </h1>
          <p className="text-sm text-ink-600 leading-relaxed mb-6">
            This account has two-factor authentication turned on. Open your authenticator app and
            enter the current 6-digit code to continue.
          </p>
          <VerifyMfaForm
            next={next}
            accountHref={
              isFirmMember ? COUNSEL_ACCOUNT_EQUIVALENT['/profile'] : '/profile'
            }
          />
        </div>
      </div>
    </div>
  );
}
