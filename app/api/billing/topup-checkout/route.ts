import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getTokenPackage } from '@/lib/token-packages';
import { blockedIosAppPurchase } from '@/lib/iap-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/topup-checkout
 *
 * Creates a Stripe Checkout session for one of the four token
 * packs. Body: { packageId: 'boost'|'boost_plus'|'power'|'mega',
 * firmPool?: boolean }.
 *
 * The session metadata carries:
 *   - package_id: the pack id (so the webhook re-resolves the
 *     token amount from token-packages.ts, never trusting the
 *     amount that flows through Stripe)
 *   - user_id: always set to the buying user
 *   - firm_id: set when firmPool=true AND the user is acting in
 *     firm context. Webhook credits the firm pool.
 *
 * The Stripe Price IDs come from env vars (one per pack). Missing
 * env => 503 with a clear error so the checkout button doesn't
 * silently fail.
 */
export async function POST(req: NextRequest) {
  const iosBlock = blockedIosAppPurchase(req);
  if (iosBlock) return iosBlock;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  let body: { packageId?: string; firmPool?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const pack = getTokenPackage(String(body.packageId ?? '').trim());
  if (!pack) {
    return NextResponse.json({ error: 'Unknown package.' }, { status: 400 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured on this deploy.' },
      { status: 503 },
    );
  }
  const priceId = process.env[pack.stripePriceEnv]?.trim();
  if (!priceId) {
    return NextResponse.json(
      {
        error: `Missing ${pack.stripePriceEnv}. Create the Stripe Product + Price for "${pack.label}" and set the env var.`,
      },
      { status: 503 },
    );
  }

  // Firm context (when the user requested firmPool=true).
  let firmId: string | null = null;
  if (body.firmPool) {
    try {
      const ctx = await getActiveFirmContext();
      firmId = ctx?.firm.id ?? null;
    } catch {
      /* fine - falls back to personal balance */
    }
  }

  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? 'https://advottic.com';
  const successUrl = `${site}/billing?topup=success`;
  const cancelUrl = `${site}/billing?topup=canceled`;

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[product]': 'token_topup',
    'metadata[package_id]': pack.id,
    'metadata[user_id]': user.id,
    customer_email: user.email ?? '',
  });
  if (firmId) params.set('metadata[firm_id]', firmId);

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return NextResponse.json(
      { error: `Stripe returned ${resp.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const session = (await resp.json()) as { url?: string; id?: string };
  if (!session.url) {
    return NextResponse.json(
      { error: 'Stripe did not return a checkout URL.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ url: session.url, id: session.id });
}
