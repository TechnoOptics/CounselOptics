import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  buildRedirectUri,
  getOAuthCookieDomain,
  getProviderConfig,
  isProviderConfigured,
} from '@/lib/integration-oauth';
import { encryptToken } from '@/lib/integration-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/{provider}/callback
 *
 * Provider redirects here with `code` + `state` after the user clicks
 * "Allow" on the consent screen. We:
 *   1. Verify the state nonce matches the cookie set by /authorize
 *      (CSRF + replay protection).
 *   2. Exchange the code for an access_token + refresh_token at the
 *      provider's token endpoint.
 *   3. Hit the provider's profile endpoint so we can store the
 *      connected account's email + display name.
 *   4. Encrypt the tokens with AES-GCM (lib/integration-tokens.ts)
 *      and upsert into firm_integrations using the service-role
 *      client so we bypass RLS for this write only.
 *   5. Redirect the user back to /counsel/meetings with ?connected=
 *      so the page can show a success toast.
 *
 * On any error path the user lands at
 * /counsel/meetings?error=<message> so they see what went wrong
 * without us swallowing the failure.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: { provider: string } },
) {
  const provider = getProviderConfig(ctx.params.provider);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  }
  if (!isProviderConfigured(provider)) {
    return redirectWithError(request, 'OAuth not configured.');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (oauthErr) {
    return redirectWithError(request, decodeURIComponent(oauthErr));
  }
  if (!code || !stateRaw) {
    return redirectWithError(request, 'Missing authorization response.');
  }

  let parsedState: {
    nonce?: string;
    firmId?: string;
    userId?: string;
    origin?: string;
  };
  try {
    parsedState = JSON.parse(
      Buffer.from(stateRaw, 'base64url').toString('utf8'),
    );
  } catch {
    return redirectWithError(request, 'Could not decode state.');
  }
  const cookieNonce = cookies().get(`adv_oauth_${provider.id}`)?.value;
  if (
    !cookieNonce ||
    !parsedState.nonce ||
    cookieNonce !== parsedState.nonce ||
    !parsedState.firmId ||
    !parsedState.userId
  ) {
    return redirectWithError(
      request,
      'OAuth state mismatch. Try connecting again.',
    );
  }

  // Exchange code for tokens. The redirect_uri sent here MUST byte-match
  // the one sent in /authorize - if INTEGRATION_REDIRECT_ORIGIN was set,
  // both routes resolve to the canonical host; otherwise both use the
  // request origin.
  const redirectUri = buildRedirectUri(provider, url.origin);
  const tokenBody = new URLSearchParams({
    client_id: process.env[provider.clientIdEnv]!.trim(),
    client_secret: process.env[provider.clientSecretEnv]!.trim(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
      cache: 'no-store',
    });
  } catch (err) {
    return redirectWithError(
      request,
      `Token exchange failed: ${err instanceof Error ? err.message : 'network error'}.`,
    );
  }
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    return redirectWithError(
      request,
      `Token exchange returned ${tokenRes.status}. ${body.slice(0, 200)}`,
    );
  }
  type TokenJson = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  let tokens: TokenJson;
  try {
    tokens = (await tokenRes.json()) as TokenJson;
  } catch {
    return redirectWithError(request, 'Token endpoint returned non-JSON.');
  }
  if (!tokens.access_token) {
    return redirectWithError(request, 'Token endpoint did not return access_token.');
  }

  // Fetch the connected account's profile so we can show
  // "Connected as john@firm.com" in the UI without exchanging tokens
  // every render.
  let accountEmail: string | null = null;
  let accountDisplayName: string | null = null;
  try {
    const profileRes = await fetch(provider.profileUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as Record<string, unknown>;
      // Microsoft Graph: { mail, userPrincipalName, displayName }
      // Zoom /users/me: { email, first_name, last_name, display_name }
      accountEmail =
        (profile.mail as string | null) ??
        (profile.userPrincipalName as string | null) ??
        (profile.email as string | null) ??
        null;
      const fromGraphOrZoom =
        (profile.displayName as string | null) ??
        (profile.display_name as string | null);
      const fromZoomNameParts = [profile.first_name, profile.last_name]
        .filter(Boolean)
        .join(' ');
      accountDisplayName = fromGraphOrZoom || fromZoomNameParts || null;
    }
  } catch {
    /* profile fetch is nice-to-have; do not fail the connection */
  }

  // Persist via service role; RLS on firm_integrations would block
  // an INSERT from anon (we don't yet have a session-scoped Supabase
  // client at this edge route).
  const admin = createAdminSupabase();
  if (!admin) {
    return redirectWithError(
      request,
      'Service role not configured. Cannot store integration.',
    );
  }
  let accessEnc: Buffer;
  let refreshEnc: Buffer | null = null;
  try {
    accessEnc = encryptToken(tokens.access_token);
    if (tokens.refresh_token) {
      refreshEnc = encryptToken(tokens.refresh_token);
    }
  } catch (err) {
    return redirectWithError(
      request,
      err instanceof Error ? err.message : 'Encryption failed.',
    );
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString()
    : null;

  // Upsert by (firm_id, provider) so re-connecting overwrites the
  // old credentials cleanly. Clear revoked_at on re-connect.
  const { error: upsertErr } = await admin.from('firm_integrations').upsert(
    {
      firm_id: parsedState.firmId,
      provider: provider.id,
      account_email: accountEmail,
      account_display_name: accountDisplayName,
      access_token_encrypted: accessEnc,
      refresh_token_encrypted: refreshEnc,
      expires_at: expiresAt,
      scope: tokens.scope ?? provider.scopes.join(' '),
      connected_by: parsedState.userId,
      connected_at: new Date().toISOString(),
      revoked_at: null,
      revoked_by: null,
    },
    { onConflict: 'firm_id,provider' },
  );
  if (upsertErr) {
    return redirectWithError(
      request,
      `Could not store integration: ${upsertErr.message}`,
    );
  }

  // Send the user back to the host they started from. When the flow
  // started on a tenant subdomain (eg. enterprise.advottic.com) the
  // callback ran on the canonical host - the `origin` carried in the
  // state lets us bounce them to the right place.
  //
  // Defense in depth: even though the state nonce was verified above,
  // we still validate the origin against an allow list so a malicious
  // crafted state can never trigger an open redirect.
  const requestOrigin = new URL(request.url).origin;
  const finalBase = isAllowedOrigin(parsedState.origin)
    ? parsedState.origin!
    : requestOrigin;
  const res = NextResponse.redirect(
    new URL(`/counsel/meetings?connected=${provider.id}`, finalBase),
  );
  // Clear the state cookie - it's been spent. Match the domain
  // attribute used at /authorize so the browser actually drops it.
  const cookieDomain = getOAuthCookieDomain();
  cookies().set(`adv_oauth_${provider.id}`, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return res;
}

function redirectWithError(req: NextRequest, message: string) {
  const dest = new URL('/counsel/meetings', req.url);
  dest.searchParams.set('integration_error', message);
  return NextResponse.redirect(dest);
}

/**
 * Origin whitelist for the post-callback redirect. We accept the
 * canonical advottic.com host and any subdomain of it (so tenant
 * subdomains like enterprise.advottic.com work without code changes
 * per tenant), plus localhost and *.vercel.app for dev / preview
 * deploys. Anything else falls back to the request origin.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.host.toLowerCase();
  if (host === 'advottic.com') return true;
  if (host.endsWith('.advottic.com')) return true;
  if (host === 'localhost' || host.startsWith('localhost:')) return true;
  if (host.endsWith('.vercel.app')) return true;
  return false;
}
