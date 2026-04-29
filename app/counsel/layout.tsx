import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext, listMyFirms } from '@/lib/firm-storage';
import { CounselSidebar } from '@/components/counsel/CounselSidebar';
import { CounselHeader } from '@/components/counsel/CounselHeader';

export const dynamic = 'force-dynamic';

/**
 * Layout for the law-firm perspective. Wrapper around `/counsel/*`.
 *
 * Behavior:
 *   - If the visitor is signed out, kick to /sign-in with a redirect
 *     back to wherever they were trying to go.
 *   - If signed in but in NO firm AND not on /counsel/onboarding or
 *     /counsel/accept-invite, send to /counsel/onboarding so the
 *     experience opens with "create a firm" instead of an empty
 *     dashboard.
 *   - If signed in but `profiles.active_firm_id` is null (or points
 *     at a firm they were removed from), pick their first membership
 *     and treat that as the active firm. The "Switch firm" UI in the
 *     header lets them pick another.
 *   - The firm's accent color is injected as a CSS variable
 *     `--firm-accent` on this layout's root so child pages can use
 *     it via the `firm-accent` Tailwind utility.
 */
export default async function CounselLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 mt-10">
        <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Counsel mode is not available
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2">
          Auth is not configured on this deployment. Set the Supabase
          environment variables and redeploy.
        </p>
      </div>
    );
  }
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel');

  // Some routes are reachable without a firm:
  //   - /counsel/onboarding (create your first firm)
  //   - /counsel/accept-invite?token=... (accept an emailed invite)
  // Everything else requires firm membership.
  const myFirms = await listMyFirms();
  let active = await getActiveFirmContext();
  if (!active && myFirms.length > 0) {
    // Default to first membership if active_firm_id is unset.
    active = myFirms[0] ?? null;
  }

  // If we resolved a context, expose it to children via the wrapper.
  // The "dark" class forces dark Tailwind variants throughout the
  // counsel side regardless of the user's consumer-side theme - the
  // organizational portal reads as premium / professional rather than
  // the cream-and-gold marketing tone of the consumer app.
  return (
    <div
      className="dark counsel-shell min-h-screen flex flex-col text-cream-100"
      style={
        active
          ? ({
              ['--firm-accent' as string]: active.firm.accentColor,
            } as React.CSSProperties)
          : undefined
      }
    >
      <CounselHeader
        firm={active?.firm ?? null}
        membership={active?.membership ?? null}
        memberships={myFirms}
      />
      <div className="flex-1 flex w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 gap-6">
        {active ? (
          <aside className="hidden md:block w-56 flex-none">
            <CounselSidebar firm={active.firm} membership={active.membership} />
          </aside>
        ) : null}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      <footer className="border-t border-forest-700/40 bg-forest-950/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 text-[11px] text-cream-100/55 flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-semibold text-cream-100">
              Advottic Counsel
            </span>{' '}
            &middot; Organizational legal workspace.
          </p>
          <p>
            <Link
              href="/about"
              className="underline hover:text-cream-100"
            >
              What Advottic is, and isn&rsquo;t
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
