import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUserResult, isSupabaseConfigured } from '@/lib/supabase/server';
import { SessionReconnect } from '@/components/auth/SessionReconnect';
import { getActiveFirmContext, listMyFirms } from '@/lib/firm-storage';
import { ACCESS_ENDED_PATH, counselAccessRedirect } from '@/lib/firm-access';
import { firmTrialState, readTrialSnapshot } from '@/lib/firm-trials';
import { FIRM_ADMIN_ROLES } from '@/lib/firm-authz';
import {
  getFirmSurfaceSettings,
  getFirmTicketPrefix,
  DEFAULT_FIRM_SURFACE_SETTINGS,
} from '@/lib/firm-settings';
import { CounselSidebar } from '@/components/counsel/CounselSidebar';
import { SidebarCollapseProvider, CounselSidebarShell } from '@/components/counsel/SidebarFocus';
import { CounselTrialBanner } from '@/components/counsel/CounselTrialBanner';
import { CounselHeader } from '@/components/counsel/CounselHeader';
import { CounselGuestHeader } from '@/components/counsel/CounselGuestHeader';
import { AskAdvottic } from '@/components/counsel/AskAdvottic';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { getLocaleCookie } from '@/lib/i18n/locale';
import { accentOn } from '@/lib/accent-text';
import {
  getGuestContext,
  guestPathAllowed,
  guestFallbackPath,
} from '@/lib/counsel-guest';
import type { Firm, FirmMember } from '@/lib/firm-types';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/**
 * What the trial banner is told, resolved from the organization's stored
 * `trial_ends_at` and from nothing else.
 *
 * The days are counted HERE rather than in the browser so both renders agree
 * on what day it is. A client-side count differs from the server's whenever
 * the two straddle midnight, which is a hydration mismatch on the one figure
 * the banner is scanned for.
 *
 * Every failure returns nulls, which the banner renders as nothing at all.
 * readTrialSnapshot fails closed on a missing row, an unreadable column and a
 * missing admin client, and an unparseable stored date is caught here. This is
 * COPY and not the gate: the gate on this same request is firmTrialState
 * below, which throws rather than guessing. A banner that guesses is what this
 * whole change removes, so the safe answer to an unknown clock is silence.
 */
async function trialNotice(
  firmId: string,
): Promise<{ trialEndsAt: string | null; daysLeft: number | null }> {
  const snapshot = await readTrialSnapshot(firmId);
  if (!snapshot.ok || !snapshot.trialEndsAt) {
    return { trialEndsAt: null, daysLeft: null };
  }
  const endMs = Date.parse(snapshot.trialEndsAt);
  if (Number.isNaN(endMs)) return { trialEndsAt: null, daysLeft: null };
  return {
    trialEndsAt: snapshot.trialEndsAt,
    daysLeft: Math.ceil((endMs - Date.now()) / DAY_MS),
  };
}

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
 *   - The firm's accent color is injected on this layout's root as two
 *     CSS variables: `--firm-accent`, the customer's exact hex, for
 *     FILLS, and `--accent-on`, the readable foreground for text that
 *     sits on top of such a fill. Read them with `var()` or with the
 *     `text-accent-on` utility. There is no `firm-accent` Tailwind
 *     utility; an earlier version of this comment claimed one and it
 *     has never existed. For the accent used AS text, use
 *     `text-accent-text`, which is derived rather than injected. See
 *     lib/accent-text.ts.
 */
