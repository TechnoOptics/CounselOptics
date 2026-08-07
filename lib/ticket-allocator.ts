import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUnknownColumnError } from './signer-view';
import {
  DEFAULT_TICKET_PREFIX,
  TICKET_MAX,
  formatTicketNumber,
  nextTicketSeq,
  normalizeTicketPrefix,
} from './ticket-numbers';

/**
 * Putting a ticket number onto a submission.
 *
 * The arithmetic is in lib/ticket-numbers.ts and is fully tested there. This
 * module is the write, and its whole job is that two employees raising a
 * request at the same moment cannot be handed the same number.
 *
 * IT IS MODELLED ON lib/invoicing.ts:198-261, DELIBERATELY AND STRUCTURALLY.
 * Read the highest number this firm already has, add one, write it, and on a
 * unique-violation bump and try again. That loop is safe for exactly one
 * reason: `unique (firm_id, ticket_number)` exists to lose against
 * (20260807_flow_join.sql). The database decides who got there first, not the
 * order in which two callers happened to read.
 *
 * IT IS NOT MODELLED ON lib/esign-audit.ts, AND THAT IS THE POINT. Its
 * appendSignatureEvent is a read-then-insert of a hash chain with no unique
 * constraint, no lock, no transaction and no retry, so two concurrent appends
 * chain off the same predecessor and the verifier reads the fork as tampering.
 * An allocator without a unique index underneath it is that same shape wearing
 * a different name. If the index is ever dropped, this loop stops being an
 * allocator and starts being a suggestion.
 *
 * THE SERIES IS GAPPY AND THAT IS ON PURPOSE. The next number comes from the
 * highest committed one rather than from a count, so a submission that is
 * later voided, deleted or rolled back retires its number permanently and
 * nothing reuses it. Somebody will eventually ask why there is no
 * REQ-0000412: the answer is that the record which held it is gone. For a
 * legal audit trail that is a better answer than a dense series in which one
 * number can have meant two different documents. Density would cost a
 * pg_advisory_xact_lock inside a security-definer RPC, serialising every
 * ticket-creating write per firm; if the owner ever requires it, that is the
 * upgrade, and nothing here would fight it.
 *
 * ALLOCATION FAILURE IS NOT FATAL TO A SUBMISSION. Every refusal below comes
 * back as a value. The caller files the employee's document either way and a
 * record with no number shows the derived reference instead (displayTicket).
 * A colleague's document must not fail to reach the legal team because a
 * counter would not move.
 */

/** Six, the same budget the invoice allocator settled on. */
const MAX_ATTEMPTS = 6;

/**
 * Said to an approver, so it names the thing a person can actually do about
 * it. Until 20260807_flow_join.sql is applied there is no column to write to.
 */
const COLUMN_MISSING =
  'Ticket numbers are not switched on yet. Ask your administrator to apply the pending database update.';

type AllocationResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

/**
 * The firm's ticket prefix, or the default.
 *
 * Its own query rather than a column added to the existing firm_settings
 * read, because that read is on the path that renders the whole Counsel shell
 * and selects a fixed column list. Adding an unapplied column to that list
 * would make the request fail, and its catch would then hand back the
 * DEFAULTS for the surface toggles as well: a firm that had hidden Time and
 * Billing would see it reappear. One extra query is cheaper than that.
 *
 * A firm with no settings row, a firm whose column is not there yet, and a
 * firm that typed something unusable all land on the same default, which is
 * the same direction getFirmSurfaceSettings takes for its two booleans.
 */
export async function readTicketPrefix(
  client: SupabaseClient,
  firmId: string,
): Promise<string> {
  try {
    const { data } = await client
      .from('firm_settings')
      .select('ticket_prefix')
      .eq('firm_id', firmId)
      .maybeSingle();
    return normalizeTicketPrefix((data as { ticket_prefix?: unknown } | null)?.ticket_prefix);
  } catch {
    return DEFAULT_TICKET_PREFIX;
  }
}

