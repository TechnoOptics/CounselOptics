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

/**
 * Confirm the caller is a posting-role member (owner/admin/attorney)
 * of the given firm. Defense in depth alongside firm_invoices RLS, so
 * invoice mutations don't rely on a single (untracked) policy.
 */
async function assertInvoicePoster(
  supabase: ReturnType<typeof createServerSupabase>,
  firmId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  if (
    !['owner', 'admin', 'attorney'].includes((member as { role: string }).role)
  ) {
    return { ok: false, error: 'Your role cannot manage invoices.' };
  }
  return { ok: true };
}

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

  // Next invoice number for this firm. Derive from the HIGHEST existing
  // number (not count(*), which would reuse a number after an invoice is
  // voided/deleted). The insert below retries on the unique-constraint
  // collision two concurrent drafts would otherwise hit, so numbering is
  // both gap-tolerant and race-safe. (Audit 2026-07-03.)
  const { data: lastRows } = await supabase
    .from('firm_invoices')
    .select('number')
    .eq('firm_id', firmId)
    .order('number', { ascending: false })
    .limit(1);
  const lastNumber =
    (lastRows?.[0] as { number?: string } | undefined)?.number ?? '';
  const lastSeqMatch = /(\d+)\s*$/.exec(lastNumber);
  let nextSeq = (lastSeqMatch ? parseInt(lastSeqMatch[1], 10) : 0) + 1;

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

  let inv: { id: string } | null = null;
  let invErr: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const number = `INV-${String(nextSeq).padStart(5, '0')}`;
    const res = await supabase
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
    if (!res.error) {
      inv = res.data as { id: string };
      invErr = null;
      break;
    }
    invErr = res.error as { code?: string; message?: string };
    // 23505 = unique_violation: a concurrent draft took this number.
    // Bump and retry; anything else is a real error.
    if ((res.error as { code?: string }).code === '23505') {
      nextSeq += 1;
      continue;
    }
    break;
  }
  if (invErr || !inv) {
    return { ok: false, error: invErr?.message ?? 'Could not create invoice.' };
  }
  const invoiceId = inv.id;

  // Stamp each entry with the invoice_id. The subtotal above was
  // computed from every billable entry on the case (across all
  // attorneys), so stamp that same set - via the admin client, because
  // the self-scoped RLS write policy (user_id = auth.uid()) would only
  // mark the caller's own entries, leaving colleagues' billed time
  // un-stamped and re-invoiceable. The caller was already verified as
  // an owner/admin/attorney of this firm, and the ids come from a
  // firm-scoped, billable, not-yet-invoiced query, so this is safe.
  // Falls back to the RLS client if the service role isn't configured.
  const ids = entries.map((e) => e.id);
  await (admin ?? supabase)
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
  // Defense in depth: the firm_invoices RLS write policy already
  // requires an owner/admin/attorney member of this firm, but don't
  // rely on RLS alone - check membership + role in-code too, matching
  // buildDraftInvoiceAction.
  const sendAuth = await assertInvoicePoster(supabase, invoice.firm_id, user.id);
  if (!sendAuth.ok) return sendAuth;
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
  const paidAuth = await assertInvoicePoster(supabase, invoice.firm_id, user.id);
  if (!paidAuth.ok) return paidAuth;
  if (invoice.status === 'paid') return { ok: true };
  // State-machine guard: a voided/canceled invoice must not be
  // resurrected as paid - that corrupts AR (a receivable that was
  // written off would reappear as collected). Payment is only valid
  // from a live invoice (draft or sent). (Audit 2026-07-03.)
  if (invoice.status === 'void' || invoice.status === 'canceled') {
    return {
      ok: false,
      error: `This invoice was ${invoice.status} and cannot be marked paid.`,
    };
  }

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
