/**
 * OAuth provider definitions for Microsoft 365 + Zoom. Each provider
 * exposes its endpoints, scope list, and the env vars that hold the
 * client_id + client_secret.
 *
 * Both flows are standard authorization-code with PKCE optional;
 * Microsoft requires PKCE for SPA / public clients but accepts
 * confidential clients (server-side) without it. Zoom does not
 * require PKCE for server-to-server.
 *
 * The redirect URI is shared across providers:
 *   https://advottic.com/api/integrations/<provider>/callback
 * Set this exact URL on the Microsoft Entra "Web platform redirect
 * URIs" and the Zoom Marketplace OAuth "Redirect URL". The actual
 * incoming origin is enforced by the route handler.
 */

export type IntegrationProvider = 'microsoft' | 'zoom';

export type ProviderConfig = {
  /** Slug used in URLs and DB rows. */
  id: IntegrationProvider;
  /** Human-friendly name shown in the UI ("Microsoft 365"). */
  label: string;
  /** Authorization endpoint - where the user gets redirected to consent. */
  authorizeUrl: string;
  /** Token endpoint - where the callback exchanges code for tokens. */
  tokenUrl: string;
  /** OAuth scopes. Joined with ' ' (Microsoft) or ' ' (Zoom). */
  scopes: string[];
  /** Env var name holding the OAuth client_id. */
  clientIdEnv: string;
  /** Env var name holding the OAuth client_secret. */
  clientSecretEnv: string;
  /** Endpoint that returns the connected user's profile (email + name). */
  profileUrl: string;
};

/**
 * Microsoft Entra authority tenant segment.
 *
 * The `/common` (multi-tenant) endpoint is rejected with AADSTS50194
 * for any app registered single-tenant - and even after an app is
 * flipped to multi-tenant, Entra's signInAudience change is
 * eventually-consistent and keeps throwing 50194 on the token leg for
 * several minutes while it propagates. Pinning the authority to the
 * firm's own tenant removes that dependency entirely (deterministic,
 * works the instant the deploy is live) and is tighter security for an
 * in-house tool: only this tenant's work/school accounts can use the
 * app, regardless of the app's multi-tenant flag.
 *
 * Override per environment with MICROSOFT_TENANT_ID (accepts the tenant
 * GUID, the *.onmicrosoft.com domain, or any verified custom domain).
 * Defaults to the Techno Optics tenant's verified domain so the flow
 * works on redeploy with no new Vercel env var.
 */
const MICROSOFT_TENANT =
  process.env.MICROSOFT_TENANT_ID?.trim() || 'technooptics.com';

export const MICROSOFT_CONFIG: ProviderConfig = {
  id: 'microsoft',
  label: 'Microsoft 365',
  authorizeUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
  tokenUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`,
  // offline_access = receive a refresh_token. Calendars.ReadWrite covers
  // listing + creating events. User.Read fills the "connected as" UI.
  scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite'],
  clientIdEnv: 'MICROSOFT_CLIENT_ID',
  clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
  profileUrl: 'https://graph.microsoft.com/v1.0/me',
};

export const ZOOM_CONFIG: ProviderConfig = {
  id: 'zoom',
  label: 'Zoom',
  authorizeUrl: 'https://zoom.us/oauth/authorize',
  tokenUrl: 'https://zoom.us/oauth/token',
  // Zoom General App granular scopes (the legacy `user:read` /
  // `meeting:write` shorthand was retired in favor of resource-prefixed
  // names). user:read:user fills the "connected as" UI.
  // meeting:write:meeting covers POST /users/{id}/meetings.
  // meeting:read:list_meetings covers GET /users/{id}/meetings.
  scopes: [
    'user:read:user',
    'meeting:write:meeting',
    'meeting:read:list_meetings',
  ],
  clientIdEnv: 'ZOOM_CLIENT_ID',
  clientSecretEnv: 'ZOOM_CLIENT_SECRET',
  profileUrl: 'https://api.zoom.us/v2/users/me',
};

export const PROVIDERS: Record<IntegrationProvider, ProviderConfig> = {
  microsoft: MICROSOFT_CONFIG,
  zoom: ZOOM_CONFIG,
};

export function getProviderConfig(
  provider: string,
): ProviderConfig | null {
  if (provider === 'microsoft') return MICROSOFT_CONFIG;
  if (provider === 'zoom') return ZOOM_CONFIG;
  return null;
}

/**
 * Are the OAuth credentials for this provider configured? Used to
 * gate the Connect button on the meetings page and the route
 * handlers - we never want to start an OAuth flow with empty creds.
 */
export function isProviderConfigured(provider: ProviderConfig): boolean {
  return Boolean(
    process.env[provider.clientIdEnv]?.trim() &&
      process.env[provider.clientSecretEnv]?.trim(),
  );
}

/**
 * Compute the redirect URI used in the OAuth flow.
 *
 * In production every tenant origin (advottic.com, enterprise.advottic.com,
 * <slug>.advottic.com) routes the OAuth callback through a single canonical
 * URL: https://advottic.com/api/integrations/<provider>/callback. That's
 * the only URL we register on Zoom + Microsoft Entra, and it stays valid
 * regardless of which subdomain the user started from. Strict Mode in
 * the Zoom Marketplace would reject any other host.
 *
 * Override the canonical origin with INTEGRATION_REDIRECT_ORIGIN if you
 * need to test from a non-production host (eg. a Vercel preview that's
 * been added to the developer-portal allow list). When the env var is
 * not set we fall back to the request origin so localhost + preview
 * deploys keep working without code changes.
 */
export function buildRedirectUri(
  provider: ProviderConfig,
  origin: string,
): string {
  const canonical = process.env.INTEGRATION_REDIRECT_ORIGIN?.trim();
  const base = canonical && canonical.length > 0 ? canonical : origin;
  return `${base.replace(/\/+$/, '')}/api/integrations/${provider.id}/callback`;
}

/**
 * Cookie domain used by the OAuth state cookie. When the OAuth flow
 * starts from a tenant subdomain (eg. enterprise.advottic.com) and the
 * callback runs on the canonical host (advottic.com), the state cookie
 * must be readable on both - so we set it with a shared parent domain.
 *
 * Configured via OAUTH_COOKIE_DOMAIN (eg. ".advottic.com"). Falling
 * back to undefined keeps localhost + preview deploys working: the
 * cookie defaults to host-only, which matches the legacy per-origin
 * behaviour.
 */
export function getOAuthCookieDomain(): string | undefined {
  const v = process.env.OAUTH_COOKIE_DOMAIN?.trim();
  return v && v.length > 0 ? v : undefined;
}
