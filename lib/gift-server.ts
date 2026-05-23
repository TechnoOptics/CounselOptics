/**
 * Server-only gift helpers. Keeps the Stripe webhook handler thin -
 * it just calls applyGiftPaid() and we own all the side effects in
 * one place: bump status, send the recipient email, persist the
 * email_sent timestamp.
 *
 * Importing this file from a client component would crash because
 * it imports the admin Supabase client. The 'server-only' guard at
 * the top enforces that statically.
 */
import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { GIFT_TIERS, formatDollars } from '@/lib/gift';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Idempotent: a duplicate webhook call (Stripe will retry on 2xx
 * delays) won't double-send the email. We gate the email send on
 * email_sent_at being null.
 */
export async function applyGiftPaid(input: {
  giftId: string;
  paymentIntentId: string | null;
  stripeSessionId: string;
  amountCents: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Admin client unavailable.' };

  const { data: row, error: lookupErr } = await admin
    .from('gift_subscriptions')
    .select(
      'id, status, recipient_name, recipient_email, recipient_phone, gifter_name, gifter_email, personal_note, tier_slug, duration_months, amount_cents, redemption_token, email_sent_at',
    )
    .eq('id', input.giftId)
    .maybeSingle();
  if (lookupErr || !row) {
    return { ok: false, error: 'Gift row not found.' };
  }
  const gift = row as {
    id: string;
    status: string;
    recipient_name: string;
    recipient_email: string;
    recipient_phone: string | null;
    gifter_name: string | null;
    gifter_email: string | null;
    personal_note: string | null;
    tier_slug: string;
    duration_months: number;
    amount_cents: number;
    redemption_token: string;
    email_sent_at: string | null;
  };

  // Only flip status if it's still pending_payment. Re-deliveries
  // of the same webhook find paid_pending_claim already and we
  // skip the status write but may still re-send the email if it
  // hadn't been sent yet (e.g. an earlier email send failed).
  if (gift.status === 'pending_payment') {
    await admin
      .from('gift_subscriptions')
      .update({
        status: 'paid_pending_claim',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: input.paymentIntentId,
        stripe_session_id: input.stripeSessionId,
      })
      .eq('id', gift.id);
  }

  if (gift.email_sent_at) {
    return { ok: true };
  }

  // Build + send the recipient email.
  const tierName =
    GIFT_TIERS.find((t) => t.slug === gift.tier_slug)?.name ?? gift.tier_slug;
  const durationLabel = `${gift.duration_months} ${gift.duration_months === 1 ? 'month' : 'months'}`;
  const claimUrl = `${SITE_URL}/gift/claim/${gift.redemption_token}`;
  const gifterLabel = gift.gifter_name?.trim() || gift.gifter_email || 'A friend';
  const valueLabel = formatDollars(gift.amount_cents);

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0B1F19;">
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0B1F19;color:#FBF7E9;">
  <div style="text-align:center;padding-bottom:18px;border-bottom:1px solid rgba(230,206,147,0.25);">
    <a href="${SITE_URL}" style="text-decoration:none;display:inline-block;">
      <img src="${SITE_URL}/advottic-mark.png" alt="Advottic" width="96" height="96" style="display:inline-block;width:96px;height:96px;" />
    </a>
    <p style="margin:14px 0 0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#E5816B;font-weight:600;">A gift for you</p>
    <h1 style="margin:8px 0 0;font-size:24px;color:#E6CE93;font-weight:600;">${escapeHtml(gift.recipient_name)}, ${escapeHtml(gifterLabel)} sent you Advottic.</h1>
  </div>

  ${
    gift.personal_note
      ? `<blockquote style="margin:22px 0;padding:14px 18px;background:rgba(230,206,147,0.08);border-left:3px solid #E6CE93;border-radius:8px;font-style:italic;line-height:1.55;color:#FBF7E9;">${escapeHtml(gift.personal_note)}<footer style="margin-top:10px;font-style:normal;font-size:12px;color:rgba(251,247,233,0.6);">- ${escapeHtml(gifterLabel)}</footer></blockquote>`
      : ''
  }

  <div style="margin:22px 0;padding:18px;background:rgba(229,129,107,0.08);border-radius:12px;text-align:center;">
    <p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(251,247,233,0.65);">Subscription</p>
    <p style="margin:6px 0 0;font-size:21px;color:#E6CE93;font-weight:600;">${escapeHtml(tierName)}</p>
    <p style="margin:4px 0 0;font-size:14px;color:rgba(251,247,233,0.75);">${escapeHtml(durationLabel)} · ${escapeHtml(valueLabel)} value</p>
  </div>

  <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#FBF7E9;">Click below to activate the subscription on your account. It takes about 30 seconds - we use a one-time 6-digit email code, so there's no password to remember.</p>

  <p style="text-align:center;margin:24px 0;">
    <a href="${claimUrl}" style="display:inline-block;padding:14px 22px;background:#E6CE93;color:#0B1F19;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.4px;">Activate my gift &rarr;</a>
  </p>

  <p style="margin:0 0 8px;font-size:12px;color:rgba(251,247,233,0.6);line-height:1.55;">Or copy this link into your browser:</p>
  <p style="margin:0;font-family:'SFMono-Regular',Menlo,monospace;font-size:11px;color:#E6CE93;word-break:break-all;">${claimUrl}</p>

  <hr style="border:none;border-top:1px solid rgba(230,206,147,0.18);margin:28px 0 18px;" />

  <p style="margin:0;font-size:12px;color:rgba(251,247,233,0.6);line-height:1.55;">Advottic is a calm legal-prep tool. ${escapeHtml(gifterLabel)} thought you'd want it - personal-safety alerts, contract reviews, AI legal help, and (if you want it) a Wear OS watch companion. You can extend, upgrade, or downgrade any time from your billing page.</p>

  <p style="margin:14px 0 0;font-size:11px;color:rgba(251,247,233,0.45);">If this wasn't meant for you, you can ignore the email - nothing activates without your click. Questions? <a href="mailto:contact@advottic.com" style="color:#E6CE93;text-decoration:underline;">contact@advottic.com</a>.</p>
</div></body></html>`;

  const subject = `${gifterLabel} sent you Advottic - ${tierName}, ${durationLabel}`;
  try {
    await sendEmail({
      to: gift.recipient_email,
      subject,
      html,
      fromName: 'Advottic Gifts',
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Email send failed.',
    };
  }

  await admin
    .from('gift_subscriptions')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('id', gift.id);

  return { ok: true };
}
