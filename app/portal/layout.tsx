import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getWorkspacePersona } from '@/lib/persona';

export const dynamic = 'force-dynamic';

/**
 * Employee portal shell. The deliberately small surface for non-legal
 * employees of an enterprise tenant: file a request, see your own
 * requests, run Advottic Review. Nothing else.
 *
 * Gating (single chokepoint - see lib/persona.ts):
 *   - signed out            -> /sign-in?next=/portal
 *   - legal / admin persona -> /counsel  (they get the full app; the
 *     portal is not for them)
 *   - employee persona      -> render
 *   - none                  -> a calm "no access yet" card, never a 500
 *
 * Visual: same dark counsel-shell as /counsel so the org reads one
 * brand, but with its own minimal header and NO CounselSidebar.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 mt-10">
        <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Portal is not available
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2">
          Auth is not configured on this deployment.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal');

  const persona = await getWorkspacePersona();
  if (persona.kind === 'legal' || persona.kind === 'admin') {
    redirect('/counsel');
  }

  if (persona.kind === 'none') {
    return (
      <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
        <div className="popup-panel max-w-md w-full p-8 space-y-3 text-center">
          <p className="eyebrow justify-center">Advottic</p>
          <h1 className="font-display text-2xl font-medium text-cream-100">
            No workspace yet
          </h1>
          <p className="text-sm text-cream-100/70 leading-relaxed">
            Your account is not connected to an organization&rsquo;s
            legal workspace. Ask your administrator to add you, then
            sign in again.
          </p>
          <form action="/auth/sign-out" method="post" className="pt-2">
            <button
              type="submit"
              className="btn text-cream-100/75 hover:text-cream-100 hover:bg-cream-100/5"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Narrow to the employee variant. The branches above have handled
  // every other kind (none -> card, legal/admin -> /counsel); this
  // guard makes that exhaustive for the type checker too.
  if (persona.kind !== 'employee') redirect('/portal');
  const { firm, employee } = persona;
  const who = employee.displayName || employee.email;

  return (
    <div
      className="dark counsel-shell min-h-screen flex flex-col text-cream-100"
      style={
        { ['--firm-accent' as string]: firm.accentColor } as React.CSSProperties
      }
    >
      <header className="border-b border-forest-700/40 bg-forest-950/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="h-7 w-7 rounded-md flex-none inline-flex items-center justify-center text-white text-[12px] font-bold"
              style={{ backgroundColor: firm.accentColor }}
              aria-hidden
            >
              {firm.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-cream-100 truncate">
                {firm.name}
              </p>
              <p className="text-[11px] text-cream-100/55 truncate">
                Employee portal
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5 sm:gap-2 text-[13px]">
            <Link
              href="/portal"
              className="px-2.5 py-1.5 rounded-md text-cream-100/80 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
            >
              My requests
            </Link>
            <Link
              href="/portal/new"
              className="px-2.5 py-1.5 rounded-md text-cream-100/80 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
            >
              New request
            </Link>
            <Link
              href="/review-my-document"
              className="px-2.5 py-1.5 rounded-md text-cream-100/80 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
            >
              Advottic Review
            </Link>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-md text-cream-100/55 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
                title={`Signed in as ${who}`}
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-forest-700/40 bg-forest-950/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 text-[11px] text-cream-100/55 flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-semibold text-cream-100">Advottic</span>{' '}
            &middot; {firm.name} employee portal
          </p>
          <p>Signed in as {who}</p>
        </div>
      </footer>
    </div>
  );
}
