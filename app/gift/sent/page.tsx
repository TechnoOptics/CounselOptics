import Link from 'next/link';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { GIFT_TIERS, formatDollars } from '@/lib/gift';

export const dynamic = 'force-dynamic';

/**
 * /gift/sent?id=<gift_id>
 *
 * Lands the gifter here after Stripe Checkout completes successfully.
 * We render a confirmation + status snapshot of the gift row. The
 * webhook may have already flipped the status to paid_pending_claim
 * (typical) or might still be processing (rare race). Either is fine
 * because the page focuses on "what happens next" rather than
 * "did Stripe finish."
 */
export default async function GiftSentPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  type GiftSnapshot = {
    recipient_name: string;
    recipient_email: string;
    tier_slug: string;
    duration_months: number;
    amount_cents: number;
    status: string;
  };
  const giftId = searchParams.id?.trim() ?? '';
  let gift: GiftSnapshot | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(giftId)) {
    const admin = createAdminSupabase();
    if (admin) {
      const { data } = await admin
        .from('gift_subscriptions')
        .select(
          'recipient_name, recipient_email, tier_slug, duration_months, amount_cents, status',
        )
        .eq('id', giftId)
        .maybeSingle();
      gift = (data as GiftSnapshot | null) ?? null;
    }
  }
  const tier = gift ? GIFT_TIERS.find((t) => t.slug === gift.tier_slug) : null;

  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 py-14 space-y-6 text-center">
      <div
        aria-hidden
        className="mx-auto inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        Gift sent.
      </h1>
      {gift ? (
        <p className="text-[15px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
          We're emailing <strong>{gift.recipient_name}</strong> at{' '}
          <strong>{gift.recipient_email}</strong> a redemption link for{' '}
          <strong>
            {tier?.name ?? gift.tier_slug} · {gift.duration_months}{' '}
            {gift.duration_months === 1 ? 'month' : 'months'}
          </strong>{' '}
          ({formatDollars(gift.amount_cents)}). The subscription
          activates on their account the moment they claim it.
        </p>
      ) : (
        <p className="text-[15px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
          Your gift is being processed. We'll send the recipient their
          redemption link as soon as Stripe confirms the payment.
        </p>
      )}
      <div className="pt-2 space-y-2">
        <Link href="/" className="btn-primary inline-flex">
          Back to home
        </Link>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          The recipient can claim the gift any time. Need to resend the
          email or refund?{' '}
          <a className="underline" href="mailto:contact@advottic.com">
            contact@advottic.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
