import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import {
  MICROSOFT_CONFIG,
  ZOOM_CONFIG,
  isProviderConfigured,
  type ProviderConfig,
} from '@/lib/integration-oauth';
import { isIntegrationEncryptionConfigured } from '@/lib/integration-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { DisconnectButton } from './disconnect-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meetings · Counsel' };

type Connection = {
  provider: string;
  account_email: string | null;
  account_display_name: string | null;
  connected_at: string;
  revoked_at: string | null;
};

/**
 * Calendar + meeting connectors. v1 wires the OAuth handshake for
 * Microsoft 365 (Outlook calendar + Teams meeting links via Graph)
 * and Zoom (meeting create/list via Zoom REST). Operator setup:
 *
 *   Microsoft 365:
 *     1. https://entra.microsoft.com -> App registrations -> New
 *     2. Redirect URI (Web): https://advottic.com/api/integrations/microsoft/callback
 *     3. Permissions: User.Read, Calendars.ReadWrite, offline_access
 *     4. Certificates & secrets -> New client secret
 *     5. In Vercel env: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
 *
 *   Zoom:
 *     1. https://marketplace.zoom.us/develop/create -> OAuth app
 *     2. Redirect URL: https://advottic.com/api/integrations/zoom/callback
 *     3. Scopes: user:read, meeting:write, meeting:read
 *     4. In Vercel env: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 *
 *   Both:
 *     - INTEGRATION_ENCRYPTION_KEY (base64, 32 random bytes) for
 *       AES-GCM token encryption at rest. openssl rand -base64 32.
 */
