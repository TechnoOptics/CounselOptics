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

export const MICROSOFT_CONFIG: ProviderConfig = {
  id: 'microsoft',
  label: 'Microsoft 365',
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
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
  // Zoom's General App OAuth scope strings. meeting:write covers
  // create + update, user:read fills the "connected as" UI.
  scopes: ['user:read', 'meeting:write', 'meeting:read'],
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
 * Compute the redirect URI used in the OAuth flow. Anchored on the
 * request origin so localhost dev + Vercel preview deploys + production
 * each get a same-origin callback. The exact URL must match what was
 * registered on the developer portal (case-sensitive, trailing-slash
 * sensitive). On Vercel, register both the apex
 * https://advottic.com/api/integrations/<provider>/callback AND any
 * other deploy origin you connect from.
 */
export function buildRedirectUri(
  provider: ProviderConfig,
  origin: string,
): string {
  return `${origin.replace(/\/+$/, '')}/api/integrations/${provider.id}/callback`;
}
