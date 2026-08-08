import Link from 'next/link';
import {
  MICROSOFT_CONFIG,
  ZOOM_CONFIG,
  isProviderConfigured,
  type ProviderConfig,
} from '@/lib/integration-oauth';
import { isIntegrationEncryptionConfigured } from '@/lib/integration-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { ExternalLink } from '@/components/ExternalLink';
import { DisconnectButton } from '@/app/counsel/meetings/disconnect-button';

type Connection = {
  provider: string;
  account_email: string | null;
  account_display_name: string | null;
  connected_at: string;
  revoked_at: string | null;
};

/**
 * Calendar + meeting OAuth connectors. Originally lived on its own
 * route at /counsel/meetings, then merged into /counsel/calendar so
 * the firm sees one calendar surface instead of two. Renders a row
 * of provider cards (Microsoft 365, Zoom) and surfaces success /
 * error toasts from the OAuth callback.
 *
 * Operator setup:
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
export async function MeetingConnectors({
  firmId,
  connected,
  integrationError,
}: {
  firmId: string;
  /** Provider id from ?connected= on the page URL after OAuth success. */
  connected?: string;
  /** URL-encoded message from ?integration_error= on OAuth failure. */
  integrationError?: string;
}) {
  let connections: Connection[] = [];
  const admin = createAdminSupabase();
  if (admin) {
    const { data } = await admin
      .from('firm_integrations')
      .select(
        'provider, account_email, account_display_name, connected_at, revoked_at',
      )
      .eq('firm_id', firmId);
    connections = (data ?? []) as Connection[];
  }
  const byProvider = new Map(
    connections
      .filter((c) => !c.revoked_at)
      .map((c) => [c.provider, c] as const),
  );
  const encryptionReady = isIntegrationEncryptionConfigured();

  return (
    <section className="space-y-3">
      <div>
        <p className="eyebrow mb-1">Connections</p>
        <h2 className="text-xl font-medium tracking-[-0.01em] text-foreground">
          Calendar &amp; meeting providers
        </h2>
        <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
          Connect Microsoft 365 (Outlook calendar + Teams meeting
          links via Graph) or Zoom so scheduled meetings flow into
          Advottic alongside cases and clients. Tokens are encrypted
          at rest with AES-GCM; only firm owners and admins can
          disconnect.
        </p>
      </div>

      {connected && (
        <p className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
          Connected to {connected}. The integration is now available
          across this firm.
        </p>
      )}
      {integrationError && (
        <p className="rounded-lg bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-300/50 dark:ring-rose-500/30 px-4 py-3 text-sm text-rose-900 dark:text-rose-200">
          {decodeURIComponent(integrationError)}
        </p>
      )}

      {!encryptionReady && (
        <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-300/60 dark:ring-amber-500/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <strong>Operator note:</strong> INTEGRATION_ENCRYPTION_KEY
          is not set. Generate with{' '}
          <code className="font-mono">openssl rand -base64 32</code>{' '}
          and add it as a Sensitive env var in Vercel before
          connecting an integration. Without it, token encryption
          fails and connections will be rejected.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ConnectorCard
          firmId={firmId}
          config={MICROSOFT_CONFIG}
          connection={byProvider.get('microsoft') ?? null}
          docsHref="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app"
        />
        <ConnectorCard
          firmId={firmId}
          config={ZOOM_CONFIG}
          connection={byProvider.get('zoom') ?? null}
          docsHref="https://marketplace.zoom.us/develop/create"
        />
      </div>
    </section>
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
        <p className="font-semibold text-foreground">
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
      <p className="text-sm text-muted mt-1.5 leading-relaxed">
        {config.id === 'microsoft'
          ? 'Outlook calendar + Teams meeting links via Microsoft Graph.'
          : 'Schedule and host Zoom meetings without leaving Advottic.'}
      </p>

      {isConnected && connection && (
        <p className="text-xs text-muted mt-3">
          {/*
            Audit W20 V3 CR-40: lead with the display name when
            available; put the email in a quieter monospaced tail so
            staff can see WHO connected the integration as well as
            which account is in use.
          */}
          Connected by{' '}
          <span className="text-foreground font-semibold">
            {connection.account_display_name ?? connection.account_email ?? 'unknown'}
          </span>
          {connection.account_display_name && connection.account_email && (
            <>
              {' '}using{' '}
              <span className="font-mono text-foreground">
                {connection.account_email}
              </span>
            </>
          )}{' '}
          &middot;{' '}
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
        <p className="text-[11px] text-muted mt-2 leading-relaxed">
          Operator setup:{' '}
          <ExternalLink
            href={docsHref}
            className="underline hover:text-foreground"
          >
            register the app
          </ExternalLink>
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
        : 'bg-surface-2 text-foreground';
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
