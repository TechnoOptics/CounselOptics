import type { Metadata } from 'next';
import { GiftForm } from './gift-form';
import { GIFT_TIERS, GIFT_DURATIONS } from '@/lib/gift';
import { getCurrentUser } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: { absolute: 'Gift Advottic · Advottic' },
  description:
    'Buy Advottic for someone else - personal-safety alerts, legal-prep tools, AI assistance. They get a one-time setup link and the subscription activates on their account.',
  alternates: { canonical: '/gift' },
  openGraph: {
    title: 'Gift Advottic',
    description:
      'Pay once. Recipient redeems with a one-tap email. Subscription runs on their account for the duration you chose.',
    url: '/gift',
    type: 'website',
  },
};

export const dynamic = 'force-dynamic';

/**
 * /gift - gifter-facing flow.
 *
 * Form collects: recipient name / email / (optional) phone /
 * (optional) personal note + tier + duration. Submits to
 * /api/gift/checkout which creates a Stripe Checkout Session and
 * redirects there. After payment, /api/stripe/webhook sends the
 * redemption email to the recipient and bumps gift_subscriptions
 * status to paid_pending_claim.
 *
 * The form works for both signed-in users (whose email pre-fills
 * the gifter contact) and guests. Guest gifters supply their own
 * name + email; we use them only for the post-purchase receipt and
 * any refund correspondence.
 */
export default async function GiftPage() {
  const user = await getCurrentUser().catch(() => null);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
      <header className="space-y-2 text-center">
        <p className="eyebrow justify-center">Gift Advottic</p>
        <h1 className="font-display text-[34px] sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Buy Advottic for someone you care about.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-2xl mx-auto">
          You pay once. They get an email with a one-tap setup link.
          Subscription activates on their account for the duration you
          choose. They can upgrade or extend later from their billing
          page.
        </p>
      </header>

      <section className="card p-6 sm:p-8">
        <GiftForm
          tiers={GIFT_TIERS}
          durations={GIFT_DURATIONS}
          initialGifterEmail={user?.email ?? ''}
          initialGifterName={
            (user?.user_metadata?.full_name as string | undefined) ?? ''
          }
          signedIn={Boolean(user)}
        />
      </section>

      <section className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed space-y-2 max-w-2xl mx-auto">
        <p>
          <strong className="text-forest-900 dark:text-cream-100">
            What the recipient receives:
          </strong>{' '}
          a polished email from Advottic with their PIN, your personal
          note (if you left one), and a single Activate button. Clicking
          it walks them through a 30-second sign-up (email + a single
          one-time code), then flips their account to the tier you
          bought. Safe Witness, Bella, and the Wear OS app are all
          available the moment they finish.
        </p>
        <p>
          <strong className="text-forest-900 dark:text-cream-100">
            Refunds:
          </strong>{' '}
          full refund if requested before the recipient claims the
          gift. After claim, the subscription is on the recipient's
          account and refunds follow the standard policy.
        </p>
      </section>
    </main>
  );
}
