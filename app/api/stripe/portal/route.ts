import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';
import { blockedIosAppPurchase } from '@/lib/iap-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // App Store Guideline 3.1.1. The Stripe Customer Portal is not just
  // "manage" - depending on portal configuration it can switch plan, resume
  // a cancelled subscription, or start a new one, so it is a purchase
  // surface. Fail closed for the iOS app, same as checkout.
  const blockedIos = blockedIosAppPurchase(req);
  if (blockedIos) return blockedIos;

  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe SDK unavailable.' }, { status: 503 });

  const sub = await getCurrentSubscription();
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: 'No Stripe customer on file yet.' }, { status: 400 });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    req.headers.get('origin') ||
    `https://${req.headers.get('host')}`;

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/billing`,
  });

  return NextResponse.json({ url: session.url });
}
