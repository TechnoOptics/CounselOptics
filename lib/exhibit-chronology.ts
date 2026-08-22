/**
 * Where an item sits on a court timeline, and how confident we are that we
 * know its date at all.
 *
 * A court timeline is ordered by WHEN THE THING HAPPENED. An exhibit carries
 * up to three candidate dates and they are not interchangeable:
 *
 *   incidentDate  the person typed it. It is a claim about the event.
 *   scan dates    the model read them off the face of the document.
 *   uploadedAt    the moment the file reached this service. It says nothing
 *                 about when the event happened, and on this codebase's real
 *                 data it is routinely months later.
 *
 * The old ordering was `incidentDate || uploadedAt`, which silently promotes
 * an upload timestamp into the "date" column of a document that goes in front
 * of a judge. This module keeps the fallback chain but refuses to lose the
 * provenance: every resolved date carries the source that produced it, so the
 * caller can print it, and an item we cannot date is reported as undated
 * rather than being parked at one end of the list as if its date were known.
 *
 * PURE ON PURPOSE. No storage, no Next, no clock reads beyond what is passed
 * in. vitest here runs in a node environment with no DOM, so the ordering rule
 * lives where it can actually be tested.
 */

/** Which of the three candidates supplied the date we are using. */
export type DateSource = 'stated' | 'document' | 'received';

/** Wording shown next to a date so an upload date is never read as an event date. */
export const DATE_SOURCE_LABEL: Record<DateSource, string> = {
  stated: 'Date stated by you',
  document: 'Date found in the document',
  received: 'Date received (not the date of the event)',
};

/** Short form for a table column, where the long sentence will not fit. */
export const DATE_SOURCE_SHORT: Record<DateSource, string> = {
  stated: 'stated',
  document: 'from document',
  received: 'date received',
};

export type ResolvedDate =
  | {
      known: true;
      /** Midnight-anchored ISO calendar date, YYYY-MM-DD. */
      iso: string;
      /** Sort key. Milliseconds since epoch for `iso` at UTC midnight. */
      sortKey: number;
      source: DateSource;
      sourceLabel: string;
      sourceShort: string;
      /** Exactly the text this came from, so the reader can check it. */
      rawValue: string;
      /** For a document date, the label the scan gave it (for example "Date issued"). */
      rawLabel: string | null;
    }
  | {
      known: false;
      source: 'unknown';
      sourceLabel: string;
      sourceShort: string;
    };

export const UNDATED: ResolvedDate = {
  known: false,
  source: 'unknown',
  sourceLabel: 'No date on file',
  sourceShort: 'undated',
};

/**
 * Parse a date string only when it names one specific day.
 *
 * `Date.parse` is not usable here. It turns "January 2026" into
 * 2026-01-01 and "2026" into 2026-01-01, inventing a day that the source
 * never stated. On a legal exhibit that invented day is a fabricated fact, so
 * this accepts only the four unambiguous full-date shapes and rejects
 * everything else, including ranges, "on or about", month-year and year-only.
 *
 * Returns a UTC calendar date so the same input orders identically regardless
 * of the server's timezone.
 */
export function parseExactCalendarDate(raw: string | null | undefined): {
  iso: string;
  sortKey: number;
} | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;

  // YYYY-MM-DD, optionally carrying a time we ignore. An ISO timestamp is
  // what both incidentDate and uploadedAt look like in this database.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  }

  // MM/DD/YYYY. US order, matching this product's us-format invariants.
  if (y === null) {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (us) {
      m = Number(us[1]);
      d = Number(us[2]);
      y = Number(us[3]);
    }
  }

  // Month D, YYYY
  if (y === null) {
    const long = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
    if (long) {
      const mm = monthFromName(long[1]);
      if (mm) {
        m = mm;
        d = Number(long[2]);
        y = Number(long[3]);
      }
    }
  }

  // D Month YYYY
  if (y === null) {
    const dmy = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
    if (dmy) {
      const mm = monthFromName(dmy[2]);
      if (mm) {
        d = Number(dmy[1]);
        m = mm;
        y = Number(dmy[3]);
      }
    }
  }

  if (y === null || m === null || d === null) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30, which Date.UTC would roll forward into March.
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return { iso: `${y}-${pad(m)}-${pad(d)}`, sortKey: ms };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthFromName(name: string): number | null {
  const n = name.toLowerCase();
  for (let i = 0; i < MONTHS.length; i += 1) {
    if (MONTHS[i] === n) return i + 1;
    if (MONTHS[i].slice(0, 3) === n) return i + 1;
  }
  return null;
}

/** The shape this module needs from an exhibit. Deliberately not `Exhibit`, so
 *  the rule can be tested without dragging the storage types in. */
