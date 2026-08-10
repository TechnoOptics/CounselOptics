import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUnknownColumnError } from './signer-view';
import {
  DEFAULT_MATTER_PREFIX,
  DEFAULT_TICKET_PREFIX,
  TICKET_MAX,
  formatTicketNumber,
  nextTicketSeq,
  normalizeMatterPrefix,
  normalizeTicketPrefix,
} from './ticket-numbers';

/**
 * Putting a per-firm sequential number onto a record.
 *
 * TWO SERIES, ONE ALLOCATOR. A submission gets a ticket number and a matter
 * gets a matter number; they are different tables, different columns and
 * different prefixes, but they are the same allocation, so `allocateSeries`
 * below is the only implementation and the two exported entry points are
 * argument lists. A second hand-written allocator would be a second place for
 * the two properties this file exists to hold to drift out of, which is
 * exactly how lib/signature-geometry.ts came to be one module after three
 * copies of the same box arithmetic disagreed twice.
 *
 * The arithmetic is in lib/ticket-numbers.ts and is fully tested there. This
 * module is the write, and its whole job is that two people acting at the same
 * moment cannot be handed the same number.
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
const TICKET_COLUMN_MISSING =
  'Ticket numbers are not switched on yet. Ask your administrator to apply the pending database update.';

/** The same, for the matter series and its own pending migration. */
const MATTER_COLUMN_MISSING =
  'Matter reference numbers are not switched on yet. Ask your administrator to apply the pending database update.';

type AllocationResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

/**
 * A firm's prefix out of firm_settings, or the default.
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
async function readPrefix(
  client: SupabaseClient,
  firmId: string,
  column: 'ticket_prefix' | 'matter_prefix',
  normalize: (raw: unknown) => string,
  fallback: string,
): Promise<string> {
  try {
    const { data } = await client
      .from('firm_settings')
      .select(column)
      .eq('firm_id', firmId)
      .maybeSingle();
    return normalize((data as Record<string, unknown> | null)?.[column]);
  } catch {
    return fallback;
  }
}

/** The firm's ticket prefix, or the default. */
export async function readTicketPrefix(
  client: SupabaseClient,
  firmId: string,
): Promise<string> {
  return readPrefix(
    client,
    firmId,
    'ticket_prefix',
    normalizeTicketPrefix,
    DEFAULT_TICKET_PREFIX,
  );
}

/** The firm's matter prefix, or the default. */
export async function readMatterPrefix(
  client: SupabaseClient,
  firmId: string,
): Promise<string> {
  return readPrefix(
    client,
    firmId,
    'matter_prefix',
    normalizeMatterPrefix,
    DEFAULT_MATTER_PREFIX,
  );
}

/** What one series needs to know about itself. */
type Series = {
  table: string;
  column: string;
  prefix: string;
  /** What an unusable prefix falls back to. */
  fallbackPrefix: string;
  /** Said when this series' column has not been migrated in yet. */
  columnMissing: string;
  /** Said to whoever triggered the allocation, so it names their record. */
  writeFailed: string;
  /** Said when the row is not there at all. */
  rowMissing: string;
};

/**
 * Give this row the firm's next number in `series`.
 *
 * Idempotent: a row that already has a number keeps it and gets it back. The
 * write is conditional on the column still being null, so a retry, a second
 * tab, or a caller arriving late CANNOT renumber a record whose reference has
 * already been quoted in a notification, an email or a filing.
 */
