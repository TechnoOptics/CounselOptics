import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserResult, isSupabaseConfigured } from '@/lib/supabase/server';
import { SessionReconnect } from '@/components/auth/SessionReconnect';
import { getWorkspacePersonaResult } from '@/lib/persona';
import { exitPortalPreviewAction } from '@/lib/firm-actions';
import { HubNavLink, type HubNavItem } from '@/components/portal/HubNavLink';
import { LocaleProvider, T } from '@/components/i18n/LocaleProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { getLocaleCookie } from '@/lib/i18n/locale';

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
        <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Hub is not available
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2">
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
      <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
        <div className="popup-panel max-w-md w-full p-8 space-y-3 text-center">
          <p className="eyebrow justify-center">Advottic</p>
          <h1 className="font-display text-2xl font-medium text-cream-100">
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
  // External-vendor preview: an outside collaborator, not in-house
  // staff. Relabel the workspace and drop internal-only surfaces
  // (company trainings) so the owner sees what a vendor really sees.
  const isExternal = persona.preview === true && persona.external === true;
  const railKicker = isExternal ? 'Vendor access' : 'Client hub';
  const locale = await getLocaleCookie();
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

  const primary: NavItem[] = externalView
    ? [{ href: '/portal', label: 'Home', hint: 'Your items & status' }]
    : [
        { href: '/portal', label: 'Home', hint: 'Your dashboard' },
        { href: '/portal/requests', label: 'My requests', hint: 'Track everything' },
      ];
  if (!externalView && can('requests.create')) {
    primary.push({
      href: '/portal/new',
      label: 'New request',
      hint: 'Ask legal',
    });
  }
  if (!externalView) {
    primary.push({
      href: '/portal/forms',
      label: 'Forms',
      hint: 'Fill, sign & download',
    });
    primary.push({
      href: '/portal/check',
      label: 'Check a document',
      hint: 'Score it against policy',
    });
  }
  if (!externalView && can('review')) {
    primary.push({
      href: '/review-my-document',
      label: reviewLabel,
      hint: 'AI document insight',
    });
  }
  const workspace: NavItem[] = externalView
    ? [
        { href: '/portal/documents', label: 'Documents', hint: 'Sign, comment & archive' },
        { href: '/portal/profile', label: 'Profile', hint: 'Reminders + notifications' },
        { href: '/portal/help', label: 'Help', hint: 'Contact us' },
      ]
    : [
        { href: '/portal/documents', label: 'Documents', hint: 'Your files' },
        { href: '/portal/calendar', label: 'Calendar', hint: 'Your meetings' },
        { href: '/portal/trainings', label: 'Trainings', hint: 'Assigned by legal' },
        { href: '/portal/profile', label: 'Profile', hint: 'Reminders + notifications' },
        { href: '/portal/help', label: 'Help', hint: 'Contact Advottic' },
      ];

  return (
   <LocaleProvider initialLocale={locale}>
    <div
      className="dark counsel-shell min-h-screen flex text-cream-100"
      style={
        { ['--firm-accent' as string]: firm.accentColor } as React.CSSProperties
      }
    >
      {/* Left rail */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-forest-700/40 bg-forest-950/70 backdrop-blur sticky top-0 h-screen">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-forest-700/30">
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
              className="h-8 w-8 rounded-lg flex-none inline-flex items-center justify-center text-black text-[13px] font-bold"
              style={{ backgroundColor: firm.accentColor }}
              aria-hidden
            >
              {firm.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p
              className="text-[13px] font-semibold text-cream-100 truncate"
              data-no-translate
            >
              {firm.name}
            </p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-cream-100/60">
              <T>{railKicker}</T>
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {primary.map((i) => (
            <HubNavLink key={i.href + i.label} item={i} />
          ))}
          <div className="pt-4 mt-3 border-t border-forest-700/30">
            <p className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-cream-100/30">
              <T>Workspace</T>
            </p>
            {workspace.map((i) => (
              <HubNavLink key={i.label} item={i} />
            ))}
          </div>
        </nav>

        <div className="px-3 py-4 border-t border-forest-700/30 space-y-3">
          <LanguageSwitcher initialLocale={locale} variant="light" />
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="w-full text-left px-3 py-2 rounded-lg text-[12.5px] text-cream-100/55 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
              title={`Signed in as ${who}`}
            >
              <T>Sign out</T>
              <span
                className="block text-[10.5px] text-cream-100/35 truncate"
                data-no-translate
              >
                {who}
              </span>
            </button>
          </form>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden border-b border-forest-700/40 bg-forest-950/80 backdrop-blur sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
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
                className="h-7 w-7 rounded-md inline-flex items-center justify-center text-black text-[12px] font-bold"
                style={{ backgroundColor: firm.accentColor }}
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
            <LanguageSwitcher initialLocale={locale} variant="light" />
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="px-2 py-1 rounded text-cream-100/50 hover:text-cream-100"
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

        <footer className="border-t border-forest-700/40 bg-forest-950/70 backdrop-blur">
          <div className="px-4 sm:px-8 lg:px-12 py-3.5 text-[11px] text-cream-100/60 flex flex-wrap items-center justify-between gap-2">
            <p>
              {ownBrand ? (
                <span className="font-semibold text-cream-100" data-no-translate>
                  {firm.name}
                </span>
              ) : (
                <>
                  <span
                    className="font-semibold text-cream-100"
                    data-no-translate
                  >
                    {firm.name}
                  </span>{' '}
                  · <T>Powered by Advottic</T>
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
