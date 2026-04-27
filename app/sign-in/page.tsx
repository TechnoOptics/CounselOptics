import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { SignInButtons } from './sign-in-buttons';
import { BrandMark } from '@/components/BrandMark';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const next = searchParams?.next && searchParams.next.startsWith('/') ? searchParams.next : '/cases';

  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-lg mx-auto card p-8 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Supabase not configured</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          Sign-in requires a Supabase project. Follow{' '}
          <Link href="/setup" className="underline">
            the setup guide
          </Link>{' '}
          or see <code className="font-mono">SETUP.md</code> in the repo.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (user) redirect(next);

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
        <p className="eyebrow mb-3">Welcome</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-ink-950 leading-[1.05] mb-2">
          Sign in or create an account
        </h1>
        <p className="text-sm text-ink-600 leading-relaxed mb-6">
          Continue with Google or Microsoft, or use a magic link. We&apos;ll create your
          Advottic account on first sign-in - no separate signup form. Your case files,
          exhibits, and reviews stay tied to your account.
        </p>

        {searchParams?.error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 mb-4">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <SignInButtons next={next} />

        <p className="text-xs text-ink-500 mt-6 leading-relaxed">
          By continuing you acknowledge that Advottic helps you organize your case -
          we are not a law firm and Advottic is not legal advice.{' '}
          <Link
            href="/about"
            className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            Learn more
          </Link>
          .
        </p>
        </div>
      </div>
    </div>
  );
}
