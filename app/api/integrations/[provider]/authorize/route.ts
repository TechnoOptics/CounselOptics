import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { callerIsFirmAdmin } from '@/lib/firm-authz';
import {
  buildRedirectUri,
  getOAuthCookieDomain,
  getProviderConfig,
  isProviderConfigured,
} from '@/lib/integration-oauth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/{provider}/authorize
 *
 * Start the OAuth handshake for the active firm. Redirects the user
 * to the provider's consent screen with a CSRF-resistant `state`
 * cookie that the callback verifies before accepting tokens.
 *
 * The state cookie also carries the firm_id so the callback knows
 * which firm to write into firm_integrations - the user might switch
 * firms in another tab during the redirect dance, and we never want
 * to attribute a connection to the wrong firm.
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
    return NextResponse.json(
      {
        error: `${provider.label} OAuth is not configured. Set ${provider.clientIdEnv} and ${provider.clientSecretEnv} in Vercel env, then redeploy.`,
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?next=${encodeURIComponent(`/api/integrations/${provider.id}/authorize`)}`,
        request.url,
      ),
    );
  }
  const firmCtx = await getActiveFirmContext();
  if (!firmCtx) {
    return NextResponse.redirect(new URL('/counsel', request.url));
  }
  // A courtesy, NOT the gate. The callback authorizes the firm again
  // against the session that arrives there, because that is the request
  // which writes, and it is reachable without ever passing through here.
  // This check exists so somebody whose role cannot connect an
  // integration is told before they hand a provider their consent, rather
  // than after.
  if (!(await callerIsFirmAdmin(firmCtx.firm.id))) {
    const dest = new URL('/counsel/calendar', request.url);
    dest.searchParams.set(
      'integration_error',
      'Only an owner or admin of this organization can connect an integration.',
    );
    return NextResponse.redirect(dest);
  }

  // CSRF / replay protection: random state, stored in a httpOnly cookie
  // bound to this request. Callback compares cookie to query state and
  // rejects mismatches.
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const origin = new URL(request.url).origin;
  // Capture the originating origin so the callback (which may run on
  // a different host - the canonical one - if INTEGRATION_REDIRECT_ORIGIN
  // is set) can bounce the user back to where they started.
  const statePayload = JSON.stringify({
    nonce: stateNonce,
    firmId: firmCtx.firm.id,
    userId: user.id,
    origin,
  });
  const stateB64 = Buffer.from(statePayload).toString('base64url');

  const redirectUri = buildRedirectUri(provider, origin);

  const params = new URLSearchParams({
    client_id: process.env[provider.clientIdEnv]!.trim(),
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: provider.scopes.join(' '),
    state: stateB64,
    // Ask for a refresh token where the provider supports it.
    access_type: 'offline',
    prompt: 'consent',
  });
  const authUrl = `${provider.authorizeUrl}?${params.toString()}`;

  const res = NextResponse.redirect(authUrl);
  // Cookie name is provider-scoped so simultaneous Microsoft + Zoom
  // connect flows don't trample each other. We bind the cookie to the
  // shared parent domain (eg. .advottic.com) when configured, so the
  // callback running on the canonical host can read it even when the
  // flow started from a tenant subdomain.
  const cookieDomain = getOAuthCookieDomain();
  cookies().set(`adv_oauth_${provider.id}`, stateNonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    // 30 min: a single-use random nonce, so widening the window does
    // not weaken CSRF protection, but it survives slow MFA / account
    // picking / consent (10 min was too tight in practice).
    maxAge: 1800,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return res;
}
