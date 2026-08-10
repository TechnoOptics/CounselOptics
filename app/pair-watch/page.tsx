import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { PairWatchForm } from './pair-watch-form';

export const dynamic = 'force-dynamic';
// Device-pairing utility, not a page anyone should reach from search.
// noindex rather than a canonical: there is nothing here to index.
export const metadata = {
  title: 'Pair Wear OS watch · Advottic',
  robots: { index: false, follow: false },
};

/**
 * /pair-watch
 *
 * In-app pairing for a Wear OS watch from the phone app. The watch
 * displays a 6-digit code; the user types it here, the server mints
 * a read-scoped token bound to this account, the watch's next poll
 * picks it up.
 *
 * Built specifically so a signed-in phone user doesn't have to sign
 * in AGAIN to pair their watch. The QR + /link-watch web flow
 * forced a second roundtrip that frequently failed because mobile
 * mail clients open the magic link in a different browser, OAuth
 * cookies get stripped, etc. Six digits in a single tap on the
 * already-signed-in phone app removes every one of those moving
 * parts.
 */
export default async function PairWatchPage() {
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
    redirect(`/sign-in?next=${encodeURIComponent('/pair-watch')}`);
  }

  return (
    <Shell>
      <ol className="mb-5 space-y-2 text-left text-sm text-[#FBF7E9]/80">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#E6CE93]/30 text-[11px] font-semibold text-[#E6CE93]">
            1
          </span>
          <span>
            Open <strong>Advottic</strong> on your Wear OS watch and tap{' '}
            <strong>Link a watch</strong>.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#E6CE93]/30 text-[11px] font-semibold text-[#E6CE93]">
            2
          </span>
          <span>
            Look at the watch - the screen shows a{' '}
            <strong>6-digit code</strong> below the QR.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#E6CE93]/30 text-[11px] font-semibold text-[#E6CE93]">
            3
          </span>
          <span>Type the 6 digits below and tap Pair.</span>
        </li>
      </ol>
      <PairWatchForm />
      <p className="mt-5 border-t border-[#E6CE93]/15 pt-3 text-left text-[11px] leading-relaxed text-[#FBF7E9]/45">
        Pairing mints a read-only token bound to your account. The
        watch will start showing your open cases, next hearing, and
        docket within a few seconds. You can revoke this anytime from{' '}
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
          Pair your watch
        </h1>
        <p className="text-[12px] text-[#FBF7E9]/55">
          Companion sync for Wear OS in three taps
        </p>
      </div>
      <div className="mt-4 w-full rounded-2xl border border-[#E6CE93]/25 bg-[#143A2D]/50 p-6">
        {children}
      </div>
    </div>
  );
}