export type DatableExhibit = {
  incidentDate?: string | null;
  uploadedAt?: string | null;
  /** Dates the scan lifted off the face of the document. */
  scanDates?: readonly { label: string; value: string }[] | null;
  /**
   * Whether the scan that produced `scanDates` actually read the file. A demo
   * or unsupported scan must never contribute a date. Callers pass
   * `isRealScan(exhibit.scanData)` from lib/types.
   */
  scanIsReal?: boolean;
};

/**
 * Resolve one exhibit's place on the timeline.
 *
 * Order of preference, and the reason for it:
 *   1. incidentDate. The person is asserting when it happened.
 *   2. a date on the face of the document, but only from a scan that really
 *      read the file, and only when it names one specific day.
 *   3. uploadedAt, marked as a received date so nobody reads it as the event.
 *
 * When a document offers several dates we take the EARLIEST parseable one.
 * That is a choice, not a fact, so `rawLabel` and `rawValue` travel with it
 * and the UI prints them: a reader who disagrees can see exactly which line of
 * the document produced the date and correct it with an incident date.
 */
export function resolveExhibitDate(ex: DatableExhibit): ResolvedDate {
  const stated = parseExactCalendarDate(ex.incidentDate);
  if (stated) {
    return {
      known: true,
      iso: stated.iso,
      sortKey: stated.sortKey,
      source: 'stated',
      sourceLabel: DATE_SOURCE_LABEL.stated,
      sourceShort: DATE_SOURCE_SHORT.stated,
      rawValue: String(ex.incidentDate),
      rawLabel: null,
    };
  }

  if (ex.scanIsReal && ex.scanDates && ex.scanDates.length > 0) {
    let best: { iso: string; sortKey: number; label: string; value: string } | null = null;
    for (const cand of ex.scanDates) {
      const parsed = parseExactCalendarDate(cand?.value);
      if (!parsed) continue;
      if (!best || parsed.sortKey < best.sortKey) {
        best = { ...parsed, label: cand.label ?? '', value: cand.value };
      }
    }
    if (best) {
      return {
        known: true,
        iso: best.iso,
        sortKey: best.sortKey,
        source: 'document',
        sourceLabel: DATE_SOURCE_LABEL.document,
        sourceShort: DATE_SOURCE_SHORT.document,
        rawValue: best.value,
        rawLabel: best.label || null,
      };
    }
  }

  const received = parseExactCalendarDate(ex.uploadedAt);
  if (received) {
    return {
      known: true,
      iso: received.iso,
      sortKey: received.sortKey,
      source: 'received',
      sourceLabel: DATE_SOURCE_LABEL.received,
      sourceShort: DATE_SOURCE_SHORT.received,
      rawValue: String(ex.uploadedAt),
      rawLabel: null,
    };
  }

  return UNDATED;
}

/** One row of a built chronology. */
export type ChronologyEntry<T> = {
  item: T;
  date: ResolvedDate;
};

export type Chronology<T> = {
  /** Ordered earliest first. */
  dated: ChronologyEntry<T>[];
  /**
   * Items we could not place. Kept in the order they were given, and kept in
   * their own list so no caller can render them as though they sat at one end
   * of the timeline.
   */
  undated: ChronologyEntry<T>[];
};

/**
 * Split a list into a dated chronology plus an undated remainder.
 *
 * The undated items are NOT sorted to the top and NOT sorted to the bottom of
 * the dated list. They come back separately, because putting an item with no
 * known date at either end of a legal chronology asserts a date that nobody
 * established. A caller that wants them on the page has to render them under
 * their own heading, which is the honest presentation.
 *
 * Ties keep the caller's input order, so two exhibits stated as the same day
 * stay in the order they were filed.
 */
export function buildChronology<T>(
  items: readonly T[],
  resolve: (item: T) => ResolvedDate,
): Chronology<T> {
  const dated: { entry: ChronologyEntry<T>; index: number }[] = [];
  const undated: ChronologyEntry<T>[] = [];

  items.forEach((item, index) => {
    const date = resolve(item);
    if (date.known) dated.push({ entry: { item, date }, index });
    else undated.push({ item, date });
  });

  dated.sort((a, b) => {
    const ak = a.entry.date.known ? a.entry.date.sortKey : 0;
    const bk = b.entry.date.known ? b.entry.date.sortKey : 0;
    if (ak !== bk) return ak - bk;
    return a.index - b.index;
  });

  return { dated: dated.map((d) => d.entry), undated };
}

/**
 * How many items in a chronology rest on an upload date rather than on
 * anything about the event. Surfaced so a person can be told plainly that N
 * rows of their timeline are ordered by when the file arrived.
 */
export function countByDateSource<T>(
  chron: Chronology<T>,
): Record<DateSource | 'unknown', number> {
  const counts: Record<DateSource | 'unknown', number> = {
    stated: 0,
    document: 0,
    received: 0,
    unknown: chron.undated.length,
  };
  for (const e of chron.dated) {
    if (e.date.known) counts[e.date.source] += 1;
  }
  return counts;
}
