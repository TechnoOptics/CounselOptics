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
 *   voidInvoiceAction(firmId, invoiceId)
 *     - Cancels a mis-sent/wrong-client invoice from a live state
 *       (draft/sent, never paid) via an atomic status guard, and
 *       RELEASES its time entries (invoice_id -> null) so they become
 *       billable again.
 *
 *   deleteDraftInvoiceAction(firmId, invoiceId)
 *     - Removes a draft outright (draft only) and releases its time
 *       entries. A draft was never sent, so there's nothing to keep for
 *       the AR trail - unlike a sent invoice, which is voided (kept).
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
): Promise<{
  ok: boolean;
  error?: string;
  invoiceId?: string;
  subtotalCents?: number;
  lineCount?: number;
  warning?: string;
  unratedCount?: number;
}> {
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

  // Entries with no rate get billed at $0 but are still stamped as
  // invoiced (so they can never be re-billed). That silent write-off is
  // almost always a data-entry miss - surface it so the drafter can fix
  // the rate before sending rather than discovering it on the client's
  // bill. We still draft (the invoice is editable while draft), but the
  // caller gets a warning + count to show.
  const unratedCount = entries.filter(
    (e) => e.rate_cents == null || e.rate_cents === 0,
  ).length;
  const warning =
    unratedCount > 0
      ? `${unratedCount} time ${
          unratedCount === 1 ? 'entry has' : 'entries have'
        } no billing rate and will be invoiced at $0. Set a rate before sending if that's not intended.`
      : undefined;

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
    warning,
    unratedCount,
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

/**
 * Release every time entry stamped with this invoice back to billable
 * (invoice_id -> null). MUST run through the service-role client: the
 * firm_time_entries write policy's USING clause requires
 * invoice_id IS NULL, so an invoiced entry is immutable to a member -
 * an RLS-scoped update would match zero rows and silently release
 * nothing. Also stamps across every attorney's entries, not just the
 * caller's. Returns false when the entries could not be released so the
 * caller can warn instead of claiming success.
 */
async function releaseInvoiceEntries(
  admin: ReturnType<typeof createAdminSupabase>,
  invoiceId: string,
): Promise<boolean> {
  if (!admin) return false;
  const { error } = await admin
    .from('firm_time_entries')
    .update({ invoice_id: null })
    .eq('invoice_id', invoiceId);
  return !error;
}

/**
 * Void a mis-sent/wrong-client invoice and free its time for re-billing.
 *
 * Transitions status draft|sent -> void via an ATOMIC guard
 * (.eq('status', prior)): if a concurrent action paid or already voided
 * the invoice between our read and write, the update matches zero rows
 * and we bail without touching the time entries. Paid invoices are never
 * voidable here - reversing collected AR is a credit-note concern, not a
 * void. Only after the status flips do we release the entries, so we
 * never release time off an invoice that's actually still live/paid.
 */
export async function voidInvoiceAction(
  firmId: string,
  invoiceId: string,
): Promise<{ ok: boolean; error?: string; releasedEntries?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();

  const { data: inv } = await supabase
    .from('firm_invoices')
    .select('id, firm_id, status')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  const invoice = inv as { id: string; firm_id: string; status: string };
  if (invoice.firm_id !== firmId) {
    return { ok: false, error: 'Invoice does not belong to this firm.' };
  }

  const auth = await assertInvoicePoster(supabase, invoice.firm_id, user.id);
  if (!auth.ok) return auth;

  if (invoice.status === 'void') return { ok: true, releasedEntries: true };
  if (invoice.status === 'paid') {
    return {
      ok: false,
      error: 'A paid invoice cannot be voided. Issue a refund/credit instead.',
    };
  }
  if (invoice.status !== 'draft' && invoice.status !== 'sent') {
    return { ok: false, error: `Cannot void an invoice that is ${invoice.status}.` };
  }
  const prior = invoice.status;

  // Atomic transition: only flips if the status is still `prior`.
  const { data: updated, error: updateErr } = await supabase
    .from('firm_invoices')
    .update({ status: 'void', updated_at: new Date().toISOString() })
    .eq('id', invoice.id)
    .eq('status', prior)
    .select('id');
  if (updateErr) {
    return { ok: false, error: updateErr.message ?? 'Could not void invoice.' };
  }
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: 'Invoice changed while voiding. Reload and try again.',
    };
  }

  const released = await releaseInvoiceEntries(createAdminSupabase(), invoice.id);

  revalidatePath('/counsel/billing');
  return {
    ok: true,
    releasedEntries: released,
    error: released
      ? undefined
      : 'Invoice voided, but its time entries could not be released automatically.',
  };
}

/**
 * Delete a DRAFT invoice outright and release its time entries. A draft
 * was never sent to the client, so there's no AR trail worth keeping -
 * unlike a sent invoice, which voidInvoiceAction preserves. Guarded
 * atomically on status='draft' so a draft that was sent/paid out from
 * under us is never deleted. The firm_time_entries.invoice_id FK is
 * `on delete set null` (see 2026-07-03-billing-schema.sql), so the
 * guarded delete releases the entries as part of the same operation -
 * which is why we delete FIRST: releasing before the guard could strip
 * entries off an invoice that was concurrently sent.
 */
export async function deleteDraftInvoiceAction(
  firmId: string,
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();

  const { data: inv } = await supabase
    .from('firm_invoices')
    .select('id, firm_id, status')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  const invoice = inv as { id: string; firm_id: string; status: string };
  if (invoice.firm_id !== firmId) {
    return { ok: false, error: 'Invoice does not belong to this firm.' };
  }

  const auth = await assertInvoicePoster(supabase, invoice.firm_id, user.id);
  if (!auth.ok) return auth;

  if (invoice.status !== 'draft') {
    return {
      ok: false,
      error: 'Only draft invoices can be deleted. Void a sent invoice instead.',
    };
  }

  // Atomic guarded delete: only removes the row while it is still a
  // draft. The invoice_id FK's `on delete set null` releases every
  // stamped time entry as part of this delete, so no separate release
  // pass is needed - and none can race ahead of the guard.
  const { data: deleted, error: delErr } = await supabase
    .from('firm_invoices')
    .delete()
    .eq('id', invoice.id)
    .eq('status', 'draft')
    .select('id');
  if (delErr) {
    return { ok: false, error: delErr.message ?? 'Could not delete draft.' };
  }
  if (!deleted || deleted.length === 0) {
    return {
      ok: false,
      error: 'Draft changed while deleting. Reload and try again.',
    };
  }

  revalidatePath('/counsel/billing');
  return { ok: true };
}
