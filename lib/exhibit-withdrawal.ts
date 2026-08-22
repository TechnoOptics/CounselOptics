/**
 * Editing an exhibit's details, and withdrawing one without destroying it.
 *
 * Two things a person preparing for court could not do until this module
 * existed, and the reasons the two are shaped differently.
 *
 * ---------------------------------------------------------------------------
 * 1. EDITING DETAILS, NEVER THE EVIDENCE
 * ---------------------------------------------------------------------------
 * An exhibit is two separate things joined in one row. The FILE is the
 * evidence. The LABEL is how a court refers to it. Everything else is the
 * person's own note about the file: what it shows, when the event happened,
 * where it came from, what kind of thing it is.
 *
 * Only that last group may be edited. The bytes are not editable because the
 * whole point of the record is that they are the document that was filed. The
 * label is not editable because "Exhibit K" is a reference other documents
 * make, and a label typed over by hand makes every one of those references
 * point somewhere else.
 *
 * That rule is enforced structurally rather than by comment.
 * `buildExhibitDetailsPatch` is the ONLY thing that constructs the update
 * payload, it returns exactly four keys, and lib/storage.ts passes its result
 * straight to `.update(...)` instead of writing an object literal at the call
 * site. A column that is not in the returned object cannot be written by that
 * statement, and a test asserts the key set.
 *
 * `incident_date` is the field that matters most. It is a DATE column, not a
 * timestamp, and it is what a court chronology is ordered by. It is parsed
 * here by `parseExactCalendarDate` from lib/exhibit-chronology, which returns
 * a plain YYYY-MM-DD string built from UTC arithmetic and never constructs a
 * local-zone Date. A date typed as the 5th is stored as the 5th and read back
 * as the 5th in every timezone. A calendar day does not move between zones,
 * and a bug that printed a stated date one day early has already been fixed on
 * this codebase once; see tests/date-only-does-not-shift.test.ts.
 *
 * ---------------------------------------------------------------------------
 * 2. WITHDRAWING, WHICH IS NOT DELETING
 * ---------------------------------------------------------------------------
 * A person with a duplicate on file needs the duplicate out of their packet.
 * The obvious implementation is a delete, and a delete is the wrong answer.
 *
 * Labels are allocated by position: `addExhibit` counts the rows already on
 * the case and hands out the next letter. Delete Exhibit K and the row is
 * gone, but every packet already printed, every review already written and
 * every note the person has made still say "Exhibit K", and the next upload
 * takes the letter that the removed document used to hold. The reference
 * silently comes to mean a different document. That is the failure this
 * feature exists to avoid, so nothing is destroyed: the row stays, the label
 * stays, the file stays in storage, and a single timestamp records that the
 * person chose to leave it out.
 *
 * A withdrawn exhibit is left out of the court packet, the chronology, the
 * exhibit index, the AI surfaces and the unread count. The owner still sees it
 * on the case page, marked, and can restore it.
 *
 * PURE ON PURPOSE. vitest runs here in a node environment with no DOM, so
 * every decision that can be tested lives in a module with no storage, no
 * Next and no clock reads beyond what is passed in.
 */
import { parseExactCalendarDate } from './exhibit-chronology';
import { isUnknownColumnError } from './signer-view';
import { EXHIBIT_CATEGORIES } from './types';

// ---------------------------------------------------------------------------
// Withdrawal state
// ---------------------------------------------------------------------------

/**
 * The only field this module needs off an exhibit. Structural rather than the
 * `Exhibit` type, so the rule can be tested without dragging storage in, and
 * so a caller reading a raw row can use it too.
 *
 * `undefined` reads as NOT withdrawn, which is exactly what a database
 * without `exhibits.withdrawn_at` yet returns. See the read/write asymmetry
 * documented under `resolveWithdrawnColumnFallback` below.
 */
export type WithdrawableExhibit = { withdrawnAt?: string | null };

/** True when the person has withdrawn this exhibit from their case. */
export function isExhibitWithdrawn(ex: WithdrawableExhibit | null | undefined): boolean {
  if (!ex) return false;
  const at = ex.withdrawnAt;
  return typeof at === 'string' && at.trim().length > 0;
}

/**
 * The exhibits that belong in a packet, a chronology, an exhibit index, a
 * review prompt, or an unread count.
 *
 * Order is preserved, so a caller that had already sorted its list keeps that
 * sort.
 */