async function allocateSeries(
  admin: SupabaseClient,
  series: Series,
  { firmId, rowId }: { firmId: string; rowId: string },
): Promise<AllocationResult> {
  const { table, column } = series;

  // The highest number this firm has, by a TEXT sort, which is only the
  // numeric maximum because every number is padded to a fixed seven digits.
  // See lib/ticket-numbers.ts.
  //
  // `.not(column, 'is', null)` is load-bearing, and it is the one place this
  // departs from the invoice allocator it copies. Every invoice has a number;
  // rows in THESE tables can have none, because an allocation that failed
  // leaves a null behind and because the ticket column is never backfilled.
  // Postgres orders a descending sort NULLS FIRST, so without this filter the
  // highest number reads as null, the series restarts at one, and the retry
  // budget is spent colliding with numbers that are already out.
  const { data: highestRows, error: readError } = await admin
    .from(table)
    .select(column)
    .eq('firm_id', firmId)
    .not(column, 'is', null)
    .order(column, { ascending: false })
    .limit(1);
  if (readError) {
    if (isUnknownColumnError(readError, column)) {
      return { ok: false, error: series.columnMissing };
    }
    return {
      ok: false,
      error: 'The next reference number could not be read just now.',
    };
  }

  const highest =
    (highestRows?.[0] as unknown as Record<string, string | null> | undefined)?.[column] ??
    null;
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
    const ticketNumber = formatTicketNumber(series.prefix, seq, series.fallbackPrefix);
    const { data, error } = await admin
      .from(table)
      .update({ [column]: ticketNumber })
      // Scoped to the firm as well as the row. The number about to be written
      // was derived from THIS firm's series, so a row belonging to another one
      // must not receive it even if a caller names its id.
      .eq('id', rowId)
      .eq('firm_id', firmId)
      .is(column, null)
      .select(column)
      .maybeSingle();

    if (!error && data) {
      return {
        ok: true,
        ticketNumber: String((data as unknown as Record<string, string>)[column]),
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
      if (isUnknownColumnError(error, column)) {
        return { ok: false, error: series.columnMissing };
      }
      return { ok: false, error: series.writeFailed };
    }

    // No error and no row: `column is null` did not hold. Either this record
    // already has a number, which is the idempotent case and the common one,
    // or the row is gone.
    const existing = await readOwnNumber(admin, series, firmId, rowId);
    if (existing) return { ok: true, ticketNumber: existing };
    return { ok: false, error: series.rowMissing };
  }

  return { ok: false, error: series.writeFailed };
}

/** The number already on this record, if it has one. */
async function readOwnNumber(
  admin: SupabaseClient,
  series: Series,
  firmId: string,
  rowId: string,
): Promise<string | null> {
  const { data } = await admin
    .from(series.table)
    .select(series.column)
    .eq('id', rowId)
    .eq('firm_id', firmId)
    .maybeSingle();
  const stored =
    (data as Record<string, string | null> | null)?.[series.column] ?? '';
  return stored.trim() || null;
}

/** Give this submission the firm's next ticket number. */
export async function allocateSubmissionTicket(
  admin: SupabaseClient,
  { firmId, submissionId }: { firmId: string; submissionId: string },
): Promise<AllocationResult> {
  return allocateSeries(
    admin,
    {
      table: 'firm_template_submissions',
      column: 'ticket_number',
      prefix: await readTicketPrefix(admin, firmId),
      fallbackPrefix: DEFAULT_TICKET_PREFIX,
      columnMissing: TICKET_COLUMN_MISSING,
      writeFailed: 'This document could not be given a ticket number just now.',
      rowMissing: 'That submission could not be found.',
    },
    { firmId, rowId: submissionId },
  );
}

/**
 * Give this matter the firm's next matter number.
 *
 * The reference a firm quotes on the phone, in email and in a filing, which
 * is why the conditional write above matters more here than anywhere: a
 * matter reference that changed after it went out on paper is a reference
 * nobody can look up. Once a matter has a number, nothing in this module can
 * take it away or move it.
 */
export async function allocateMatterNumber(
  admin: SupabaseClient,
  { firmId, caseId }: { firmId: string; caseId: string },
): Promise<AllocationResult> {
  return allocateSeries(
    admin,
    {
      table: 'cases',
      column: 'matter_number',
      prefix: await readMatterPrefix(admin, firmId),
      fallbackPrefix: DEFAULT_MATTER_PREFIX,
      columnMissing: MATTER_COLUMN_MISSING,
      writeFailed: 'This matter could not be given a reference number just now.',
      rowMissing: 'That matter could not be found.',
    },
    { firmId, rowId: caseId },
  );
}
