import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meetings · Counsel' };

/**
 * Meetings is a v1 stub. The full integration requires:
 *
 *   - Microsoft 365: register an Azure AD app, request the
 *     `Calendars.ReadWrite` permission, OAuth flow + token refresh,
 *     Graph API integration. Half-day of work after the Azure
 *     portal step.
 *   - Zoom: register a Zoom Marketplace app, OAuth flow, meeting
 *     create endpoint. Half-day after the marketplace step.
 *
 * Both registrations happen on the operator's account (I cannot
 * register apps on third-party developer portals). This page makes
 * the "future state" clear and offers manual capture today so the
 * feature is at least visible in the UI.
 */
export default async function CounselMeetingsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Meetings</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Calendar & meeting links
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Connect your Microsoft 365 calendar and Zoom account to schedule meetings
          straight from a case or client. v1 ships the wiring as stubs - the OAuth flow
          lands once the developer-portal apps are registered on your end.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <ConnectorCard
          name="Microsoft 365"
          description="Outlook calendar, Teams meeting links."
          status="Coming soon"
          docsHref="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app"
        />
        <ConnectorCard
          name="Zoom"
          description="Schedule and host Zoom meetings without leaving Advottic."
          status="Coming soon"
          docsHref="https://marketplace.zoom.us/develop/create"
        />
      </section>

      <section className="card p-5 sm:p-6 ring-1 ring-amber-300/40 dark:ring-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20">
        <p className="eyebrow mb-2">What you can do today</p>
        <ul className="text-sm text-ink-700 dark:text-cream-100/80 space-y-1.5 leading-relaxed">
          <li>
            Capture meeting details on a case (date, location, attendees) using the
            existing hearing panel - the same UI works for any meeting.
          </li>
          <li>
            Paste a Zoom or Teams link into a case description or chat channel; everyone
            with access opens it from there.
          </li>
          <li>
            Send calendar invites from your existing Outlook / Google / iCloud account.
            Advottic will surface the linked event once the OAuth integration ships.
          </li>
        </ul>
      </section>

      <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
        Need this faster? Email{' '}
        <a className="underline" href="mailto:contact@advottic.com">
          contact@advottic.com
        </a>{' '}
        and tell us which integration to build first.
      </p>
    </div>
  );
}

function ConnectorCard({
  name,
  description,
  status,
  docsHref,
}: {
  name: string;
  description: string;
  status: string;
  docsHref: string;
}) {
  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-forest-900 dark:text-cream-100">{name}</p>
        <span className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/85 text-[10px] tracking-wider">
          {status.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
        {description}
      </p>
      <button type="button" disabled className="btn-secondary mt-4 opacity-60 cursor-not-allowed">
        Connect (coming soon)
      </button>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-2">
        Operator setup:{' '}
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          register the app
        </a>{' '}
        on the developer portal first.
      </p>
    </article>
  );
}
