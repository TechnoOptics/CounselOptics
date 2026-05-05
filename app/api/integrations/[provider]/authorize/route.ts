import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import {
  buildRedirectUri,
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

  // CSRF / replay protection: random state, stored in a httpOnly cookie
  // bound to this request. Callback compares cookie to query state and
  // rejects mismatches.
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const statePayload = JSON.stringify({
    nonce: stateNonce,
    firmId: firmCtx.firm.id,
    userId: user.id,
  });
  const stateB64 = Buffer.from(statePayload).toString('base64url');

  const origin = new URL(request.url).origin;
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
  // connect flows don't trample each other.
  cookies().set(`adv_oauth_${provider.id}`, stateNonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min
  });
  return res;
}