export default async function CounselLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Short-circuit the routes that render their own full-bleed shells (the
  // public request form, the grant-redemption welcome screen, and the
  // access-ended page) and must not inherit the firm-membership-gated chrome.
  // The pages still get the dark counsel-shell because they wrap their own
  // content in it, and each resolves its own signed-in user.
  //
  // /counsel/access-ended is here for a second reason, and it is load-bearing:
  // sitting outside every gate below is what makes it impossible for the page
  // to redirect to itself. An infinite redirect would be worse than a lockout,
  // because it would put the organization's own data out of reach. It also
  // lets a Hub employee sent here by app/portal/layout.tsx actually land,
  // rather than being bounced on by the firm-membership gate.
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';
  const isSelfShelledCounselRoute =
    pathname === '/counsel/request' ||
    pathname === '/counsel/welcome' ||
    pathname === '/counsel/access-ended';
  if (isSelfShelledCounselRoute) return <>{children}</>;

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
        <h1 className="text-2xl text-foreground">
          Counsel mode is not available
        </h1>
        <p className="text-sm text-muted mt-2">
          Auth is not configured on this deployment. Set the Supabase
          environment variables and redeploy.
        </p>
      </div>
    );
  }
  // Distinguish a genuine sign-out from a transient session-read
  // failure. A real null redirects to sign-in (correct). A thrown
  // read - corrupted cookie, Edge decode error, or a stale-bundle
  // hiccup during a deploy - must NOT evict the user; we show a soft
  // reconnect screen that retries in place instead. See
  // getCurrentUserResult / SessionReconnect.
  const userResult = await getCurrentUserResult();
  if ('error' in userResult) {
    return <SessionReconnect signInHref="/sign-in?next=/counsel" />;
  }
  const user = userResult.user;
  if (!user) redirect('/sign-in?next=/counsel');

  // Counsel is now invitation-only: a signed-in user without firm
  // membership cannot reach the dashboard. They are routed to:
  //   - /counsel/accept-invite (already-existing firm member invite)
  //   - /counsel/request (public application form)
  // /counsel/onboarding still exists but is reachable only from a
  // valid grant via /counsel/welcome - the layout still gates it on
  // firm membership in the same way as the rest.
  const myFirms = await listMyFirms();

  // Case-scoped co-counsel GUEST shell. A signed-in user who is co-counsel on
  // a firm matter (case_collaborators role 'attorney') but is NOT a firm
  // member gets a STRIPPED Counsel view: their matter(s) and nothing else. We
  // resolve this only when they have no firm membership (a firm member is
  // never a guest) and enforce the path allowlist here - this layout wraps
  // EVERY /counsel/* route, so it is the server-side chokepoint that rejects a
  // guest anywhere outside their case(s). Default-deny.
  if (myFirms.length === 0) {
    const guest = await getGuestContext();
    if (guest) {
      // A co-counsel guest keeps READ access to their matter when the
      // organization's TRIAL LAPSES, and loses it when the organization is
      // SUSPENDED. The two are the same FirmAccessState on purpose, and this
      // is the one place the difference matters.
      //
      // A lapse is a billing fact about the firm. The guest is an outside
      // attorney the firm invited onto one matter; cutting them off takes a
      // matter away from the lawyer working it in order to punish a third
      // party for someone else's invoice, and nothing about the lapse makes
      // the grant improper.
      //
      // A suspension is the abuse-response state, the same one that justifies
      // stopping outbound mail and calendar invitations in Advottic's name.
      // While it holds, an account the FIRM provisioned is a channel the
      // suspension exists to close, not a neutral third party, so the merits
      // argument above does not reach it.
      //
      // Their WRITES are refused either way: requireActiveFirm sits in the
      // actions and does not care whether the caller is a member or a guest.
      //
      // No loop is reachable. /counsel/access-ended is short-circuited above,
      // before this branch begins, so a redirected guest lands there and never
      // reaches guestPathAllowed.
      if (guest.firmId) {
        const { firmSuspended } = await import('@/lib/firm-trials');
        if (await firmSuspended(guest.firmId)) redirect(ACCESS_ENDED_PATH);
      }
      const locale = await getLocaleCookie();
      // Force-change wall: a provisioned guest who still owes their first-login
      // password change is parked on that page until it's done.
      if (
        guest.mustChangePassword &&
        pathname !== '/counsel/guest/password'
      ) {
        redirect('/counsel/guest/password');
      }
      // Path scope: anything outside their matter(s) / guest pages is denied.
      if (!guest.mustChangePassword && !guestPathAllowed(guest, pathname)) {
        redirect(guestFallbackPath(guest));
      }
      return (
        <div
          className="dark counsel-shell min-h-screen flex flex-col text-cream-100"
          style={
            guest.firm
              ? ({
                  ['--firm-accent' as string]: guest.firm.accentColor,
                  ['--accent-on' as string]: accentOn(guest.firm.accentColor),
                } as React.CSSProperties)
              : undefined
          }
        >
          <LocaleProvider initialLocale={locale}>
            <CounselTrialBanner
              guest
              firmName={guest.firm?.name ?? ''}
              {...(guest.firmId
                ? await trialNotice(guest.firmId)
                : { trialEndsAt: null, daysLeft: null })}
            />
            <CounselGuestHeader
              firm={guest.firm}
              homeHref={guestFallbackPath(guest)}
              displayName={guest.displayName ?? guest.email ?? 'Guest'}
              email={guest.email ?? ''}
              avatarUrl={await resolveGuestAvatar(guest.userId)}
            />
            <div className="flex-1 flex w-full max-w-none mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
              <main className="flex-1 min-w-0">{children}</main>
            </div>
            <footer className="border-t border-forest-700/40 bg-forest-950/80 backdrop-blur">
              <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 py-4 text-[11px] text-cream-100/55 flex flex-wrap items-center justify-between gap-2">
                <p>Advottic &middot; Guest access to your assigned matter.</p>
                <p>Powered by Techno Optics</p>
              </div>
            </footer>
          </LocaleProvider>
        </div>
      );
    }
  }

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

  // Access gate, layer one of two, and the weaker one. This is a COURTESY to
  // a browser: it puts a person who can no longer use the product on a page
  // that explains why and hands them their data. It is NOT the gate. The gate
  // is requireActiveFirm inside the write paths, because every 'use server'
  // export is a public HTTP endpoint that stays callable no matter what this
  // layout renders.
  //
  // firmTrialState reads a fresh clock every call, so nothing here may be
  // cached or hoisted: a cached state outlives the trial end, which is exactly
  // the staleness that having no scheduled job removes.
  //
  // It can also THROW, on a read failure or a stored timestamp that will not
  // parse, and that throw must travel. A catch that yields an access state
  // would turn this whole fail-closed design into a fail-open one in two
  // lines. "Could not determine access" is not "this caller may proceed". A
  // request with no firm at all is the other thing, and only that one
  // proceeds, which is why this sits under `if (active)`.
  //
  // The state is also kept, for the banner further down. It is the answer this
  // request already computed rather than a second read of the same fact: a
  // second read is a second answer, and the one thing worse than a banner that
  // cannot see a closure is a banner that disagrees with the gate above it.
  let accessEnded = false;
  if (active) {
    const state = await firmTrialState(active.firm.id);
    accessEnded = state === 'export_only';
    const destination = counselAccessRedirect(pathname, state);
    if (destination) redirect(destination);
  }

  // User's chosen UI language (#14). LocaleProvider below translates
  // only the UI chrome wrapped in <T>, leaving firm data verbatim.
  const locale = await getLocaleCookie();

  // Per-firm surface toggles: a firm can hide the global search box and
  // the Time & Billing group. Read once here and thread down to the
  // header (mobile nav), the sidebar, and the Ask Advottic bar.
  const surface = active
    ? await getFirmSurfaceSettings(active.firm.id)
    : DEFAULT_FIRM_SURFACE_SETTINGS;

  // The letters in front of this firm's request references, for the scope
  // readout at the top of the rail. Its own read rather than part of
  // getFirmSurfaceSettings, for the reason that helper's comment gives:
  // `ticket_prefix` arrives with a migration that may not be applied, and
  // naming it in that select would take the surface toggles down with it.
  //
  // It is never empty, and the readout is truthful anyway: a firm that has
  // set nothing, whose column is missing, or that typed something unusable
  // all land on the allocator's default, which is literally the prefix its
  // references carry. So this shows what the firm's references say, not a
  // guess at what they might say.
  const ticketPrefix = active
    ? await getFirmTicketPrefix(active.firm.id)
    : null;

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
              ['--accent-on' as string]: accentOn(active.firm.accentColor),
            } as React.CSSProperties)
          : undefined
      }
    >
     <LocaleProvider initialLocale={locale}>
      {active ? (
        <CounselTrialBanner
          firmName={active.firm.name}
          // Whether the gate on THIS request found the organization closed.
          // The banner cannot work that out from the dates it is given,
          // because a suspension closes an organization whatever its dates
          // say. Only /counsel/accept-invite still renders this banner once
          // an organization is closed; every other path in the shell has
          // already been redirected away by the gate above.
          accessEnded={accessEnded}
          // The membership this layout already resolved, not a fourth
          // membership check. It decides whether the notice offers the
          // download or names who can run it; the export route authorizes
          // itself either way.
          canExport={FIRM_ADMIN_ROLES.includes(active.membership.role)}
          {...(await trialNotice(active.firm.id))}
        />
      ) : null}
      <CounselHeader
        firm={active?.firm ?? null}
        membership={active?.membership ?? null}
        memberships={myFirms}
        tenantMode={isTenantSubdomain}
        locale={locale}
        hideTimeBilling={surface.hideTimeBilling}
        hideSearch={surface.hideSearch}
      />
      <SidebarCollapseProvider>
        {/* The rail runs flush against the content column: no page padding
            and no gap on this row, because both of those are what made the
            sidebar read as a floating panel. The padding moved onto <main>,
            which is the only thing on this row that wanted it. */}
        <div className="flex-1 flex w-full max-w-none mx-auto">
          {active ? (
            <CounselSidebarShell>
              <CounselSidebar
                firm={active.firm}
                membership={active.membership}
                pathname={pathname}
                tenantMode={isTenantSubdomain}
                hideTimeBilling={surface.hideTimeBilling}
                ticketPrefix={ticketPrefix}
              />
            </CounselSidebarShell>
          ) : null}
          <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
            {/* The Ask Advottic bar normally sits at the top of every
                Counsel page. The dashboard at /counsel renders its own
                welcome banner above the Ask bar and then handles its
                own ordering, so we skip rendering it from the layout
                for that one route. */}
            {active &&
            pathname !== '/counsel' &&
            // A request detail is a two-pane workspace: it renders the Ask bar
            // inside its right rail instead, so a full-width bar can't span
            // both panes or steal height from either scroller.
            !/^\/counsel\/intake\/[^/]+$/.test(pathname) &&
            !surface.hideSearch ? (
              <AskAdvottic />
            ) : null}
            {children}
          </main>
        </div>
      </SidebarCollapseProvider>
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
            </Link>{' '}
            &middot; Powered by Techno Optics
          </p>
        </div>
      </footer>
     </LocaleProvider>
    </div>
  );
}

/**
 * The guest's profile picture, from the account they signed in with:
 * profiles.avatar_url is seeded from the auth provider's avatar at signup,
 * with the live auth metadata (Google/OAuth picture) as fallback. Null when
 * the account has no picture - the menu then falls back to initials.
 */
async function resolveGuestAvatar(userId: string): Promise<string | null> {
  try {
    const { createAdminSupabase } = await import('@/lib/supabase/admin');
    const admin = createAdminSupabase();
    if (admin) {
      const { data } = await admin
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle();
      const fromProfile = (data as { avatar_url: string | null } | null)?.avatar_url;
      if (fromProfile) return fromProfile;
    }
    const { getCurrentUser } = await import('@/lib/supabase/server');
    const user = await getCurrentUser();
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (meta.avatar_url as string | undefined) || (meta.picture as string | undefined) || null;
  } catch {
    return null;
  }
}
