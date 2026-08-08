import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserResult, isSupabaseConfigured } from '@/lib/supabase/server';
import { SessionReconnect } from '@/components/auth/SessionReconnect';
import { getWorkspacePersonaResult } from '@/lib/persona';
import { ACCESS_ENDED_PATH } from '@/lib/firm-access';
import { firmTrialState } from '@/lib/firm-trials';
import { exitPortalPreviewAction } from '@/lib/firm-actions';
import { HubNavLink, type HubNavItem } from '@/components/portal/HubNavLink';
import { LocaleProvider, T } from '@/components/i18n/LocaleProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { getLocaleCookie } from '@/lib/i18n/locale';
import { getCounselTheme } from '@/lib/counsel-theme';
import { counselShellClass } from '@/lib/counsel-theme-values';
import { CounselThemeToggle } from '@/components/counsel/CounselThemeToggle';
import { CounselNotificationBell } from '@/components/counsel/CounselNotificationBell';
import { accentOn, portalAccent } from '@/lib/accent-text';
import { PORTAL_REQUEST_FAMILIES } from '@/lib/portal-request-families';
import { loadPortalOpenRequests } from '@/lib/portal-open-requests';

export const dynamic = 'force-dynamic';

/**
 * The Enterprise client / employee Hub shell.
 *
 * A classy black-and-gold workspace for everyone who is NOT on the
 * legal team: in-house staff and approved outside collaborators. Left
 * rail, calm header, personalized dashboard. Same persona chokepoint
 * as before (lib/persona.ts) - only the chrome is elevated:
 *   - signed out            -> /sign-in?next=/portal
 *   - legal / admin persona -> /counsel
 *   - employee persona      -> render the Hub
 *   - none                  -> a calm "request access" card
 */
