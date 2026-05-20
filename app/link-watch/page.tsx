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
 * mints a read-scoped `adv_` token the watch then uses against
 * /api/v1/cases. This is the no-Data-Layer path that works across
 * Play-distributed phone + watch apps.
 *
 * UX: the previous version dropped the user on a quiet page with one
 * gold button at the bottom, easy to miss after a successful sign-
 * in. This version walks them through the remaining one step with a
 * big visual confirm + the code shown for verification, the way
 * Google TV and Apple's device-link flows do it. We deliberately do
 * NOT auto-approve on landing - a click is the consent gesture that
 * prevents a phishing /link-watch?code=<attacker-code> URL from
 * silently minting a token bound to the victim.
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

  // Show a short, human-friendly slice of the code so the user can
  // sanity-check it matches what's on the watch. Full code stays in
  // the form action, not in the visible UI.
  const codeHint = code.slice(0, 4).toUpperCase();

  return (
    <Shell>
      <ol className="mb-5 space-y-2 text-left text-sm text-[#FBF7E9]/75">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-500/30 text-[11px] font-semibold text-emerald-200">
            1
          </span>
          <span>
            <span className="font-semibold text-emerald-200">Signed in</span>{' '}
            as{' '}
            <span className="font-mono text-[#E6CE93]">{user.email}</span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#E6CE93]/30 text-[11px] font-semibold text-[#E6CE93]">
            2
          </span>
          <span>
            <span className="font-semibold text-[#E6CE93]">
              One step left
            </span>{' '}
            - tap the gold button below to authorize your watch.
          </span>
        </li>
      </ol>

      <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-[#FBF7E9]/45">
        Pairing code
      </p>
      <p className="mb-5 font-mono text-2xl font-bold tracking-[0.18em] text-[#E6CE93]">
        {codeHint}
      </p>
      <p className="mb-5 text-[11.5px] leading-relaxed text-[#FBF7E9]/55">
        Glance at the QR on your watch - the first four characters under
        the QR should match the code above. If they don&apos;t, close this
        tab and restart pairing from the watch.
      </p>

      <ApproveWatch code={code} />

      <p className="mt-5 border-t border-[#E6CE93]/15 pt-3 text-left text-[11px] leading-relaxed text-[#FBF7E9]/45">
        Tapping below mints a read-only token bound to your account.
        Your watch will start showing your open cases, next hearing,
        and docket within a few seconds. You can revoke this anytime
        from{' '}
        <span className="font-mono text-[#FBF7E9]/65">
          /profile/api-tokens
        </span>{' '}
        - look for &ldquo;Wear OS watch&rdquo;.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6">
      <div className="text-center">
        <h1 className="mb-1 text-2xl font-bold tracking-wide text-[#E6CE93]">
          Link a watch
        </h1>
        <p className="text-[12px] text-[#FBF7E9]/50">
          Almost there - finish pairing your Advottic watch
        </p>
      </div>
      <div className="mt-4 w-full rounded-2xl border border-[#E6CE93]/25 bg-[#143A2D]/50 p-6">
        {children}
      </div>
    </div>
  );
}
