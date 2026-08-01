import 'server-only';

import { createAdminSupabase } from './supabase/admin';

/**
 * The Stripe half of firm invoicing: minting a payment link, switching one
 * off, and applying a payment that arrived through one back onto the
 * invoice.
 *
 * Deliberately NOT a `'use server'` module. Every export of one of those
 * becomes a callable HTTP endpoint, and `applyStripeInvoicePayment` marks
 * invoices paid without checking who is asking - it is reachable only from
 * the Stripe webhook, which has already verified the event signature.
 * lib/invoicing.ts (which IS `'use server'`) imports the link helpers from
 * here after doing its own authorization.
 *
 * The one fact that shapes all of this: a Stripe payment link is REUSABLE
 * and stays payable until it is explicitly deactivated. It is not a
 * one-shot checkout session. So a link left live on an invoice that was
 * voided, replaced by a retry, or already settled is not merely stale - it
 * is a working Pay button in the client's inbox for money the firm is not
 * owed. Every exit from "live and unpaid" has to switch it off.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

/**
 * Cents to a display amount. Falls back to USD rather than throwing if the
 * stored currency code is ever malformed: callers run this after an invoice
 * has been marked sent or paid, and a RangeError there would strand it.
 */
export function formatMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return dollars.toLocaleString('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    });
  } catch {
    return dollars.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }
}

/**
 * Mint a payment link for one invoice.
 *
 * The metadata is the part that matters beyond the URL: Stripe copies a
 * payment link's metadata onto every checkout session the link creates, so
 * this is what lets the webhook tell which invoice a payment belongs to.
 * Without it a payment arrives as an anonymous amount of money. The link id
 * is returned alongside the URL because the URL (buy.stripe.com/...) does
 * not contain it, and deactivation needs it.
 *
 * Best effort: returns null when Stripe is not configured or refuses, and
 * the caller falls back to "reply for payment instructions".
 */
