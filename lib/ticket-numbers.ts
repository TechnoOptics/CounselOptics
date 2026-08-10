import { ticketRef } from './intake-conversation-types';

/**
 * The per-firm ticket number, as pure rules.
 *
 * Every document an employee sends to the legal team gets a reference the two
 * of them can quote at each other: a prefix the firm chooses and a seven-digit
 * counter that starts, in the client's own words, at 0000000. This module is
 * the arithmetic. The write that turns it into a number on a record is
 * lib/ticket-allocator.ts, which is `server-only` and cannot run under
 * vitest's `environment: 'node'`; everything here can, and does.
 *
 * THE SEVEN IS LOAD-BEARING, NOT COSMETIC. The allocator finds the next
 * number by reading back the highest one this firm already has, ordered by
 * `ticket_number` descending, which Postgres does as a TEXT sort. A text sort
 * agrees with a numeric one only while every number is the same width. So the
 * pad is fixed at seven and the series REFUSES at 9999999 rather than growing
 * an eighth digit or wrapping: an eighth digit would sort 'REQ-10000000'
 * below 'REQ-9999999', the allocator would read a used number as the highest,
 * and it would hand out numbers that are already on filed documents. See
 * tests/ticket-numbers.test.ts, which pins the ordering and the refusal
 * together because they are one property.
 *
 * THE SERIES IS GAPPY, ON PURPOSE. A number is derived from committed rows
 * and written onto one record, so a submission that is later voided or rolled
 * back retires its number permanently and nothing reuses it. Somebody will
 * eventually ask why there is no REQ-0000412; the answer is that the record
 * that held it is gone, and that is a better answer for a legal audit trail
 * than a dense series in which a number can mean two different documents.
 * lib/invoicing.ts made the same choice for INV- and says so at its own
 * allocator.
 */

/** Seven digits. From the owner, confirmed per firm. */
export const TICKET_PAD = 7;

/** The last number the fixed pad can express. See the note above. */
export const TICKET_MAX = 9_999_999;

/**
 * What a firm gets before it chooses. It matches the REQ- reference the
 * product already shows for records that have no number of their own, so a
 * firm that never opens the setting sees one family of reference rather than
 * two.
 */
export const DEFAULT_TICKET_PREFIX = 'REQ';

/**
 * What a firm's MATTERS are numbered under before it chooses.
 *
 * A different default from the one above, and the difference is the point.
 * The two series are separate counters over separate tables, so a firm on one
 * shared prefix would eventually issue REQ-0000005 for an employee's document
 * AND REQ-0000005 for a matter. A reference exists to be said out loud and
 * looked up; one that resolves to two records of different kinds is worse than
 * no reference at all.
 */
export const DEFAULT_MATTER_PREFIX = 'MAT';

const PREFIX_MIN = 2;
const PREFIX_MAX = 8;

/**
 * A firm's prefix, made safe to put in front of a number.
 *
 * Letters and digits only, uppercased. Punctuation is stripped rather than
 * rejected so a firm that types "N.D.A." gets NDA instead of an error, and
 * anything left outside two to eight characters falls back to `fallback`:
 * below two there is nothing to recognise a document by, and above eight the
 * reference stops being quotable on a phone call, which is the only reason it
 * exists.
 */
function normalizePrefix(raw: unknown, fallback: string): string {
  const cleaned = (typeof raw === 'string' ? raw : '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < PREFIX_MIN || cleaned.length > PREFIX_MAX) {
    return fallback;
  }
  return cleaned;
}

/** The prefix in front of a ticket number. */
export function normalizeTicketPrefix(raw: unknown): string {
  return normalizePrefix(raw, DEFAULT_TICKET_PREFIX);
}

/** The prefix in front of a matter number. */
export function normalizeMatterPrefix(raw: unknown): string {
  return normalizePrefix(raw, DEFAULT_MATTER_PREFIX);
}

/**
 * `REQ-0000412`. The prefix is normalised here so no caller can widen it.
 *
 * `fallback` is what an unusable prefix lands on, and it is a parameter
 * because the matter series has a different default from the ticket series.
 * A caller that has already normalised passes a prefix this leaves alone, so
 * the fallback only ever decides what garbage becomes.
 */
export function formatTicketNumber(
  prefix: string,
  seq: number,
  fallback: string = DEFAULT_TICKET_PREFIX,
): string {
  return `${normalizePrefix(prefix, fallback)}-${String(seq).padStart(TICKET_PAD, '0')}`;
}

/**
 * The number inside a ticket reference, ignoring whatever is in front of it.
 *
 * Prefix-agnostic deliberately. A firm may change its prefix, and when it does
 * the series has to carry on from where it was rather than restart onto
 * numbers that are already on documents somebody has filed. Reading the
 * trailing digits is the same `/(\d+)\s*$/` lib/invoicing.ts has used for
 * invoice numbers since 2026-07-03.
 *
 * Anything unparseable reads as 0, so the first ticket a firm ever files is
 * 0000001.
 */
export function parseTicketSeq(number: string | null | undefined): number {
  const match = /(\d+)\s*$/.exec(String(number ?? ''));
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type NextTicketSeq =
  | { ok: true; seq: number }
  | { ok: false; reason: string };

/**
 * One past the highest number this firm already has, or a refusal.
 *
 * Refusing at the end of the series is the whole reason this returns a result
 * rather than a number. Wrapping would re-issue numbers that are on filed
 * documents; an eighth digit would break the text ordering the allocator
 * depends on and do the same thing more quietly. A firm that reaches ten
 * million documents gets told, and the fix is a wider pad applied on purpose
 * with the existing numbers migrated to it, not something this function may
 * decide on its own.
 */
export function nextTicketSeq(highest: string | null): NextTicketSeq {
  const seq = parseTicketSeq(highest) + 1;
  if (seq > TICKET_MAX) {
    return {
      ok: false,
      reason: `This firm has used every ticket number up to ${TICKET_MAX}. No further numbers can be issued at this width.`,
    };
  }
  return { ok: true, seq };
}

/**
 * The one place a submission's reference is turned into something to show.
 *
 * A record that has a number shows it. A record filed before the allocator
 * existed shows the derived REQ- reference the product has always used for a
 * record with no number of its own (lib/intake-conversation-types.ts). Numbers
 * are never backfilled, so which of the two a given record shows is fixed for
 * its whole life and nobody is ever handed two references for one document.
 */
export function displayTicket(row: { ticketNumber?: string | null; id: string }): string {
  const stored = (row.ticketNumber ?? '').trim();
  return stored || ticketRef(row.id);
}

/**
 * The one place a MATTER's reference is turned into something to show.
 *
 * A matter that has a number shows it. A matter that has none shows the
 * leading segment of its uuid, which is exactly what the counsel list and the
 * matter breadcrumb showed before this existed, so nothing regresses for a
 * matter the allocator has not reached: it keeps the reference it already had.
 *
 * The fallback is written out rather than imported from
 * components/counsel/patterns.tsx `shortRef`, which is the same three words.
 * That module is React, and this one is the pure layer both the server and the
 * node-environment tests run. The duplication is one expression and is pinned
 * by tests/matter-numbers.test.ts.
 */
export function displayMatterNumber(row: {
  matterNumber?: string | null;
  id: string;
}): string {
  const stored = (row.matterNumber ?? '').trim();
  return stored || (row.id.split('-')[0] ?? row.id);
}
