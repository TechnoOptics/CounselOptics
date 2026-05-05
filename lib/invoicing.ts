'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Invoicing on top of time tracking. Three operations:
 *
 *   buildDraftInvoiceAction(firmId, caseId, clientEmail)
 *     - Pulls billable time_entries for the case that aren't yet
 *       attached to an invoice.
 *     - Computes subtotal_cents = sum(duration_seconds / 3600 * rate_cents).
 *     - Inserts an invoice in draft state and stamps each entry's
 *       invoice_id.
 *
 *   sendInvoiceAction(invoiceId)
 *     - Marks status=sent, sets sent_at.
 *     - Creates a Stripe payment link if STRIPE_SECRET_KEY is set;
 *       falls back to a marker URL otherwise.
 *     - Notifies the client (notification + email).
 *
 *   markInvoicePaidAction(invoiceId)
 *     - Manual mark-paid (eg. wire received outside Stripe).
 *     - Notifies the firm members who created the invoice.
 *
 * Currency: USD only for v1. Multi-currency lives in a follow-up.
 */

export type InvoiceLine = {
  entryId: string;
  description: string;
  startedAt: string;
  durationSeconds: number;
  rateCents: number | null;
  amountCents: number;
};

export async function buildDraftInvoiceAction(
  firmId: string,
  caseId: string,
  clientEmail: string,
  clientName?: string | null,
): Promise<{ ok: boolean; error?: string; invoiceId?: string; subtotalCents?: number; lineCount?: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();

  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  if (
    !['owner', 'admin', 'attorney'].includes(
      (member as { role: string }).role,
    )
  ) {
    return { ok: false, error: 'Your role cannot send invoices.' };
  }

  // Pull billable, completed, not-yet-invoiced entries.
  const { data: entriesRaw } = await supabase
    .from('firm_time_entries')
    .select(
      'id, description, started_at, duration_seconds, rate_cents, billable, ended_at, invoice_id',
    )
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .eq('billable', true)
    .is('invoice_id', null)
    .not('ended_at', 'is', null)
    .gt('duration_seconds', 0);
  const entries = ((entriesRaw ?? []) as Array<{
    id: string;
    description: string | null;
    started_at: string;
    duration_seconds: number;
    rate_cents: number | null;
    billable: boolean;
    ended_at: string;
    invoice_id: string | null;
  }>).filter((e) => e.duration_seconds > 0);

  if (entries.length === 0) {
    return { ok: false, error: 'No billable time entries to invoice on this case.' };
  }

  const subtotal = entries.reduce((sum, e) => {
    const rate = e.rate_cents ?? 0;
    const hours = e.duration_seconds / 3600;
    return sum + Math.round(rate * hours);
  }, 0);

  // Generate next invoice number for this firm.
  const { count } = await supabase
    .from('firm_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId);
  const number = `INV-${String((count ?? 0) + 1).padStart(5, '0')}`;

  // Try to resolve a client_user_id from the email.
  const admin = createAdminSupabase();
  let clientUserId: string | null = null;
  if (admin) {
    const { data: usersResp } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const matched = (usersResp?.users ?? []).find(
      (u) => u.email?.toLowerCase() === clientEmail.toLowerCase(),
    );
    if (matched) clientUserId = matched.id;
  }

  const { data: inv, error: invErr } = await supabase
    .from('firm_invoices')
    .insert({
      firm_id: firmId,
      case_id: caseId,
      client_user_id: clientUserId,
      client_email: clientEmail.trim().toLowerCase(),
      client_name: clientName ?? null,
      number,
      status: 'draft',
      subtotal_cents: subtotal,
      total_cents: subtotal,
      currency: 'USD',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (invErr || !inv) {
    return { ok: false, error: invErr?.message ?? 'Could not create invoice.' };
  }
  const invoiceId = (inv as { id: string }).id;

  // Stamp each entry with the invoice_id.
  const ids = entries.map((e) => e.id);
  await supabase
    .from('firm_time_entries')
    .update({ invoice_id: invoiceId })
    .in('id', ids);

  revalidatePath(`/counsel/cases/${caseId}`);
  revalidatePath('/counsel/billing');
  return {
    ok: true,
    invoiceId,
    subtotalCents: subtotal,
    lineCount: entries.length,
  };
}

export async function sendInvoiceAction(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string; paymentLink?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();

  const { data: inv } = await supabase
    .from('firm_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  const invoice = inv as {
    id: string;
    firm_id: string;
    case_id: string | null;
    client_email: string;
    client_user_id: string | null;
    number: string;
    total_cents: number;
    currency: string;
    status: string;
  };
  if (invoice.status !== 'draft') {
    return { ok: false, error: 'Only draft invoices can be sent.' };
  }

  // Best-effort Stripe payment link. Falls back to a placeholder URL
  // if STRIPE_SECRET_KEY is missing - the firm can still mark paid
  // manually when payment arrives outside Stripe.
  let paymentLink: string | null = null;
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    try {
      const formBody = new URLSearchParams({
        'line_items[0][price_data][currency]': invoice.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(invoice.total_cents),
        'line_items[0][price_data][product_data][name]': `Invoice ${invoice.number}`,
        'line_items[0][quantity]': '1',
        'after_completion[type]': 'redirect',
        'after_completion[redirect][url]': `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://advottic.com'}/inbox`,
      });
      const resp = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });
      if (resp.ok) {
        const json = (await resp.json()) as { url?: string };
        paymentLink = json.url ?? null;
      }
    } catch {
      /* non-fatal */
    }
  }

  await supabase
    .from('firm_invoices')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      stripe_payment_link: paymentLink,
    })
    .eq('id', invoice.id);

  // Notify the client when we know who they are.
  if (invoice.client_user_id) {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: invoice.client_user_id,
      type: 'system',
      title: `New invoice ${invoice.number}`,
      body: `$${(invoice.total_cents / 100).toFixed(2)} due. ${
        paymentLink ? 'Click to pay securely.' : 'Open the invoice for payment instructions.'
      }`,
      link: paymentLink ?? `/inbox/invoices/${invoice.id}`,
    });
  }

  revalidatePath('/counsel/billing');
  return { ok: true, paymentLink: paymentLink ?? undefined };
}

export async function markInvoicePaidAction(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: inv } = await supabase
    .from('firm_invoices')
    .select('id, firm_id, status, created_by, number, total_cents')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  const invoice = inv as {
    id: string;
    firm_id: string;
    status: string;
    created_by: string | null;
    number: string;
    total_cents: number;
  };
  if (invoice.status === 'paid') return { ok: true };

  await supabase
    .from('firm_invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoice.id);

  if (invoice.created_by) {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: invoice.created_by,
      type: 'system',
      title: `Invoice ${invoice.number} paid`,
      body: `$${(invoice.total_cents / 100).toFixed(2)} cleared.`,
      link: '/counsel/billing',
    });
  }
  revalidatePath('/counsel/billing');
  return { ok: true };
}
