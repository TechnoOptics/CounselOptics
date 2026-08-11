'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import {
  FIRM_POSTING_ROLES,
  callerHasFirmRole,
  callerIsFirmAdmin,
  requireActiveFirm,
} from './firm-authz';
import { isStorableRateCents, rateRangeError } from './billing-rates';
import { surfaceRefusal } from './firm-surface-guard';

export type TimeEntry = {
  id: string;
  firmId: string;
  userId: string;
  caseId: string | null;
  documentId: string | null;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  billable: boolean;
  rateCents: number | null;
  source: 'manual' | 'bella' | 'document' | 'chat' | 'calendar';
};

type TimeEntryRow = {
  id: string;
  firm_id: string;
  user_id: string;
  case_id: string | null;
  document_id: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  billable: boolean;
  rate_cents: number | null;
  source: string;
};

function fromRow(r: TimeEntryRow): TimeEntry {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    caseId: r.case_id,
    documentId: r.document_id,
    description: r.description,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    billable: r.billable,
    rateCents: r.rate_cents,
    source: r.source as TimeEntry['source'],
  };
}

/**
 * WHERE A BILLING RATE LIVES, AND WHY IT LIVES IN TWO PLACES
 *
 * The rate that decides what a client pays is `firm_time_entries.rate_cents`,
 * copied onto the entry when the entry is created (both insert paths below).
 * That copy is deliberate and must stay: an invoice is a statement of what the
 * work cost at the time it was done, so changing a rate today must not silently
 * restate an invoice sent last month.
 *
 * The source of that copy is `firm_members.default_rate_cents` - per member.
 * Per member is the right axis for the default, because the thing being priced
 * is an hour of a particular person's time, and because it is the only axis the
 * whole downstream flow already reads: the two inserts here, /counsel/time,
 * /counsel/billing, the matter page, the Impact page and Bella all price an
 * entry from the rate stamped on it, and none of them consults the matter.
 * A per-matter rate is a real thing firms want (a negotiated rate for one
 * client), but nothing in this flow can read one today, so adding that column
 * now would only be a second column nobody writes - which is exactly the defect
 * being fixed.
 *
 * Per member is NOT sufficient on its own, and this is the part worth saying
 * out loud. Because the rate is copied at insert time, setting a default only
 * governs hours logged from now on. Every hour already on the books was stamped
 * with the null this column has always held, so a default alone would leave the
 * existing ledger unbillable and the drafter's "set a rate" warning still
 * pointing at nothing. So this action also does the second half: on request it
 * re-stamps the member's UNINVOICED entries. That, and not the default, is what
 * makes the existing hours recoverable.
 */

/**
 * Set the hourly rate a member's time is billed at.
 *
 * Authorization is `callerIsFirmAdmin`, from lib/firm-authz.ts - the one place
 * that answers "may this caller act on this firm?". No second membership check
 * is written here, deliberately: this module already contains two hand-rolled
 * firm_members lookups (in the timer paths below) that exist to READ a rate,
 * and adding a third shape for a gate is how gates drift apart. Owner/admin
 * also matches the live `firm_members_owner_admin_update` RLS policy, so the
 * code gate and the database gate agree on the default write.
 *
 * The re-stamp does NOT agree with RLS, because it cannot: the
 * firm_time_entries write policy is self-scoped (user_id = auth.uid()), so an
 * RLS-scoped update could only ever reprice the admin's own hours, silently
 * leaving everyone else's at zero. It goes through the service-role client
 * instead, which means this function is the only authorization on that path.
 * That is why the admin check is above it and unconditional.
 *
 * `.is('invoice_id', null)` on the re-stamp is load-bearing. An entry that has
 * been claimed by an invoice was already summed into that invoice's
 * subtotal_cents; repricing it would leave the invoice's own total disagreeing
 * with its own lines, on a document that may already have been sent to a
 * client. Entries on an invoice are out of reach here by design - a wrongly
 * priced draft is recovered by deleting the draft, which releases its entries.
 */
export async function setFirmMemberRateAction(
  firmId: string,
  memberUserId: string,
  rateCents: number | null,
  opts: { applyToUnbilled?: boolean } = {},
): Promise<{ ok: boolean; error?: string; repricedEntries?: number }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await callerIsFirmAdmin(firmId))) {
    return {
      ok: false,
      error: 'Only an owner or admin can set billing rates.',
    };
  }
  await requireActiveFirm(firmId);

  // Validate, never coerce. `rateCents` arrives over the wire from a caller of
  // its own choosing, so the browser's parser is not a check.
  if (!isStorableRateCents(rateCents)) {
    return { ok: false, error: rateRangeError() };
  }

  const supabase = createServerSupabase();
  const { data: updated, error } = await supabase
    .from('firm_members')
    .update({ default_rate_cents: rateCents })
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId)
    .select('user_id');
  if (error) return { ok: false, error: error.message };
  if (!updated || (updated as unknown[]).length === 0) {
    return { ok: false, error: 'That person is not a member of this firm.' };
  }

  let repricedEntries = 0;
  if (opts.applyToUnbilled) {
    const admin = createAdminSupabase();
    if (!admin) {
      return {
        ok: false,
        error:
          'The rate is saved, but existing time cannot be repriced on this deployment. Ask an administrator to set the Supabase service role key.',
      };
    }
    const { data: rows, error: repriceError } = await admin
      .from('firm_time_entries')
      .update({ rate_cents: rateCents })
      .eq('firm_id', firmId)
      .eq('user_id', memberUserId)
      .is('invoice_id', null)
      .select('id');
    if (repriceError) return { ok: false, error: repriceError.message };
    repricedEntries = ((rows ?? []) as unknown[]).length;
  }

  revalidatePath('/counsel/team');
  revalidatePath('/counsel/time');
  revalidatePath('/counsel/billing');
  return { ok: true, repricedEntries };
}

