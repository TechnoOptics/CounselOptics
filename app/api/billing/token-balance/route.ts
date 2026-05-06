import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCombinedTokenBalance } from '@/lib/token-economy';
import { MONTHLY_TOKEN_GRANT, type TierSlug } from '@/lib/token-packages';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/token-balance
 *
 * Cheap polling endpoint for the TokenBalanceGauge. Returns the
 * combined balance (firm pool + personal), broken-out values, and
 * the user's monthly grant for the gauge fill calculation.
 *
 * No auth required to fail soft - the gauge will hide when this
 * returns empty.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { combined: 0, firmPool: null, personal: 0, monthlyGrant: 0 },
      { status: 200 },
    );
  }

  const firmCtx = await getActiveFirmContext().catch(() => null);
  const balance = await getCombinedTokenBalance({
    userId: user.id,
    firmId: firmCtx?.firm.id ?? null,
  });

  // Resolve the user's tier for the grant size. Read from
  // subscriptions; firm context overrides with the firm's tier when
  // the firm has its own subscription.
  const supabase = createServerSupabase();
  let tier: TierSlug = 'free';
  if (firmCtx?.firm.id) {
    // For firm pool balances we display the firm's per-seat grant.
    // The firm's own subscription tier table may not exist yet;
    // best-effort lookup.
    const { data } = await supabase
      .from('subscriptions')
      .select('tier')
      .eq('firm_id', firmCtx.firm.id)
      .maybeSingle();
    const t = (data as { tier?: string } | null)?.tier;
    if (t && (t in MONTHLY_TOKEN_GRANT)) tier = t as TierSlug;
  } else {
    const { data } = await supabase
      .from('subscriptions')
      .select('tier')
      .eq('user_id', user.id)
      .maybeSingle();
    const t = (data as { tier?: string } | null)?.tier;
    if (t && (t in MONTHLY_TOKEN_GRANT)) tier = t as TierSlug;
  }

  const monthlyGrant = MONTHLY_TOKEN_GRANT[tier] ?? 0;

  return NextResponse.json({
    combined: balance.combined,
    firmPool: balance.firmPool,
    personal: balance.personal,
    monthlyGrant,
  });
}