export default async function CounselMeetingsPage({
  searchParams,
}: {
  searchParams?: { connected?: string; integration_error?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  // Read this firm's existing connections via service role - easier
  // than threading user-scoped supabase through the helpers, and we
  // already fetched the active firm context which is the only firm
  // we'll show data for.
  let connections: Connection[] = [];
  const admin = createAdminSupabase();
  if (admin) {
    const { data } = await admin
      .from('firm_integrations')
      .select(
        'provider, account_email, account_display_name, connected_at, revoked_at',
      )
      .eq('firm_id', ctx.firm.id);
    connections = (data ?? []) as Connection[];
  }
  const byProvider = new Map(
    connections
      .filter((c) => !c.revoked_at)
      .map((c) => [c.provider, c] as const),
  );

  const justConnected = searchParams?.connected;
  const integrationError = searchParams?.integration_error;
  const encryptionReady = isIntegrationEncryptionConfigured();

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Meetings</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Calendar &amp; meeting links
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Connect the firm&rsquo;s Microsoft 365 calendar and Zoom account so meetings
          flow into Advottic alongside cases and clients. Tokens are encrypted at
          rest with AES-GCM; only firm owners and admins can disconnect.
        </p>
      </header>

      {justConnected && (
        <p className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
          Connected to {justConnected}. The integration is now available across this firm.
        </p>
      )}
      {integrationError && (
        <p className="rounded-lg bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-300/50 dark:ring-rose-500/30 px-4 py-3 text-sm text-rose-900 dark:text-rose-200">
          {decodeURIComponent(integrationError)}
        </p>
      )}

      {!encryptionReady && (
        <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-300/60 dark:ring-amber-500/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <strong>Operator note:</strong>{' '}
          INTEGRATION_ENCRYPTION_KEY is not set. Generate with
          {' '}<code className="font-mono">openssl rand -base64 32</code>{' '}
          and add it as a Sensitive env var in Vercel before connecting an integration.
          Without it, token encryption fails and connections will be rejected.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <ConnectorCard
          firmId={ctx.firm.id}
          config={MICROSOFT_CONFIG}
          connection={byProvider.get('microsoft') ?? null}
          docsHref="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app"
        />
        <ConnectorCard
          firmId={ctx.firm.id}
          config={ZOOM_CONFIG}
          connection={byProvider.get('zoom') ?? null}
          docsHref="https://marketplace.zoom.us/develop/create"
        />
      </section>

      <section className="card p-5 sm:p-6 ring-1 ring-emerald-300/40 dark:ring-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20">
        <p className="eyebrow mb-2">Schedule &amp; invite</p>
        {byProvider.size > 0 ? (
          <>
            <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
              You&rsquo;re connected. Set up a Teams or Zoom meeting and
              every attendee gets a branded invite with a one-tap
              add-to-calendar - it also lands on the shared team
              calendar.
            </p>
            <div className="mt-4">
              <Link href="/counsel/calendar" className="btn-primary">
                Schedule a meeting
              </Link>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
            Connect Microsoft 365 or Zoom above, then head to the{' '}
            <Link
              href="/counsel/calendar"
              className="underline font-semibold"
            >
              shared calendar
            </Link>{' '}
            to schedule meetings and send invites.
          </p>
        )}
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
  firmId,
  config,
  connection,
  docsHref,
}: {
  firmId: string;
  config: ProviderConfig;
  connection: Connection | null;
  docsHref: string;
}) {
  const credentialsConfigured = isProviderConfigured(config);
  const isConnected = connection !== null;

  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-forest-900 dark:text-cream-100">
          {config.label}
        </p>
        <StatusBadge
          state={
            isConnected
              ? 'connected'
              : credentialsConfigured
                ? 'ready'
                : 'pending-setup'
          }
        />
      </div>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
        {config.id === 'microsoft'
          ? 'Outlook calendar + Teams meeting links via Microsoft Graph.'
          : 'Schedule and host Zoom meetings without leaving Advottic.'}
      </p>

      {isConnected && connection && (
        <p className="text-xs text-ink-600 dark:text-cream-100/65 mt-3">
          {/*
            Audit W20 V3 CR-40: the connection used to render only
            the email, which could belong to a different domain than
            the firm's primary identity (e.g. an operator who
            connected Zoom with their personal email while signed
            into the firm under a different alias). Now we lead
            with the display name when available and put the email
            in a quieter monospaced tail so a new staff member can
            see WHO connected the integration as well as which
            account is in use.
          */}
          Connected by{' '}
          <span className="text-forest-900 dark:text-cream-100 font-semibold">
            {connection.account_display_name ?? connection.account_email ?? 'unknown'}
          </span>
          {connection.account_display_name && connection.account_email && (
            <>
              {' '}using{' '}
              <span className="font-mono text-ink-700 dark:text-cream-100/85">
                {connection.account_email}
              </span>
            </>
          )}
          {' '}&middot;{' '}
          {new Date(connection.connected_at).toLocaleDateString()}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {isConnected ? (
          <DisconnectButton firmId={firmId} provider={config.id} />
        ) : credentialsConfigured ? (
          <Link
            href={`/api/integrations/${config.id}/authorize`}
            className="btn-primary"
          >
            Connect {config.label}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="btn-secondary opacity-60 cursor-not-allowed"
            title={`Set ${config.clientIdEnv} and ${config.clientSecretEnv} in Vercel env first.`}
          >
            Connect (env not set)
          </button>
        )}
      </div>

      {!credentialsConfigured && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-2 leading-relaxed">
          Operator setup:{' '}
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-forest-900 dark:hover:text-cream-100"
          >
            register the app
          </a>
          , then set{' '}
          <code className="font-mono">{config.clientIdEnv}</code> +{' '}
          <code className="font-mono">{config.clientSecretEnv}</code>{' '}
          in Vercel env.
        </p>
      )}
    </article>
  );
}

function StatusBadge({
  state,
}: {
  state: 'connected' | 'ready' | 'pending-setup';
}) {
  const tone =
    state === 'connected'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
      : state === 'ready'
        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
        : 'bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/85';
  const label =
    state === 'connected'
      ? 'CONNECTED'
      : state === 'ready'
        ? 'READY TO CONNECT'
        : 'PENDING SETUP';
  return (
    <span className={`badge ${tone} text-[10px] tracking-wider font-semibold`}>
      {label}
    </span>
  );
}