/**
 * The current default rate for every member of a firm, keyed by user id.
 *
 * Owner/admin only, through the same gate as the write. Any member can already
 * SELECT the firm_members rows under RLS, so this is not a confidentiality
 * boundary the database enforces - it is a decision that what a colleague
 * charges is not something the whole legal team is shown by default, made once
 * here rather than in the page that renders it.
 */
export async function listFirmMemberRatesAction(
  firmId: string,
): Promise<{
  ok: boolean;
  error?: string;
  rates?: Record<string, number | null>;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can see billing rates.' };
  }
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_members')
    .select('user_id, default_rate_cents')
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  const rates: Record<string, number | null> = {};
  for (const row of (data ?? []) as Array<{
    user_id: string;
    default_rate_cents: number | null;
  }>) {
    rates[row.user_id] = row.default_rate_cents ?? null;
  }
  return { ok: true, rates };
}

/**
 * WHY A TIME ENTRY MUST NAME A MATTER
 *
 * buildDraftInvoiceAction bills one matter at a time: it takes a caseId and
 * filters `.eq('case_id', caseId)`. So an entry with no matter on it can never
 * appear on any invoice. It was still counted in the "Unbilled" figure on
 * /counsel/time, and skipped by "Ready to invoice" on /counsel/billing, which
 * groups by case and drops the ones with none. The hours were logged, priced,
 * shown as owed, and unbillable, with no control anywhere to correct one.
 *
 * /counsel/time mounted the timer with no matter at all, so every timer started
 * from that page produced exactly that entry.
 *
 * Both halves are fixed, and both are needed. Requiring a matter at the point
 * the timer starts stops new ones being made; it does nothing for the hours
 * already on the books, which is what assignTimeEntryToCaseAction below is for.
 * A refusal to start is a visible inconvenience; an entry that silently cannot
 * be billed is lost revenue nobody notices.
 */
const NO_MATTER_ERROR =
  'Pick the matter this time belongs to. Time with no matter on it cannot be put on an invoice.';

/**
 * Start a timer for the current user. The timer stays open
 * (ended_at = null) until stopTimer or any subsequent startTimer
 * implicitly closes it - we enforce one open timer per user per
 * firm to keep billing honest.
 */
export async function startTimerAction(
  firmId: string,
  opts: {
    caseId?: string | null;
    documentId?: string | null;
    description?: string | null;
    source?: TimeEntry['source'];
  } = {},
): Promise<{ ok: boolean; error?: string; entryId?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // Before anything is written. Bella reaches this too, and a refusal that
  // names the missing fact is a better answer than an hour it cannot bill.
  if (!opts.caseId) return { ok: false, error: NO_MATTER_ERROR };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('default_rate_cents')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  const defaultRate = (member as { default_rate_cents: number | null })
    .default_rate_cents;

  // Implicitly stop any other open timer this user has on this firm.
  await supabase
    .from('firm_time_entries')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: null,
    })
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null);
  // Recompute their durations now that we have ended_at set.
  await syncOpenDurations(firmId, user.id);

  const { data, error } = await supabase
    .from('firm_time_entries')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      case_id: opts.caseId ?? null,
      document_id: opts.documentId ?? null,
      description: opts.description ?? null,
      started_at: new Date().toISOString(),
      billable: true,
      rate_cents: defaultRate,
      source: opts.source ?? 'manual',
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Insert failed.' };
  }
  revalidatePath('/counsel');
  if (opts.caseId) revalidatePath(`/counsel/cases/${opts.caseId}`);
  return { ok: true, entryId: (data as { id: string }).id };
}

export async function stopTimerAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  const { data: open, error: openErr } = await supabase
    .from('firm_time_entries')
    .select('id, started_at, case_id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null)
    .limit(1);
  if (openErr) return { ok: false, error: openErr.message };
  if (!open || open.length === 0) {
    return { ok: false, error: 'No open timer to stop.' };
  }
  const row = open[0] as { id: string; started_at: string; case_id: string | null };
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(row.started_at)) / 1000),
  );

  const { error } = await supabase
    .from('firm_time_entries')
    .update({ ended_at: now, duration_seconds: seconds })
    .eq('id', row.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel');
  if (row.case_id) revalidatePath(`/counsel/cases/${row.case_id}`);
  return { ok: true };
}

