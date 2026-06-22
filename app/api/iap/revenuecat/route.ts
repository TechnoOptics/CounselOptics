import { NextResponse, type NextRequest } from 'next/server';
import {
  fetchActiveIapTier,
  recordIapEntitlement,
  tierFromIosProduct,
} from '@/lib/iap-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/iap/revenuecat
 *
 * RevenueCat webhook - the durable source of truth for Apple IAP state.
 * Fires on INITIAL_PURCHASE / RENEWAL / CANCELLATION / EXPIRATION / etc.
 * Configure the URL + a fixed Authorization header value in the
 * RevenueCat dashboard (Project settings -> Integrations -> Webhooks);
 * we reject any request whose header doesn't match REVENUECAT_WEBHOOK_AUTH.
 *
 * The app_user_id on the event is the Supabase user id (we identify the
 * user to RevenueCat with it before purchase). We re-read the
 * authoritative entitlement via REST and write the subscriptions row,
 * falling back to the event payload only if the REST read fails.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!expected || req.headers.get('authorization') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { event?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const event = body.event ?? {};
  const appUserId =
    typeof event.app_user_id === 'string' ? event.app_user_id : null;
  // Skip anonymous ids - those have no Supabase account to attach to.
  if (!appUserId || appUserId.startsWith('$RCAnonymousID')) {
    return NextResponse.json({ ok: true });
  }

  try {
    const r = await fetchActiveIapTier(appUserId);
    await recordIapEntitlement({
      userId: appUserId,
      tier: r.tier,
      active: r.active,
      productId: r.productId,
      expiresAt: r.expiresAt,
    });
  } catch {
    // REST read failed - derive from the event payload as a fallback.
    const productId =
      typeof event.product_id === 'string' ? event.product_id : null;
    const type = typeof event.type === 'string' ? event.type : '';
    const active = [
      'INITIAL_PURCHASE',
      'RENEWAL',
      'UNCANCELLATION',
      'PRODUCT_CHANGE',
      'NON_RENEWING_PURCHASE',
      'SUBSCRIPTION_EXTENDED',
    ].includes(type);
    const expMs =
      typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null;
    try {
      await recordIapEntitlement({
        userId: appUserId,
        tier: tierFromIosProduct(productId),
        active,
        productId,
        expiresAt: expMs ? new Date(expMs).toISOString() : null,
      });
    } catch {
      // Swallow - returning 500 would make RevenueCat retry forever on a
      // genuinely un-writable event; the next event reconciles state.
    }
  }

  return NextResponse.json({ ok: true });
}