type NavItem = HubNavItem;

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 mt-10">
        <h1 className="text-2xl text-foreground">
          Hub is not available
        </h1>
        <p className="text-sm text-muted mt-2">
          Auth is not configured on this deployment.
        </p>
      </div>
    );
  }

  // A genuine null redirects to sign-in; a thrown session read
  // (corrupted cookie / Edge decode / stale-bundle deploy hiccup)
  // must NOT sign the user out - hold their place and retry.
  const userResult = await getCurrentUserResult();
  if ('error' in userResult) {
    return <SessionReconnect signInHref="/sign-in?next=/portal" />;
  }
  const user = userResult.user;
  if (!user) redirect('/sign-in?next=/portal');

  // Resolve the persona, surfacing a thrown session read as reconnect
  // rather than a misleading "No workspace yet" card. A genuine
  // `{ kind: 'none' }` still falls through to that card below.
  const personaResult = await getWorkspacePersonaResult();
  if ('error' in personaResult) {
    return <SessionReconnect signInHref="/sign-in?next=/portal" />;
  }
  const persona = personaResult.persona;
  if (persona.kind === 'legal' || persona.kind === 'admin') {
    redirect('/counsel');
  }

  if (persona.kind === 'none') {
    return (
      // Pre-workspace dead end, reached before any preference is read.
      // Dark on purpose: it is the same surface every signed-out counsel
      // page uses, and there is no chrome here to change it from.
      <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
        <div className="popup-panel max-w-md w-full p-8 space-y-3 text-center">
          <p className="eyebrow justify-center">Advottic</p>
          <h1 className="text-2xl font-medium text-cream-100">
            No workspace yet
          </h1>
          <p className="text-sm text-cream-100/70 leading-relaxed">
            Your account isn&rsquo;t connected to an organization&rsquo;s
            legal workspace yet.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Link
              href="/join"
              className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
            >
              Request access
            </Link>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="btn w-full text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5 justify-center"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (persona.kind !== 'employee') redirect('/portal');
  const { firm, employee } = persona;

  // The same courtesy redirect the counsel shell does, and the same rules: a
  // fresh state on every request, never cached, and never wrapped in a catch
  // that yields one. The Hub has no path of its own that must stay reachable,
  // so unlike the counsel side there is no allowlist to consult: the
  // destination is outside /portal entirely and app/counsel/layout.tsx
  // short-circuits it before any firm-membership gate, so a Hub employee lands
  // there rather than being bounced onward.
  //
  // The switch is on the union rather than an equality test, so a third access
  // state added later is a compile error here and not a silent default-allow.
  const access = await firmTrialState(firm.id);
  switch (access) {
    case 'active':
      break;
    case 'export_only':
      redirect(ACCESS_ENDED_PATH);
      break;
    default: {
      const unhandled: never = access;
      throw new Error(
        `portal layout has no rule for the access state ${String(unhandled)}.`,
      );
    }
  }
  // External-vendor preview: an outside collaborator, not in-house
  // staff. Relabel the workspace and drop internal-only surfaces
  // (company trainings) so the owner sees what a vendor really sees.
  const isExternal = persona.preview === true && persona.external === true;
  const railKicker = isExternal ? 'Vendor access' : 'Client hub';
  const locale = await getLocaleCookie();
  // Dark unless this reader opted into light. Resolved on the server so
  // the first frame is already right; see lib/counsel-theme.ts.
  const theme = await getCounselTheme();
  const who = employee.displayName || employee.email;
  const firstName = (employee.displayName || employee.email || 'there')
    .split(/[\s@.]/)[0]
    .replace(/^./, (c) => c.toUpperCase());
  const can = (f: 'requests.create' | 'requests.message' | 'review') =>
    persona.entitlements.includes(f);
  const ownBrand =
    Boolean(firm.logoUrl) &&
    (firm.metadata as Record<string, unknown> | undefined)
      ?.hideAdvotticLogo === true;
  const reviewLabel = ownBrand ? 'Document review' : 'Advottic Review';

  // An external party (an outside collaborator / counterparty who cannot file
  // internal requests) gets a deliberately minimal hub: no AI review, no "my
  // requests", no calendar or trainings. All they do is see the status of
  // their items and work the documents (sign, comment, archive). Preview-as-
  // vendor counts too. In-house staff keep the full hub.
  const externalView = isExternal || !can('requests.create');

  // Counts for the rail badges and the condition for the banner. One
  // read, shared with the page below through React's per-request memo,
  // so the rail and the tiles cannot disagree about how many requests
  // this person has open. An external collaborator files nothing, so
  // there is nothing to count and no query is made.
  const requests = externalView
    ? null
    : await loadPortalOpenRequests(user.id, firm.id);

  /*
   * The rail, in three sections with tiny uppercase labels.
   *
   * The grouping is what the employee is doing, not what the system
   * stores: ask for something, look at your own things, tell somebody
   * how it is going. Every row is a page that exists; a capability the
   * firm has not granted is absent rather than present and dead.
   */
  const getHelp: NavItem[] = [
    {
      href: '/portal',
      label: 'Home',
      hint: externalView ? 'Your items and status' : 'Your dashboard',
    },
  ];
  if (!externalView && can('requests.create')) {
    getHelp.push({
      href: '/portal/new',
      label: 'Ask legal',
      hint: 'File a request',
    });
  }
  if (!externalView) {
    getHelp.push({
      href: '/portal/check',
      label: 'Check a document',
      hint: 'Score it against policy',
    });
  }
  if (!externalView && can('review')) {
    getHelp.push({
      href: '/review-my-document',
      label: reviewLabel,
      hint: 'AI document insight',
    });
  }

  const myThings: NavItem[] = [];
  if (!externalView) {
    myThings.push({
      href: '/portal/requests',
      label: 'My requests',
      hint: 'Track everything',
      count: requests?.open.length,
    });
    if (can('requests.create')) {
      // The four request families, each carrying its own open count.
      // The href is the same filter the tile on Home links to, so the
      // badge and the page it opens are the same set of rows.
      for (const family of PORTAL_REQUEST_FAMILIES) {
        myThings.push({
          href: `/portal/requests?family=${family.key}`,
          label: family.title,
          hint: family.blurb,
          count: requests?.byFamily[family.key],
        });
      }
    }
  }
  // What the documents page actually offers: read it, download it. It has
  // never let anyone sign, comment or archive from here, and a nav hint
  // that promises three things a page does not do is a promise the product
  // keeps breaking every time somebody follows it.
  myThings.push({
    href: '/portal/documents',
    label: 'Documents',
    hint: externalView ? 'View and download' : 'Your files',
  });
  if (!externalView) {
    myThings.push({
      href: '/portal/forms',
      label: 'Forms',
      hint: 'Fill, sign and download',
    });
    myThings.push({
      href: '/portal/calendar',
      label: 'Calendar',
      hint: 'Your meetings',
    });
    myThings.push({
      href: '/portal/trainings',
      label: 'Trainings',
      hint: 'Assigned by legal',
    });
  }

  const yourSay: NavItem[] = [
    // /portal/help is the feedback and support form: it opens a ticket
    // with the Advottic team. Named for what it does rather than for
    // "help articles", which this product does not publish.
    { href: '/portal/help', label: 'Feedback and support', hint: 'Tell us how it is going' },
    {
      href: '/portal/profile',
      label: 'Profile and preferences',
      hint: 'Reminders and notifications',
    },
  ];

  const sections: Array<{ label: string; items: NavItem[] }> = [
    { label: 'Get help', items: getHelp },
    { label: 'My things', items: myThings },
    { label: 'Your say', items: yourSay },
  ];
  // The compact mobile row cannot carry three sections, so it carries
  // the first one, which is the half of the rail that starts something.
  const primary = getHelp;

  /*
   * The banner above everything, and it appears only when one of these
   * two things is actually true of this person's own requests. An
   * always-on strip is furniture; this one is a fact.
   */
  const banner =
    requests && requests.overdue.length > 0
      ? {
          text:
            requests.overdue.length === 1
              ? 'One of your requests is past the date you asked legal for.'
              : `${requests.overdue.length} of your requests are past the date you asked legal for.`,
          href: '/portal/requests',
          cta: 'See which',
        }
      : requests && requests.awaitingYou.length > 0
        ? {
            text:
              requests.awaitingYou.length === 1
                ? 'Legal has replied on one request and is waiting on you.'
                : `Legal has replied on ${requests.awaitingYou.length} requests and is waiting on you.`,
            href: '/portal/requests',
            cta: 'Open them',
          }
        : null;

  // The portal's own accent. A firm that chose one keeps it; the
  // platform default gives way to the portal teal, because the employee
  // hub is a different audience from the counsel workspace and should
  // not read as the same room. See lib/accent-text.ts.
  const accent = portalAccent(firm.accentColor);
  const initial = (employee.displayName || employee.email || '?')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  return (
   <LocaleProvider initialLocale={locale}>
    <div
      className={counselShellClass(theme, 'accent-scope min-h-screen flex text-foreground')}
      style={
        ({
          // `--firm-accent` is what the OKLCH derivation in
          // app/globals.css reads to compute `--accent-text`, and
          // `--accent` is the FILL the tints and the primary button
          // paint. Both are set, because setting only the first would
          // give the portal teal words inside gold-tinted pills.
          ['--firm-accent' as string]: accent,
          ['--accent' as string]: accent,
          ['--accent-on' as string]: accentOn(accent),
        } as React.CSSProperties)
      }
    >
      {/* Left rail. Flush and full height on --surface with a single
          right edge, the same geometry the counsel rail moved to. */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-edge bg-surface sticky top-0 h-screen">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-edge">
          {firm.logoUrl ? (
            // Keep the firm mark's real shape (often rectangular):
            // fixed height, natural width, never cropped or rounded.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={firm.logoUrl}
              alt={firm.name}
              className="h-8 w-auto max-w-[150px] object-contain flex-none"
            />
          ) : (
            <span
              className="h-8 w-8 rounded-lg flex-none inline-flex items-center justify-center text-[13px] font-bold"
              style={{ backgroundColor: accent, color: accentOn(accent) }}
              aria-hidden
            >
              {firm.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p
              className="text-[13px] font-semibold text-foreground truncate"
              data-no-translate
            >
              {firm.name}
            </p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted">
              <T>{railKicker}</T>
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
          {sections
            .filter((s) => s.items.length > 0)
            .map((s) => (
              <div key={s.label} className="space-y-0.5">
                <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                  <T>{s.label}</T>
                </p>
                {s.items.map((i) => (
                  <HubNavLink key={i.href + i.label} item={i} />
                ))}
              </div>
            ))}
        </nav>

        {/* User card, pinned. Who you are, what you are here as, and the
            way out. The way back to a main workspace lives in the
            preview banner instead, because it is only true for someone
            previewing this hub from one. */}
        <div className="border-t border-edge px-3 py-3 space-y-2">
          <div className="flex items-center gap-2.5 px-1">
            <span
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-bold"
              style={{ backgroundColor: accent, color: accentOn(accent) }}
              aria-hidden
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[12.5px] font-semibold text-foreground"
                data-no-translate
              >
                {who}
              </span>
              <span className="block text-[10.5px] uppercase tracking-[0.16em] text-muted">
                <T>{railKicker}</T>
              </span>
            </span>
            <form action="/auth/sign-out" method="post" className="flex-none">
              <button
                type="submit"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                title={`Sign out of ${firm.name}`}
                aria-label="Sign out"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 3v9" />
                  <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
                </svg>
              </button>
            </form>
          </div>
          <LanguageSwitcher initialLocale={locale} variant="light" />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* The one live condition, above everything, and only when it is
            true of this person's own requests. */}
        {banner && (
          <div
            className="border-b border-edge px-4 py-2 sm:px-8 lg:px-12"
            style={{
              background:
                'color-mix(in oklab, var(--warn-text) 14%, transparent)',
            }}
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-warn-text">
              <T>{banner.text}</T>
              <Link href={banner.href} className="font-semibold underline">
                <T>{banner.cta}</T>
              </Link>
            </p>
          </div>
        )}

        {/* Top bar, over the content column only. Theme and the bell,
            which are the two things that belong to the reader rather
            than to the page. */}
        <div className="hidden md:flex items-center justify-end gap-2 border-b border-edge bg-surface px-4 py-2 sm:px-8 lg:px-12">
          <CounselThemeToggle theme={theme} />
          <CounselNotificationBell />
        </div>
        {/* Mobile top bar */}
        <header className="md:hidden border-b border-edge bg-surface sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {firm.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firm.logoUrl}
                alt={firm.name}
                className="h-7 w-auto max-w-[120px] object-contain"
              />
            ) : (
              <span
                className="h-7 w-7 rounded-md inline-flex items-center justify-center text-[12px] font-bold"
                style={{ backgroundColor: accent, color: accentOn(accent) }}
                aria-hidden
              >
                {firm.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="text-sm font-semibold truncate" data-no-translate>
              {firm.name}
            </span>
          </div>
          <nav className="flex items-center gap-1 text-[12px]">
            {primary.map((i) => (
              <HubNavLink
                key={i.href + i.label}
                item={i}
                variant="pill"
              />
            ))}
            <CounselThemeToggle theme={theme} />
            <LanguageSwitcher initialLocale={locale} variant="light" />
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="px-2 py-1 rounded text-muted hover:text-foreground"
              >
                <T>Out</T>
              </button>
            </form>
          </nav>
        </header>

        {persona.preview && (
          <div className="bg-gold-500/15 border-b border-gold-500/30 text-gold-100">
            <div className="px-4 sm:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span>
                <T>Previewing the hub as</T>{' '}
                <strong data-no-translate>{persona.previewRoleName}</strong>{' '}
                <T>- exactly what this role sees.</T>
              </span>
              <form action={exitPortalPreviewAction}>
                <button
                  type="submit"
                  className="underline font-semibold hover:opacity-80"
                >
                  <T>Exit preview</T>
                </button>
              </form>
            </div>
          </div>
        )}

        <main
          className="flex-1 w-full px-4 sm:px-8 lg:px-12 py-7 sm:py-9"
          data-first-name={firstName}
        >
          {children}
        </main>

        <footer className="border-t border-edge bg-surface">
          <div className="px-4 sm:px-8 lg:px-12 py-3.5 text-[11px] text-muted flex flex-wrap items-center justify-between gap-2">
            <p>
              {ownBrand ? (
                <span className="font-semibold text-foreground" data-no-translate>
                  {firm.name}
                </span>
              ) : (
                <>
                  <span
                    className="font-semibold text-foreground"
                    data-no-translate
                  >
                    {firm.name}
                  </span>{' '}
                  · <T>Powered by Techno Optics</T>
                </>
              )}
            </p>
            <p>
              <T>Signed in as</T>{' '}
              <span data-no-translate>{who}</span>
            </p>
          </div>
        </footer>
      </div>
    </div>
   </LocaleProvider>
  );
}
