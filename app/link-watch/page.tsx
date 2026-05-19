import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { ApproveWatch } from './approve-watch';

export const dynamic = 'force-dynamic';

/**
 * /link-watch?code=...
 *
 * The page the user opens from the QR shown on their Wear OS watch.
 * Requires a signed-in session (so the watch token is bound to the
 * right account); on approve it calls /api/watch/link/approve, which
 * mints a read-scoped adv_ token the watch then uses against
 * /api/v1/cases. This is the no-Data-Layer path that works across
 * Play-distributed phone + watch apps.
 */
export default async function LinkWatchPage({
  searchParams,
}: {
  searchParams?: { code?: string };
}) {
  const code = (searchParams?.code ?? '').trim();

  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <p className="text-[#FBF7E9]/70">
          Account sign-in isn&apos;t configured on this deployment.
        </p>
      </Shell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`/link-watch?code=${code}`)}`,
    );
  }

  if (!code) {
    return (
      <Shell>
        <p className="text-[#FBF7E9]/70">
          This link is missing its pairing code. Re-open it from the QR on
          your watch (Advottic &rarr; Link a watch).
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mb-6 text-[#FBF7E9]/80">
        Link your Wear OS watch to{' '}
        <span className="font-semibold text-[#E6CE93]">{user.email}</span>? The
        watch will show your open cases, next hearing, docket and action
        center. You can revoke this anytime from API tokens.
      </p>
      <ApproveWatch code={code} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-2 text-2xl font-bold tracking-wide text-[#E6CE93]">
        Link a watch
      </h1>
      <div className="mt-4 w-full rounded-2xl border border-[#E6CE93]/25 bg-[#143A2D]/50 p-6">
        {children}
      </div>
    </div>
  );
}
