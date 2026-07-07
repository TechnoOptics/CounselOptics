import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, getPriceForTier, isStripeConfigured } from '@/lib/stripe';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import {
  getCurrentSubscription,
  getProfile,
  upsertSubscriptionFromStripe,
} from '@/lib/storage';
import type { Tier } from '@/lib/types';
import { PERSONAL_TIERS, type PersonalTierKey } from '@/lib/personal-tiers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error:
          'Stripe is not configured on the server. Set STRIPE_SECRET_KEY and STRIPE_MONTHLY_PRICE_ID.',
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe SDK unavailable.' }, { status: 503 });

  let body: { tier?: Tier; slug?: PersonalTierKey } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Two checkout paths share this route:
  //  - `slug`: the new 5-rung personal ladder (lib/personal-tiers.ts). The
  //    price id comes from that rung's env var.
  //  - `tier`: the legacy coarse basic/standard/pro path (kept working).
  let priceId: string | undefined;
  let tierLabel: string;
  const personal = body.slug ? PERSONAL_TIERS.find((t) => t.key === body.slug) : undefined;
  if (personal) {
    if (personal.priceUsd === 0 || !personal.stripeEnv) {
      return NextResponse.json({ error: 'That plan is free — no checkout needed.' }, { status: 400 });
    }
    priceId = process.env[personal.stripeEnv]?.trim() || undefined;
    tierLabel = personal.key;
    if (!priceId) {
      return NextResponse.json(
        { error: `The ${personal.name} plan isn't available for purchase yet.` },
        { status: 503 },
      );
    }
  } else {
    const validTiers: Tier[] = ['basic', 'standard', 'pro'];
    const tier: Tier = validTiers.includes(body.tier as Tier) ? (body.tier as Tier) : 'standard';
    priceId = getPriceForTier(tier);
    tierLabel = tier;
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for tier "${tier}".` },
        { status: 503 },
      );
    }
  }

  // Get or create a Stripe customer; persist the customer id on the
  // subscription row. We pass everything we already know about the
  // user (email, display name, locale) on creation so the Stripe
  // customer record is recognizable in the dashboard rather than a
  // bare cus_xxx with no name. Metadata is kept generous - it shows
  // up next to the customer in Stripe and is invaluable for support.
  const existing = await getCurrentSubscription();
  const profile = await getProfile().catch(() => null);
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    profile?.displayName ??
    null;
  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: displayName ?? undefined,
      preferred_locales: profile?.language ? [profile.language] : undefined,
      metadata: {
        supabase_user_id: user.id,
        provider: (user.app_metadata?.provider as string | undefined) ?? 'unknown',
        signup_at: user.created_at ?? '',
        representation: profile?.representation ?? '',
        organization: profile?.organization ?? '',
      },
    });
    customerId = customer.id;
    await upsertSubscriptionFromStripe({
      userId: user.id,
      stripeCustomerId: customerId,
      status: existing?.status ?? 'inactive',
      priceId: existing?.priceId ?? null,
    });
  } else if (displayName) {
    // Customer exists but might be missing a name (created in an
    // earlier deploy before this enrichment). Update best-effort.
    try {
      await stripe.customers.update(customerId, {
        name: displayName,
        email: user.email ?? undefined,
      });
    } catch {
      /* swallow; not critical */
    }
  }

  // Pin the success/cancel URLs to the host the user is ACTUALLY on,
  // not NEXT_PUBLIC_SITE_URL. If they started on advottic.com (apex)
  // and we sent them back to www.advottic.com, the session cookies
  // they had on apex would not be visible on www, and they would land
  // on /billing as a signed-out user. Mirror the OAuth-redirect fix.
  const origin =
    req.headers.get('origin') ||
    `https://${req.headers.get('host')}` ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://advottic.com';

  const hasUsedTrial = Boolean(existing?.stripeSubscriptionId);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?success=1`,
    cancel_url: `${origin}/billing?canceled=1`,
    allow_promotion_codes: true,
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id, tier: tierLabel },
    subscription_data: {
      metadata: { supabase_user_id: user.id, tier: tierLabel },
      // 7-day free trial for first-time subscribers; skip for users who've
      // already had a Stripe subscription (returning subscribers).
      ...(hasUsedTrial ? {} : { trial_period_days: 7 }),
    },
  });

  return NextResponse.json({ url: session.url });
}