export function activeExhibits<T extends WithdrawableExhibit>(
  items: readonly T[],
): T[] {
  return items.filter((e) => !isExhibitWithdrawn(e));
}

/** The ones the person has withdrawn. Shown to the owner, marked, and nowhere else. */
export function withdrawnExhibits<T extends WithdrawableExhibit>(
  items: readonly T[],
): T[] {
  return items.filter((e) => isExhibitWithdrawn(e));
}

// ---------------------------------------------------------------------------
// What may be written, and what may not
// ---------------------------------------------------------------------------

/**
 * The four columns an edit is allowed to write. Exported so a test can assert
 * the set rather than trusting the sentence above it.
 */
export const EXHIBIT_EDITABLE_COLUMNS = [
  'description',
  'incident_date',
  'source',
  'category',
] as const;

/**
 * The columns an edit must never write, and the reason each one is on the list.
 *
 * storage_path, file_name, file_size, file_type: the bytes and their identity.
 *   This is the evidence. Replacing it behind an unchanged label is the single
 *   worst thing this feature could be made to do.
 * label: how a court, a packet and a review refer to this document.
 * scan_data: what the model read off the face of the file. It is a record of a
 *   reading, not a note, and an edit form has no business rewriting it.
 * case_id, user_id, id, uploaded_at: identity and provenance.
 */
export const EXHIBIT_IMMUTABLE_COLUMNS = [
  'id',
  'case_id',
  'user_id',
  'label',
  'file_name',
  'storage_path',
  'file_type',
  'file_size',
  'scan_data',
  'uploaded_at',
] as const;

/** Length limits, so a person is told plainly rather than hitting a database error. */
export const MAX_EXHIBIT_DESCRIPTION = 2000;
export const MAX_EXHIBIT_SOURCE = 500;

/** The details an edit carries, already normalized. */
export type ExhibitDetails = {
  description: string;
  /** YYYY-MM-DD, or null when the person has not stated a date. */
  incidentDate: string | null;
  source: string | null;
  category: string | null;
};

export type NormalizedDetails =
  | { ok: true; value: ExhibitDetails }
  | { ok: false; error: string };

/**
 * Clean up and check what came off the form.
 *
 * Every refusal is a sentence written to be read by somebody preparing for a
 * hearing, so it says what was wrong and that nothing was changed.
 *
 * `currentCategory` is accepted so an exhibit already carrying a category that
 * is no longer on the list can still have its description fixed. Without it a
 * legacy value would block an unrelated edit, and the person would have no way
 * to tell why.
 */
export function normalizeExhibitDetails(input: {
  description?: unknown;
  incidentDate?: unknown;
  source?: unknown;
  category?: unknown;
  currentCategory?: string | null;
}): NormalizedDetails {
  const description = asText(input.description);
  if (description.length > MAX_EXHIBIT_DESCRIPTION) {
    return {
      ok: false,
      error:
        `The description is longer than the ${MAX_EXHIBIT_DESCRIPTION} character limit. ` +
        'Please shorten it. Nothing was changed.',
    };
  }

  const source = asText(input.source);
  if (source.length > MAX_EXHIBIT_SOURCE) {
    return {
      ok: false,
      error:
        `The source is longer than the ${MAX_EXHIBIT_SOURCE} character limit. ` +
        'Please shorten it. Nothing was changed.',
    };
  }

  const rawDate = asText(input.incidentDate);
  let incidentDate: string | null = null;
  if (rawDate) {
    const parsed = parseExactCalendarDate(rawDate);
    if (!parsed) {
      return {
        ok: false,
        error:
          'That date could not be read as one specific day. Please enter it as ' +
          'a full calendar date, for example 3/5/2026. Nothing was changed.',
      };
    }
    // The parser's own ISO string, not the typed text. It is built from UTC
    // arithmetic with no local-zone Date anywhere in the path, so the day
    // cannot shift on its way to a DATE column or back out of one.
    incidentDate = parsed.iso;
  }

  const category = asText(input.category);
  const current = asText(input.currentCategory);
  const known = (EXHIBIT_CATEGORIES as readonly string[]).includes(category);
  if (category && !known && category !== current) {
    return {
      ok: false,
      error: 'Please choose a category from the list. Nothing was changed.',
    };
  }

  return {
    ok: true,
    value: {
      description,
      incidentDate,
      source: source || null,
      category: category || null,
    },
  };
}

