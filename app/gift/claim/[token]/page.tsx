import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';
import { GIFT_TIERS, formatDollars } from '@/lib/gift';
import { ClaimButton } from './claim-button';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: { absolute: 'Claim your Advottic gift · Advottic' },
  description: "Activate your gifted Advottic subscription.",
  robots: { index: false, follow: false },
};

/**
 * /gift/claim/[token]
 *
 * Recipient-facing redemption page. Reached from the email Advottic
 * sends after the gifter pays. The token in the URL is the random
 * 256-bit redemption_token from the gift_subscriptions row.
 *
 * States we handle:
 *   - Unknown / malformed token  -> 404
 *   - status = pending_payment   -> "Payment processing" friendly message
 *   - status = paid_pending_claim -> activation button
 *   - status = claimed           -> confirmation + go-to-app
 *   - status = expired / refunded -> graceful explainer
 *
 * Auth model: we render the page for everyone (no sign-in required
 * to SEE it). Activation requires a signed-in account - the claim
 * button server action checks and either activates or kicks the
 * user to /sign-in with next= preserving the claim path. Recipients
 * usually have no account yet, so the page also exposes a clear
 * "create account first" CTA.
 */
export default async function ClaimGiftPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  // Token format is base64url of 32 bytes = ~43 characters. Reject
  // obvious garbage before hitting the DB.
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) notFound();

  const admin = createAdminSupabase();
  if (!admin) {
    return (
      <ErrorShell title="Service unavailable">
        Gifts can't be redeemed right now. Try again shortly.
      </ErrorShell>
    );
  }
  const { data: row } = await admin
    .from('gift_subscriptions')
    .select(
      'id, recipient_name, recipient_email, tier_slug, duration_months, amount_cents, status, personal_note, gifter_name, gifter_email, expires_at',
    )
    .eq('redemption_token', token)
    .maybeSingle();
  if (!row) notFound();
  const gift = row as {
    id: string;
    recipient_name: string;
    recipient_email: string;
    tier_slug: string;
    duration_months: number;
    amount_cents: number;
    status: string;
    personal_note: string | null;
    gifter_name: string | null;
    gifter_email: string | null;
    expires_at: string | null;
  };

  const tierSpec = GIFT_TIERS.find((t) => t.slug === gift.tier_slug);
  const user = await getCurrentUser().catch(() => null);

  // pending_payment: Stripe hasn't confirmed yet (race or webhook
  // delay). Friendly explainer + suggestion to refresh.
  if (gift.status === 'pending_payment') {
    return (
      <ClaimShell
        title="Almost ready"
        tier={tierSpec?.name ?? gift.tier_slug}
        duration={gift.duration_months}
        gifter={gift.gifter_name ?? gift.gifter_email}
        personalNote={gift.personal_note}
      >
        <p className="text-[14px] text-ink-700 dark:text-cream-100/75">
          We're waiting for Stripe to confirm the payment. This usually
          takes seconds. Refresh in a minute and the Activate button
          will appear.
        </p>
      </ClaimShell>
    );
  }

  if (gift.status === 'refunded') {
    return (
      <ClaimShell
        title="This gift was refunded"
        tier={tierSpec?.name ?? gift.tier_slug}
        duration={gift.duration_months}
        gifter={gift.gifter_name ?? gift.gifter_email}
      >
        <p className="text-[14px] text-ink-700 dark:text-cream-100/75">
          The gifter requested a refund and the payment was returned.
          If you believe this is a mistake, reach out to{' '}
          <a href="mailto:contact@advottic.com" className="underline">
            contact@advottic.com
          </a>
          .
        </p>
      </ClaimShell>
    );
  }

  if (gift.status === 'expired') {
    return (
      <ClaimShell
        title="This gift expired"
        tier={tierSpec?.name ?? gift.tier_slug}
        duration={gift.duration_months}
        gifter={gift.gifter_name ?? gift.gifter_email}
      >
        <p className="text-[14px] text-ink-700 dark:text-cream-100/75">
          The subscription this gift unlocked has run its course. You
          can pick it back up any time from{' '}
          <Link href="/pricing" className="underline">
            /pricing
          </Link>
          .
        </p>
      </ClaimShell>
    );
  }

  if (gift.status === 'claimed') {
    return (
      <ClaimShell
        title="Already activated"
        tier={tierSpec?.name ?? gift.tier_slug}
        duration={gift.duration_months}
        gifter={gift.gifter_name ?? gift.gifter_email}
      >
        <p className="text-[14px] text-ink-700 dark:text-cream-100/75">
          You already claimed this gift. It's running on your account.
        </p>
        <Link href="/cases" className="btn-primary inline-flex mt-3">
          Go to my cases
        </Link>
        {gift.expires_at ? (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-2">
            Subscription expires{' '}
            {new Date(gift.expires_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            . Upgrade or extend any time from{' '}
            <Link href="/billing" className="underline">
              /billing
            </Link>
            .
          </p>
        ) : null}
      </ClaimShell>
    );
  }

  // paid_pending_claim: the normal activation flow. Two sub-cases:
  // (a) Recipient is signed in → show big Activate button.
  // (b) Recipient is NOT signed in → show "sign in to activate"
  //     button that bounces to /sign-in?next=/gift/claim/<token>.
  // We also gently warn when the signed-in user's email doesn't
  // match the gift recipient_email - they CAN still claim (the
  // gifter may have typed the wrong email or the recipient uses a
  // different address), but the heads-up prevents accidents.
  const recipientLooksMismatched =
    user?.email != null &&
    user.email.toLowerCase() !== gift.recipient_email.toLowerCase();

  return (
    <ClaimShell
      title="Your gift is ready"
      tier={tierSpec?.name ?? gift.tier_slug}
      duration={gift.duration_months}
      gifter={gift.gifter_name ?? gift.gifter_email}
      personalNote={gift.personal_note}
    >
      <p className="text-[14px] text-ink-700 dark:text-cream-100/75">
        Activate the subscription on{' '}
        <strong>{user?.email ?? gift.recipient_email}</strong>. It runs
        for <strong>{gift.duration_months} {gift.duration_months === 1 ? 'month' : 'months'}</strong>{' '}
        with full access to{' '}
        <strong>{tierSpec?.name ?? gift.tier_slug}</strong> features.
      </p>
      {recipientLooksMismatched && (
        <p className="text-[12.5px] text-amber-700 dark:text-amber-300 mt-2 leading-snug">
          Heads up: the gifter listed{' '}
          <strong>{gift.recipient_email}</strong> but you're signed in
          as <strong>{user?.email}</strong>. You can still activate -
          the subscription will land on the signed-in account.
        </p>
      )}
      <div className="mt-4">
        {user ? (
          <ClaimButton token={token} />
        ) : (
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/gift/claim/${token}`)}&email=${encodeURIComponent(gift.recipient_email)}`}
            className="btn-primary inline-flex"
          >
            Sign in to activate
          </Link>
        )}
      </div>
      <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-3 leading-snug">
        No account yet? Use the email above on the next screen. We send
        a one-time 6-digit code - no password to remember.
      </p>
    </ClaimShell>
  );
}

function ClaimShell({
  title,
  tier,
  duration,
  gifter,
  personalNote,
  children,
}: {
  title: string;
  tier: string;
  duration: number;
  gifter: string | null;
  personalNote?: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 py-12 space-y-6">
      <header className="text-center space-y-2">
        <p className="eyebrow justify-center">A gift from {gifter ?? 'someone'}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {title}
        </h1>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/70">
          {tier} · {duration} {duration === 1 ? 'month' : 'months'}
        </p>
      </header>
      {personalNote ? (
        <blockquote className="card p-4 italic text-[14px] text-ink-700 dark:text-cream-100/75 leading-relaxed border-l-2 border-gold-metal/60">
          &ldquo;{personalNote}&rdquo;
          {gifter ? (
            <footer className="not-italic text-[12px] text-ink-500 dark:text-cream-100/55 mt-2">
              - {gifter}
            </footer>
          ) : null}
        </blockquote>
      ) : null}
      <section className="card p-5 space-y-3">{children}</section>
    </main>
  );
}

function ErrorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 py-14 text-center space-y-3">
      <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100">
        {title}
      </h1>
      <p className="text-[14px] text-ink-700 dark:text-cream-100/75">{children}</p>
    </main>
  );
}