/**
 * Insert a manual time entry (already-completed). Used when the
 * operator forgets to start a timer and is back-filling.
 */
export async function logManualEntryAction(
  firmId: string,
  input: {
    caseId?: string | null;
    description: string;
    durationSeconds: number;
    billable?: boolean;
    rateCents?: number | null;
  },
): Promise<{ ok: boolean; error?: string; entryId?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // Same requirement as the timer, for the same reason: this is the other way
  // an entry gets into the ledger, and one without a matter cannot be billed.
  if (!input.caseId) return { ok: false, error: NO_MATTER_ERROR };
  // A back-filled entry must be a positive whole number of seconds, capped at
  // 24h, which guards against a negative/absurd duration inflating an invoice.
  const dur = input.durationSeconds;
  if (!Number.isFinite(dur) || !Number.isInteger(dur) || dur <= 0 || dur > 86_400) {
    return { ok: false, error: 'Enter a duration between 1 second and 24 hours.' };
  }
  const supabase = createServerSupabase();
  // Rate is the member's configured default, NEVER a client-supplied value, so
  // a member can't set their own billing rate on a back-filled entry.
  const { data: member } = await supabase
    .from('firm_members')
    .select('default_rate_cents')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  const rateCents = (member as { default_rate_cents: number | null }).default_rate_cents;
  const now = new Date();
  const startedAt = new Date(now.getTime() - dur * 1000);
  const { data, error } = await supabase
    .from('firm_time_entries')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      case_id: input.caseId ?? null,
      description: input.description,
      started_at: startedAt.toISOString(),
      ended_at: now.toISOString(),
      duration_seconds: dur,
      billable: input.billable ?? true,
      rate_cents: rateCents,
      source: 'manual',
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Insert failed.' };
  }
  revalidatePath('/counsel');
  return { ok: true, entryId: (data as { id: string }).id };
}

/**
 * Put an existing entry that has no matter onto one, so it can be invoiced.
 *
 * This is the recovery half of the fix above: every hour logged before the
 * timer required a matter is sitting in the ledger priced and unbillable, and
 * there was no edit or delete control anywhere to correct one.
 *
 * SCOPE, deliberately narrow on three axes.
 *
 * Only entries with NO matter. Moving an entry BETWEEN matters is a different
 * change with a different risk (the matter it leaves has already been shown to
 * a client as its unbilled figure), and nothing here needs it.
 *
 * Only entries not yet on an invoice. An entry claimed by an invoice was
 * already summed into that invoice's subtotal; moving it would leave the
 * invoice disagreeing with its own lines, on a document that may already have
 * been sent. Same reason the rate re-stamp carries `.is('invoice_id', null)`.
 *
 * Only the person whose entry it is. The firm_time_entries write policy is
 * self-scoped (user_id = auth.uid()), so this runs on the caller's own
 * RLS-scoped client and needs no service-role client and no second
 * authorization axis. The cost is that an admin cannot fix a colleague's
 * entry; the colleague can, and inventing an admin path here would mean
 * writing past RLS for a convenience.
 */
export async function assignTimeEntryToCaseAction(
  firmId: string,
  entryId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!firmId || !entryId || !caseId) {
    return { ok: false, error: 'That entry could not be found.' };
  }
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return { ok: false, error: 'Your role cannot change time entries.' };
  }
  await requireActiveFirm(firmId);

  const supabase = createServerSupabase();
  // The matter has to be this organization's, checked against the row rather
  // than against anything the caller passed alongside it.
  const { data: matter } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!matter) {
    return { ok: false, error: 'That matter is not one of this organization’s.' };
  }

  const { data: updated, error } = await supabase
    .from('firm_time_entries')
    .update({ case_id: caseId })
    .eq('id', entryId)
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('case_id', null)
    .is('invoice_id', null)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // PostgREST reports no error when an UPDATE matches nothing, so the row
  // count is the only evidence that anything moved.
  if (((updated ?? []) as unknown[]).length === 0) {
    return {
      ok: false,
      error:
        'That entry was not moved. It may already be on an invoice, already be on a matter, or belong to someone else.',
    };
  }

  revalidatePath('/counsel/time');
  revalidatePath('/counsel/billing');
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

async function syncOpenDurations(firmId: string, userId: string) {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('id, started_at, ended_at, duration_seconds')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .is('duration_seconds', null)
    .not('ended_at', 'is', null);
  for (const r of (data ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string;
  }>) {
    const seconds = Math.max(
      0,
      Math.floor(
        (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000,
      ),
    );
    await supabase
      .from('firm_time_entries')
      .update({ duration_seconds: seconds })
      .eq('id', r.id);
  }
}

export async function listTimeEntriesForCase(
  firmId: string,
  caseId: string,
): Promise<TimeEntry[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('*')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .order('started_at', { ascending: false });
  return ((data ?? []) as TimeEntryRow[]).map(fromRow);
}

export async function listOpenTimer(firmId: string): Promise<TimeEntry | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('*')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  return fromRow(data[0] as TimeEntryRow);
}