/**
 * The exact update payload an edit is allowed to send.
 *
 * The ONLY constructor of that payload. lib/storage.ts calls this and hands
 * the result to `.update(...)` rather than writing an object literal, so the
 * set of columns a details edit can reach is decided in one place, next to the
 * list of columns it must never reach, and a test can assert it directly.
 */
export function buildExhibitDetailsPatch(details: ExhibitDetails): {
  description: string;
  incident_date: string | null;
  source: string | null;
  category: string | null;
} {
  return {
    description: details.description,
    incident_date: details.incidentDate,
    source: details.source,
    category: details.category,
  };
}

// ---------------------------------------------------------------------------
// Behaviour before the migration is applied
// ---------------------------------------------------------------------------

export type WithdrawnColumnFallback =
  /** Do not report success. The exhibit is still in the packet. */
  | 'abort-not-withdrawn'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/** The wording for the abort, kept beside the decision that causes it. */
export const WITHDRAWN_COLUMN_MISSING_ERROR =
  'This exhibit was not withdrawn. Withdrawing needs a database update that ' +
  'has not been applied yet, so nothing was changed and the exhibit is still ' +
  'in your packet. Ask your administrator to apply the pending update.';

/**
 * What to do when a withdrawal lands on a database without the column.
 *
 * The precedent for this shape is `resolveDeliveryModeColumnFallback` in
 * lib/submission-dispatch.ts, and the asymmetry there is the point: retrying
 * without the column is right in one direction only.
 *
 * READING has a safe direction and takes it. An absent `withdrawn_at` reads as
 * `undefined`, `isExhibitWithdrawn` reads that as not withdrawn, and that is
 * exactly correct, because on a database without the column nothing CAN have
 * been withdrawn. So `listExhibits` filters in JavaScript over `select('*')`
 * rather than adding `.is('withdrawn_at', null)` to the query: a filter in SQL
 * would make every case page, packet and export fail outright until the
 * migration ran, and it would buy nothing, since there is no withdrawn row to
 * find.
 *
 * WRITING has no safe direction, so it refuses. There is no version of this
 * write that can be retried with the column left out: dropping it would leave
 * the exhibit exactly as it was while the person is told it is withdrawn. They
 * would then build a packet believing a duplicate had been left out of it, and
 * find out otherwise from the document in front of a judge. A withdrawal that
 * visibly fails costs a person one confusing minute. A withdrawal that
 * silently fails costs them the thing they were trying to prevent. So the only
 * honest answer is to say plainly that nothing was changed and why.
 */
export function resolveWithdrawnColumnFallback(input: {
  error: { code?: string | null; message?: string | null } | null | undefined;
}): WithdrawnColumnFallback {
  return isUnknownColumnError(input.error, 'withdrawn_at')
    ? 'abort-not-withdrawn'
    : 'surface-error';
}

// ---------------------------------------------------------------------------
// What the person is told
// ---------------------------------------------------------------------------

/**
 * The confirm shown before a withdrawal, as plain sentences.
 *
 * It states what happens and what does not, because the word "withdraw" on its
 * own could reasonably be read as "delete", and somebody preparing for court
 * should not have to guess whether their file is about to be destroyed. No
 * warnings about consequences and no urgency: a fact and a next step.
 */
export function withdrawConfirmLines(label: string): string[] {
  const name = label.trim() || 'This exhibit';
  return [
    `${name} stays on this case and keeps its label. The file is not deleted, and anything that already refers to ${name} still means the same document.`,
    `What changes: ${name} is left out of your court packet, out of the chronology, out of the exhibit list, and it stops counting as an exhibit nobody has read.`,
    'You can put it back at any time.',
  ];
}

/** The short marker shown next to a withdrawn exhibit on the case page. */
export const WITHDRAWN_BADGE = 'Withdrawn';

/** One line under that marker, so the state is never just a badge. */
export function withdrawnNoteLine(withdrawnAtDisplay: string | null): string {
  return withdrawnAtDisplay
    ? `Withdrawn on ${withdrawnAtDisplay}. Kept on file, left out of the packet.`
    : 'Withdrawn. Kept on file, left out of the packet.';
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
