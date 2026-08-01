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
 *     - Moves status draft -> sent via an atomic guard, sets sent_at.
 *     - Creates a Stripe payment link if STRIPE_SECRET_KEY is set.
 *     - Emails the client, and adds an in-app notification when the
 *       client has an account. If neither reaches them the invoice goes
 *       back to draft.
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

/**
 * How many time-entry ids to claim per request. `.in()` filters ride in
 * the URL, so an unbounded list on a heavily-billed matter would exceed
 * the gateway request-line limit.
 */
const CLAIM_BATCH_SIZE = 100;

/**
 * Cents to a display amount. Falls back to USD rather than throwing if the
 * stored currency code is ever malformed: this runs after an invoice has
 * been marked sent, and a RangeError there would strand it.
 */
function formatMoney(cents: number, currency: string): string {
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

  // The service-role client is REQUIRED here, not a nice-to-have. The
  // subtotal below is computed from every attorney's billable time on the
  // matter, but the firm_time_entries write policy is self-scoped
  // (user_id = auth.uid()), so an RLS-scoped stamp would mark only the
  // drafter's own entries. A colleague's hours would then sit inside this
  // invoice's total while still reading as unbilled, and get pulled onto
  // next month's invoice too - the client billed twice for one piece of
  // work. Refuse to draft rather than draft something half-claimed.
  const admin = createAdminSupabase();
  if (!admin) {
    return {
      ok: false,
      error:
        'Invoicing is not configured on this deployment. Ask an administrator to set the Supabase service role key before drafting invoices.',
    };
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
    .gt('duration_seconds', 0)
    // Deterministic order so that if PostgREST's max-rows cap ever
    // truncates this set, it truncates it to the SAME rows the matter
    // page summed for its "Draft for $X" figure. Without it the button
    // and the invoice could silently disagree again.
    .order('id', { ascending: true });
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
  let clientUserId: string | null = null;
  {
    const { data: usersResp } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const matched = (usersResp?.users ?? []).find(
      (u) => u.email?.toLowerCase() === clientEmail.toLowerCase(),
    );
    if (matched) clientUserId = matched.id;
  }

  let inv: { id: string; number: string } | null = null;
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
      .select('id, number')
      .single();
    if (!res.error) {
      inv = res.data as { id: string; number: string };
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

  // CLAIM the time entries, atomically. The subtotal above was computed
  // from every billable entry on the case (across all attorneys), so the
  // invoice is only honest if that exact same set is now attached to it.
  //
  // `.is('invoice_id', null)` is the claim guard and it is what makes this
  // safe under concurrency: Postgres re-evaluates an UPDATE's WHERE clause
  // against the committed row under read-committed, so if a second drafter
  // claimed an entry between our SELECT and this UPDATE, that row simply
  // is not matched here - it cannot be silently re-pointed at our invoice
  // and billed a second time. This is the same guarded-write pattern used
  // by voidInvoiceAction and deleteDraftInvoiceAction below.
  //
  // `.select('id')` returns exactly the rows we won, so a short count means
  // we lost a race and the draft does not represent the time it claims to.
  //
  // Claimed in batches because `.in('id', ids)` travels in the request
  // URL: a long-running matter with a few hundred unbilled entries would
  // otherwise blow the gateway's request-line limit and leave that matter
  // permanently un-invoiceable. Batching does not weaken the guarantee -
  // a short total still rolls the entire invoice back below, and the FK
  // releases every batch that did land.
  const ids = entries.map((e) => e.id);
  let claimedCount = 0;
  let claimErr: { message?: string } | null = null;
  for (let i = 0; i < ids.length; i += CLAIM_BATCH_SIZE) {
    const batch = ids.slice(i, i + CLAIM_BATCH_SIZE);
    const { data: claimedRaw, error } = await admin
      .from('firm_time_entries')
      .update({ invoice_id: invoiceId })
      .in('id', batch)
      .is('invoice_id', null)
      .select('id');
    if (error) {
      claimErr = error as { message?: string };
      break;
    }
    claimedCount += ((claimedRaw ?? []) as Array<{ id: string }>).length;
  }

  if (claimErr || claimedCount !== ids.length) {
    // Roll the whole draft back. The firm_time_entries.invoice_id FK is
    // ON DELETE SET NULL, so deleting the invoice releases everything we
    // did manage to claim; the entries a concurrent drafter took stay with
    // them. Either the invoice covers all of its time or it does not exist.
    // Guarded on status='draft' + .select('id') for the same reason every
    // other write here is: this draft is already listed on the billing
    // page with a live Send control, so it must not be deleted out from
    // under a colleague who just sent it to the client.
    const { data: rolledBack, error: rollbackErr } = await admin
      .from('firm_invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('status', 'draft')
      .select('id');
    const rollbackFailed =
      Boolean(rollbackErr) || !rolledBack || rolledBack.length === 0;

    revalidatePath(`/counsel/cases/${caseId}`);
    revalidatePath('/counsel/billing');

    const base = claimErr
      ? 'The time entries could not be attached to this invoice, so nothing was billed.'
      : 'Some of this time was invoiced by someone else while this draft was being prepared, so nothing was billed. Reload the matter and draft again.';
    return {
      ok: false,
      error: rollbackFailed
        ? `${base} Draft ${inv.number} could not be removed automatically and should be reviewed on the billing page.`
        : base,
    };
  }

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

/**
 * Issue a draft invoice to the client.
 *
 * "Sent" here means the client was actually told, not just that a column
 * flipped: the status moves draft -> sent through an ATOMIC guard, and only
 * then do we mint a payment link and deliver. If nothing at all reached the
 * client (no email, and no in-app notification because they have no
 * account), the invoice is put back to draft and the caller is told - a
 * receivable that shows as "sent" while the client never heard of it is the
 * reason the Outstanding figure can't be trusted.
 *
 * The status claim comes FIRST, before the Stripe call, so a double click
 * cannot mint two payment links or mail the client the same bill twice.
 * Note this does NOT cover the retry-after-rollback path: if the mail
 * provider accepts the message but answers too slowly (sendEmail aborts at
 * 8s), the invoice returns to draft and a firm that sends again can reach
 * the client twice. Worth revisiting with a provider idempotency key.
 */
export async function sendInvoiceAction(
  invoiceId: string,
): Promise<{
  ok: boolean;
  error?: string;
  paymentLink?: string;
  emailed?: boolean;
  emailError?: string;
}> {
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
    return {
      ok: false,
      error:
        invoice.status === 'sent'
          ? 'This invoice has already been sent.'
          : `An invoice that is ${invoice.status} cannot be sent.`,
    };
  }

  // Atomic transition: only flips while the invoice is still a draft, so a
  // second click (or a colleague on another screen) loses the race here,
  // before anything is charged for or mailed.
  const { data: claimedRows, error: claimErr } = await supabase
    .from('firm_invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoice.id)
    .eq('status', 'draft')
    .select('id');
  if (claimErr) {
    return { ok: false, error: claimErr.message ?? 'Could not send invoice.' };
  }
  if (!claimedRows || claimedRows.length === 0) {
    return {
      ok: false,
      error: 'This invoice changed while sending. Reload and try again.',
    };
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

  if (paymentLink) {
    const { error: linkErr } = await supabase
      .from('firm_invoices')
      .update({ stripe_payment_link: paymentLink })
      .eq('id', invoice.id);
    // If we could not record the link, do not put it in the client's
    // email either. A pay link the invoice record has never heard of is
    // a payment nobody can reconcile.
    if (linkErr) paymentLink = null;
  }

  // Everything from here to the delivery check runs inside a try, because
  // the invoice is ALREADY marked sent. Any throw in between (a bad
  // currency code, a failed dynamic import, an instance recycling) would
  // otherwise strand it as "sent" while the client was never told, which
  // is the exact state this action exists to prevent.
  let emailed = false;
  let emailError: string | undefined;
  let notified = false;
  try {
    // Who the invoice is from, so the mail reads as the firm's rather
    // than as a generic Advottic notice.
    const { data: firmRow } = await supabase
      .from('firms')
      .select('name')
      .eq('id', invoice.firm_id)
      .maybeSingle();
    const firmName = (firmRow as { name?: string } | null)?.name ?? null;
    let matterTitle: string | null = null;
    if (invoice.case_id) {
      const { data: caseRow } = await supabase
        .from('cases')
        .select('title')
        .eq('id', invoice.case_id)
        .maybeSingle();
      matterTitle = (caseRow as { title?: string } | null)?.title ?? null;
    }

    const amount = formatMoney(invoice.total_cents, invoice.currency);

    const { sendEmail, buildInvoiceEmailHtml } = await import('./email');
    const emailRes = await sendEmail({
      to: invoice.client_email,
      subject: `Invoice ${invoice.number} from ${firmName ?? 'your legal team'}`,
      html: buildInvoiceEmailHtml({
        firmName,
        invoiceNumber: invoice.number,
        totalCents: invoice.total_cents,
        currency: invoice.currency,
        matterTitle,
        payLink: paymentLink,
      }),
      text: `Invoice ${invoice.number} for ${amount}.${
        paymentLink ? ` Pay: ${paymentLink}` : ' Reply for payment instructions.'
      }`,
      fromName: firmName ?? undefined,
    });
    emailed = emailRes.ok;
    if (!emailRes.ok) emailError = emailRes.error;

    // Notify the client in the app too when they have an account here.
    if (invoice.client_user_id) {
      const { createNotification } = await import('./notifications');
      const note = await createNotification({
        userId: invoice.client_user_id,
        type: 'system',
        title: `New invoice ${invoice.number}`,
        body: `${amount} due. ${
          paymentLink
            ? 'Open to pay securely.'
            : 'Contact the firm for payment instructions.'
        }`,
        // There is no client-facing invoice detail page yet, so link to
        // the payment link when there is one and to the inbox otherwise.
        // Never link somewhere that 404s.
        link: paymentLink ?? '/inbox',
      });
      notified = note !== null;
    }
  } catch (err) {
    emailed = false;
    notified = false;
    emailError = err instanceof Error ? err.message : 'unexpected error';
  }

  if (!emailed && !notified) {
    // Nothing reached the client, so this invoice is not sent. Put it back
    // rather than let it sit in Outstanding as money the client has never
    // been asked for.
    const { data: rolledBack, error: rollbackErr } = await supabase
      .from('firm_invoices')
      .update({ status: 'draft', sent_at: null, stripe_payment_link: null })
      .eq('id', invoice.id)
      .eq('status', 'sent')
      .select('id');
    revalidatePath('/counsel/billing');

    // Distinguish "this deployment cannot send email at all" from "this
    // address did not accept it", so nobody spends the afternoon
    // correcting a client address that was never the problem.
    const reason = emailError?.includes('RESEND_API_KEY')
      ? 'Email sending is not configured on this deployment, so the invoice could not be delivered. Ask an administrator to set it up.'
      : `The invoice could not be delivered to ${invoice.client_email}. Check the client email address and try again.`;
    const rolledBackOk =
      !rollbackErr && Boolean(rolledBack) && rolledBack!.length > 0;
    const state = rolledBackOk
      ? 'It is still a draft.'
      : `Invoice ${invoice.number} could not be returned to draft automatically and should be reviewed on the billing page.`;
    return {
      ok: false,
      emailed: false,
      emailError,
      error: `${reason} ${state}`,
    };
  }

  revalidatePath('/counsel/billing');
  return {
    ok: true,
    paymentLink: paymentLink ?? undefined,
    emailed,
    emailError,
  };
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