/**
 * Give this submission the firm's next ticket number.
 *
 * Idempotent: a submission that already has a number keeps it and gets it
 * back. The write is conditional on `ticket_number is null`, so a retry, a
 * second tab, or a caller arriving late cannot renumber a record whose
 * reference has already been quoted in a notification or an email.
 */
export async function allocateSubmissionTicket(
  admin: SupabaseClient,
  { firmId, submissionId }: { firmId: string; submissionId: string },
): Promise<AllocationResult> {
  const prefix = await readTicketPrefix(admin, firmId);

  // The highest number this firm has, by a TEXT sort, which is only the
  // numeric maximum because every number is padded to a fixed seven digits.
  // See lib/ticket-numbers.ts.
  //
  // `.not('ticket_number', 'is', null)` is load-bearing, and it is the one
  // place this departs from the invoice allocator it copies. Every invoice
  // has a number; most rows in THIS table have none, because the column is
  // never backfilled and because an allocation that failed leaves a null
  // behind. Postgres orders a descending sort NULLS FIRST, so without this
  // filter the highest number reads as null, the series restarts at one, and
  // the retry budget is spent colliding with numbers that are already out.
  const { data: highestRows, error: readError } = await admin
    .from('firm_template_submissions')
    .select('ticket_number')
    .eq('firm_id', firmId)
    .not('ticket_number', 'is', null)
    .order('ticket_number', { ascending: false })
    .limit(1);
  if (readError) {
    if (isUnknownColumnError(readError, 'ticket_number')) {
      return { ok: false, error: COLUMN_MISSING };
    }
    return {
      ok: false,
      error: 'The next ticket number could not be read just now.',
    };
  }

  const highest =
    (highestRows?.[0] as { ticket_number?: string | null } | undefined)?.ticket_number ?? null;
  const start = nextTicketSeq(highest);
  if (!start.ok) return { ok: false, error: start.reason };

  let seq = start.seq;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Re-checked inside the loop, not only at the start: the bump on a
    // collision can walk the sequence past the end of the series, and an
    // eighth digit sorts below every seven-digit number and would make the
    // read above start handing out numbers that are already on documents.
    if (seq > TICKET_MAX) {
      return {
        ok: false,
        error: `This firm has used every ticket number up to ${TICKET_MAX}. No further numbers can be issued at this width.`,
      };
    }
    const ticketNumber = formatTicketNumber(prefix, seq);
    const { data, error } = await admin
      .from('firm_template_submissions')
      .update({ ticket_number: ticketNumber })
      .eq('id', submissionId)
      .is('ticket_number', null)
      .select('ticket_number')
      .maybeSingle();

    if (!error && data) {
      return {
        ok: true,
        ticketNumber: String((data as { ticket_number: string }).ticket_number),
      };
    }

    // 23505 is unique_violation: somebody else took this number between the
    // read and the write. Bump and try the next one. Nothing has been written,
    // so a lost attempt costs nothing and burns no number.
    if ((error as { code?: string } | null)?.code === '23505') {
      seq += 1;
      continue;
    }

    if (error) {
      if (isUnknownColumnError(error, 'ticket_number')) {
        return { ok: false, error: COLUMN_MISSING };
      }
      return {
        ok: false,
        error: 'This document could not be given a ticket number just now.',
      };
    }

    // No error and no row: `ticket_number is null` did not hold. Either this
    // submission already has a number, which is the idempotent case and the
    // common one, or the row is gone.
    const existing = await readOwnTicket(admin, submissionId);
    if (existing) return { ok: true, ticketNumber: existing };
    return { ok: false, error: 'That submission could not be found.' };
  }

  return {
    ok: false,
    error: 'This document could not be given a ticket number just now.',
  };
}

/** The number already on this record, if it has one. */
async function readOwnTicket(
  admin: SupabaseClient,
  submissionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('firm_template_submissions')
    .select('ticket_number')
    .eq('id', submissionId)
    .maybeSingle();
  const stored = (data as { ticket_number?: string | null } | null)?.ticket_number ?? '';
  return stored.trim() || null;
}