export async function createInvoicePaymentLink(input: {
  invoiceId: string;
  firmId: string;
  number: string;
  totalCents: number;
  currency: string;
}): Promise<{ url: string; id: string } | null> {
  const key = stripeKey();
  if (!key) return null;
  try {
    const body = new URLSearchParams({
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(input.totalCents),
      'line_items[0][price_data][product_data][name]': `Invoice ${input.number}`,
      'line_items[0][quantity]': '1',
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': `${
        process.env.NEXT_PUBLIC_SITE_URL ?? 'https://advottic.com'
      }/inbox`,
      'metadata[advottic_invoice_id]': input.invoiceId,
      'metadata[advottic_firm_id]': input.firmId,
      'metadata[advottic_invoice_number]': input.number,
      // Mirrored onto the PaymentIntent as well, so the invoice is still
      // identifiable from a payment-level event or from the Stripe
      // dashboard when someone is reconciling a payout by hand.
      'payment_intent_data[metadata][advottic_invoice_id]': input.invoiceId,
      'payment_intent_data[metadata][advottic_invoice_number]': input.number,
    });
    const resp = await fetch(`${STRIPE_API}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { id?: string; url?: string };
    if (!json.id || !json.url) return null;
    return { id: json.id, url: json.url };
  } catch {
    return null;
  }
}

/**
 * Switch a payment link off. Returns false when the link is still live, so
 * the caller can tell the firm rather than imply the Pay button is gone.
 *
 * Treats "no link id" as success: there is nothing payable to switch off.
 * Invoices sent before the link id was recorded fall into this case - their
 * URL cannot be deactivated from here at all, which is why the migration
 * note asks for those to be handled in the Stripe dashboard.
 */
export async function deactivatePaymentLink(
  linkId: string | null | undefined,
): Promise<boolean> {
  if (!linkId) return true;
  const key = stripeKey();
  if (!key) return false;
  try {
    const resp = await fetch(
      `${STRIPE_API}/payment_links/${encodeURIComponent(linkId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ active: 'false' }).toString(),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

type InvoiceRow = {
  id: string;
  firm_id: string;
  number: string;
  status: string;
  total_cents: number;
  currency: string;
  paid_at: string | null;
  created_by: string | null;
  client_email: string | null;
  stripe_payment_link_id: string | null;
};

const INVOICE_COLS =
  'id, firm_id, number, status, total_cents, currency, paid_at, created_by, client_email, stripe_payment_link_id';

export type ApplyPaymentResult =
  /** The invoice moved to paid on this call. */
  | { outcome: 'paid'; invoiceId: string; paidAt: string }
  /** Already settled - a redelivered event, or a manual mark-paid won the race. */
  | { outcome: 'already_paid'; invoiceId: string }
  /** Money against a voided invoice. Left alone on purpose; a person is told. */
  | { outcome: 'not_live'; invoiceId: string; status: string }
  /** Nothing here matches this payment. Not ours, or the link predates the id column. */
  | { outcome: 'unmatched' }
  /** We could not reach the database. The caller must NOT acknowledge the event. */
  | { outcome: 'unavailable' };

/**
 * Reconcile a Stripe payment back onto its firm invoice.
 *
 * Called from the Stripe webhook only, after signature verification. Runs
 * through the service-role client because a webhook has no user session and
 * firm_invoices is member-scoped; no RLS policy is changed or relied upon.
 *
 * Idempotent, because Stripe delivers at least once and retries every
 * non-2xx: the status flip is guarded on the invoice still being draft or
 * sent, so a redelivery matches zero rows and reports already_paid instead
 * of restamping paid_at or notifying the firm a second time.
 */
export async function applyStripeInvoicePayment(input: {
  invoiceId: string | null;
  paymentLinkId: string | null;
  paymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
}): Promise<ApplyPaymentResult> {
  const admin = createAdminSupabase();
  // Not "handled". Reporting success here would 2xx the webhook and throw
  // away the only notice we get that this invoice was paid; the caller
  // turns this into a 500 so Stripe redelivers.
  if (!admin) return { outcome: 'unavailable' };

  let invoice: InvoiceRow | null = null;
  if (input.invoiceId) {
    const { data } = await admin
      .from('firm_invoices')
      .select(INVOICE_COLS)
      .eq('id', input.invoiceId)
      .maybeSingle();
    invoice = (data as InvoiceRow | null) ?? null;
  }
  // Fall back to the link id. Stripe copies payment-link metadata onto the
  // session, but the link itself is the more durable handle: it survives an
  // event shape that carries no metadata at all.
  if (!invoice && input.paymentLinkId) {
    const { data } = await admin
      .from('firm_invoices')
      .select(INVOICE_COLS)
      .eq('stripe_payment_link_id', input.paymentLinkId)
      .maybeSingle();
    invoice = (data as InvoiceRow | null) ?? null;
  }
  if (!invoice) return { outcome: 'unmatched' };

  // A payment against a written-off receivable. Do NOT flip it to paid:
  // that would put a void back into AR as collected, which is the same
  // corruption markInvoicePaidAction refuses. Kill the link so no more
  // arrives, and make sure a person hears about the money.
  if (invoice.status === 'void' || invoice.status === 'canceled') {
    await deactivatePaymentLink(invoice.stripe_payment_link_id);
    await notifyPaymentOnVoidedInvoice(invoice, input.amountCents);
    return { outcome: 'not_live', invoiceId: invoice.id, status: invoice.status };
  }

  if (invoice.status === 'paid') {
    await deactivatePaymentLink(invoice.stripe_payment_link_id);
    return { outcome: 'already_paid', invoiceId: invoice.id };
  }

  const paidAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('firm_invoices')
    .update({
      status: 'paid',
      paid_at: paidAt,
      stripe_payment_intent_id: input.paymentIntentId,
      // The link is spent. Clear the payable URL but keep the id as the
      // audit trail for which link the money came through.
      stripe_payment_link: null,
      updated_at: paidAt,
    })
    .eq('id', invoice.id)
    // The guard AND the idempotency: a redelivered event finds the row
    // already paid, matches nothing, and falls through to already_paid.
    .in('status', ['draft', 'sent'])
    .select('id');
  if (error) return { outcome: 'unavailable' };
  if (!updated || updated.length === 0) {
    return { outcome: 'already_paid', invoiceId: invoice.id };
  }

  await deactivatePaymentLink(invoice.stripe_payment_link_id);
  await notifyInvoicePaid(invoice);

  return { outcome: 'paid', invoiceId: invoice.id, paidAt };
}

/** Tell whoever raised the invoice that it cleared. */
export async function notifyInvoicePaid(invoice: {
  created_by: string | null;
  number: string;
  total_cents: number;
  currency: string;
}): Promise<void> {
  if (!invoice.created_by) return;
  const { createNotification } = await import('./notifications');
  await createNotification({
    userId: invoice.created_by,
    type: 'system',
    title: `Invoice ${invoice.number} paid`,
    body: `${formatMoney(invoice.total_cents, invoice.currency)} cleared.`,
    link: '/counsel/billing',
  });
}

/**
 * A voided invoice was paid anyway. Nobody is going to find this by
 * looking at the billing page, because the invoice reads as written off,
 * so say it plainly in-app and by mail to whoever watches the account.
 */
async function notifyPaymentOnVoidedInvoice(
  invoice: InvoiceRow,
  amountCents: number | null,
): Promise<void> {
  const amount = formatMoney(
    amountCents ?? invoice.total_cents,
    invoice.currency,
  );
  const line = `${amount} was received for invoice ${invoice.number}, which had been voided. The invoice was left as voided. The payment is in Stripe and needs to be refunded or applied to another invoice.`;

  if (invoice.created_by) {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: invoice.created_by,
      type: 'system',
      title: `Payment received on voided invoice ${invoice.number}`,
      body: line,
      link: '/counsel/billing',
    });
  }

  try {
    const { sendEmail } = await import('./email');
    await sendEmail({
      to: process.env.ADMIN_NOTIFY_TO?.trim() || 'contact@advottic.com',
      subject: `[Advottic] Payment on voided invoice ${invoice.number}`,
      html: `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;padding:18px;color:#0f2d24;">
<h2 style="margin:0 0 8px;font-size:17px;">Payment received on a voided invoice</h2>
<p style="margin:0;font-size:14px;color:#3f3f46;line-height:1.55;">${line}</p>
</body></html>`,
      text: line,
    });
  } catch {
    // Never let a notification failure decide whether the webhook is
    // acknowledged. The invoice state is already correct.
  }
}
