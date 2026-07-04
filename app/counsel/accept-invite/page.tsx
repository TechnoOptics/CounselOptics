import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { AcceptInviteClient } from './accept-client';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Accept invitation · Counsel',
  robots: { index: false, follow: false },
};

export default async function CounselAcceptInvitePage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = (searchParams?.token ?? '').trim();
  const user = await getCurrentUser();
  if (!user) {
    // Round-trip through sign-in carrying the token so we land back here.
    const next = encodeURIComponent(
      token ? `/counsel/accept-invite?token=${encodeURIComponent(token)}` : '/counsel',
    );
    redirect(`/sign-in?next=${next}`);
  }
  return (
    <div className="max-w-lg mx-auto card p-6 sm:p-8 space-y-4 animate-fade-up">
      <p className="eyebrow"><T>Counsel invitation</T></p>
      <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        <T>Accept your invitation</T>
      </h1>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
        <T>You&rsquo;ve been invited to join a firm on Advottic Counsel. Confirm to add the
        firm to your account.</T>
      </p>
      <AcceptInviteClient token={token} />
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
        <T>Wrong account?</T>{' '}
        <Link href="/auth/sign-out" className="underline">
          <T>Sign out</T>
        </Link>{' '}
        <T>and sign in with the email the invitation was sent to.</T>
      </p>
    </div>
  );
}
