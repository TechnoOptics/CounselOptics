import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { SignInButtons } from './sign-in-buttons';

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
    <div className="max-w-md mx-auto">
      <div className="card p-8">
        <p className="eyebrow mb-3">Welcome</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950 mb-2">
          Sign in to CounselOptics
        </h1>
        <p className="text-sm text-ink-600 leading-relaxed mb-6">
          Your case files, exhibits, and reviews stay tied to your account.
        </p>

        {searchParams?.error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 mb-4">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <SignInButtons next={next} />

        <p className="text-xs text-ink-500 mt-6 leading-relaxed">
          By continuing you acknowledge that CounselOptics provides legal information and case
          organization, not legal advice.
        </p>
      </div>
    </div>
  );
}
