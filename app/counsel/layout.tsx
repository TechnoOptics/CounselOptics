import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext, listMyFirms } from '@/lib/firm-storage';
import { CounselSidebar } from '@/components/counsel/CounselSidebar';
import { CounselHeader } from '@/components/counsel/CounselHeader';
import { AskAdvottic } from '@/components/counsel/AskAdvottic';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { getLocaleCookie } from '@/lib/i18n/locale';
import type { Firm, FirmMember } from '@/lib/firm-types';

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
  // Short-circuit public + token-gated routes. These pages render
  // their own full-bleed shells (the public request form and the
  // grant-redemption welcome screen) and must not inherit the
  // firm-membership-gated chrome. The pages still get the dark
  // counsel-shell because they wrap their own content in it.
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';
  const isPublicCounselRoute =
    pathname === '/counsel/request' || pathname === '/counsel/welcome';
  if (isPublicCounselRoute) return <>{children}</>;

  // Phase 2 white-label: middleware injects tenant headers when the
  // request comes from <slug>.advottic.com. When present, this layout
  // skips the firm switcher entirely (the URL bar IS the firm) and
  // pre-selects this firm as active regardless of profiles.active_firm_id.
  // If the signed-in user does not belong to this firm we hard-redirect
  // them to the apex sign-in with a friendly error - never silently
  // drop them into a different firm's data.
  const tenantFirmId = headersList.get('x-tenant-firm-id');
  const tenantFirmSlug = headersList.get('x-tenant-firm-slug');
  const tenantFirmName = headersList.get('x-tenant-firm-name');
  const tenantFirmAccent = headersList.get('x-tenant-firm-accent');
  const tenantFirmLogo = headersList.get('x-tenant-firm-logo');
  const isTenantSubdomain = Boolean(tenantFirmId && tenantFirmSlug);

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

  // Counsel is now invitation-only: a signed-in user without firm
  // membership cannot reach the dashboard. They are routed to:
  //   - /counsel/accept-invite (already-existing firm member invite)
  //   - /counsel/request (public application form)
  // /counsel/onboarding still exists but is reachable only from a
  // valid grant via /counsel/welcome - the layout still gates it on
  // firm membership in the same way as the rest.
  const myFirms = await listMyFirms();

  // Tenant-subdomain access gate. The user MUST be a member of the
  // firm whose subdomain they're on. We fail closed: redirect to the
  // apex sign-in (forces a clean re-auth) with a friendly error that
  // explains they don't have access to that workspace. This avoids
  // any possibility of a session for one firm leaking into another's
  // tenant URL.
  if (isTenantSubdomain) {
    const matching = myFirms.find((m) => m.firm.id === tenantFirmId);
    if (!matching) {
      const message = tenantFirmName
        ? `You don't have access to the ${tenantFirmName} workspace yet. Sign in to your firm's portal, or ask an admin to invite you.`
        : "You don't have access to this firm's workspace yet.";
      redirect(
        `https://advottic.com/sign-in?error=${encodeURIComponent(message)}`,
      );
    }
  }

  if (myFirms.length === 0 && pathname !== '/counsel/accept-invite') {
    redirect('/counsel/request');
  }

  // On a tenant subdomain, the firm context is dictated by the URL,
  // not by profiles.active_firm_id. Pre-select that firm. On the
  // generic enterprise.advottic.com host, fall back to the user's
  // active firm or the first membership.
  let active: { firm: Firm; membership: FirmMember } | null;
  if (isTenantSubdomain) {
    active = myFirms.find((m) => m.firm.id === tenantFirmId) ?? null;
  } else {
    active = await getActiveFirmContext();
    if (!active && myFirms.length > 0) {
      // Default to first membership if active_firm_id is unset.
      active = myFirms[0] ?? null;
    }
  }

  // User's chosen UI language (#14). LocaleProvider below translates
  // only the UI chrome wrapped in <T>, leaving firm data verbatim.
  const locale = await getLocaleCookie();

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
     <LocaleProvider initialLocale={locale}>
      <CounselHeader
        firm={active?.firm ?? null}
        membership={active?.membership ?? null}
        memberships={myFirms}
        tenantMode={isTenantSubdomain}
        locale={locale}
      />
      <div className="flex-1 flex w-full max-w-none mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 gap-6">
        {active ? (
          <aside className="hidden md:block w-56 flex-none sticky top-24 self-start max-h-[calc(100dvh-7rem)] overflow-y-auto">
            <CounselSidebar
              firm={active.firm}
              membership={active.membership}
              pathname={pathname}
              tenantMode={isTenantSubdomain}
            />
          </aside>
        ) : null}
        <main className="flex-1 min-w-0">
          {/* The Ask Advottic bar normally sits at the top of every
              Counsel page. The dashboard at /counsel renders its own
              welcome banner above the Ask bar and then handles its
              own ordering, so we skip rendering it from the layout
              for that one route. */}
          {active && pathname !== '/counsel' ? <AskAdvottic /> : null}
          {children}
        </main>
      </div>
      <footer className="border-t border-forest-700/40 bg-forest-950/80 backdrop-blur">
        <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 py-4 text-[11px] text-cream-100/55 flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-semibold text-cream-100">
              {String(
                (active?.firm.metadata as
                  | Record<string, unknown>
                  | undefined)?.brandName ?? '',
              ).trim() || 'Advottic Enterprise'}
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
     </LocaleProvider>
    </div>
  );
}
