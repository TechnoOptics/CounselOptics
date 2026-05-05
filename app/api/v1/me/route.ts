import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken } from '@/lib/api-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me
 *
 * Sanity-check endpoint for the public API. Returns the firm and / or
 * user the bearer token resolves to, and the granted scopes. Useful
 * for integrations to confirm their token is alive without making a
 * destructive call.
 *
 * Auth: Authorization: Bearer adv_<token>
 */
export async function GET(req: NextRequest) {
  const verified = await verifyApiToken(req.headers.get('authorization'));
  if (!verified) {
    return NextResponse.json(
      { error: 'Invalid or expired token.' },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    token_id: verified.id,
    firm_id: verified.firmId,
    user_id: verified.userId,
    scopes: verified.scopes,
  });
}
