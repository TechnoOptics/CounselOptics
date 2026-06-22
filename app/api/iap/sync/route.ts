import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { fetchActiveIapTier, recordIapEntitlement } from '@/lib/iap-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/iap/sync
 *
 * Called by the iOS app right after an in-app purchase (or "Restore
 * Purchases") completes. We DON'T trust the client's claim - we re-read
 * the authoritative entitlement from RevenueCat REST (keyed on the
 * signed-in user's id, which is the RevenueCat appUserID) and write the
 * subscriptions row, so Pro unlocks immediately instead of waiting for
 * the webhook.
 */
export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  try {
    const r = await fetchActiveIapTier(user.id);
    await recordIapEntitlement({
      userId: user.id,
      tier: r.tier,
      active: r.active,
      productId: r.productId,
      expiresAt: r.expiresAt,
    });
    return NextResponse.json({ active: r.active, tier: r.tier });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not sync purchase.' },
      { status: 500 },
    );
  }
}
