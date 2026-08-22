/**
 * United States display formatting. One module, one locale.
 *
 * Why this exists
 * ---------------
 * A bare `date.toLocaleDateString()` has no fixed meaning. It resolves to
 * the *host's* locale, which is the Node worker's locale during SSR and the
 * browser's locale after hydration. Two consequences, both real:
 *
 *   1. The same date can render two different ways inside one page load,
 *      which React reports as a hydration mismatch (#425 rolling up into
 *      #422). `components/LocaleTime.tsx` was written to work around one
 *      instance of exactly this.
 *   2. A user whose browser is set to a non-US locale sees day-first dates.
 *      `03/04/2026` is March 4th in the United States and April 3rd almost
 *      everywhere else. On a filing deadline, a hearing date or a court
 *      exhibit that is a correctness defect, not a preference.
 *
 * Advottic is a United States legal product: matters are filed in US courts,
 * on US dates, in US dollars. So the formats are pinned to `en-US` here and
 * every call site routes through this module. That is deliberately
 * independent of the UI *language* - the app translates its words (including
 * a Spanish surface), but a Spanish-speaking user in the United States still
 * files on a US calendar, so the numbers keep their US shape.
 *
 * Time zone is deliberately NOT pinned. A hearing at 9:00 AM should read
 * 9:00 AM to the person who has to attend it, so the runtime zone is the
 * right answer; callers that need a fixed zone pass `timeZone` themselves.
 *
 * Memoization
 * -----------
 * Constructing an `Intl.DateTimeFormat` or `Intl.NumberFormat` is the
 * expensive step - it resolves locale data - while `.format()` on an existing
 * instance is cheap. These formatters are called once per row in tables,
 * timelines and activity feeds, so instances are cached by their option set
 * and reused. The cache key is built from sorted option entries so that two
 * structurally identical option objects (a fresh literal on every render, as
 * JSX produces) hit the same instance. The key space is bounded by the number
 * of distinct option sets in the codebase, so the cache cannot grow without
 * limit.
 */

/** The one locale this product formats in. */
export const US_LOCALE = 'en-US';

export type DateInput = Date | string | number | null | undefined;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

function cacheKey(options: Record<string, unknown>): string {
  return Object.keys(options)
    .sort()
    .map((k) => `${k}:${String(options[k])}`)
    .join('|');
}

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = cacheKey(options as Record<string, unknown>);
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(US_LOCALE, options);
    dateFormatters.set(key, f);
  }
  return f;
}

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = cacheKey(options as Record<string, unknown>);
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(US_LOCALE, options);
    numberFormatters.set(key, f);
  }
  return f;
}

/**
 * Coerce a caller's value to a usable Date, or null.
 *
 * Returns null rather than an Invalid Date so every formatter can render an
 * empty string. A blank cell is recoverable; the literal text "Invalid Date"
 * printed on a court exhibit or a deadline card is not.
 */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A calendar date with no time on it: `2026-01-05`.
 *
 * This is the shape `exhibits.incident_date` and every other date-only column
 * arrives in.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Escape hatch for a one-off option set. Still pinned to en-US, still
 * memoized. Prefer a named preset below when one fits.
 *
 * A DATE-ONLY STRING IS RENDERED IN UTC, AND THAT IS NOT A PREFERENCE.
 * `new Date('2026-01-05')` is midnight UTC, and formatting that instant in a
 * zone behind UTC yields "Jan 4, 2026". The incident date somebody typed as
 * the 5th then printed as the 4th on their court packet, one day out, with
 * nothing to suggest anything had happened. Found by generating the packet
 * and reading it, not by a failing test.
 *
 * The module's note above about leaving the zone unpinned still holds, and is
 * why this is narrow: a hearing at 9:00 AM is an instant and should read 9:00
 * AM to the person attending, so a full timestamp keeps the runtime zone. A
 * date-only value is not an instant at all. It names a day, and a day does
 * not move between zones. A caller that passes its own `timeZone` still wins.
 */
export function formatDateWith(
  value: DateInput,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  if (!d) return '';
  const dateOnly =
    typeof value === 'string' && DATE_ONLY.test(value.trim()) && !options.timeZone;
  return dateFormatter(dateOnly ? { ...options, timeZone: 'UTC' } : options).format(d);
}

/** Escape hatch for a one-off number option set. */
export function formatNumberWith(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return numberFormatter(options).format(value);
}

/* -------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------- */

/** `3/4/2026`. The all-numeric US form. Month first. */
export function formatDateNumeric(value: DateInput): string {
  return formatDateWith(value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

/** `Mar 4, 2026`. The default: unambiguous and compact. */
export function formatDate(value: DateInput): string {
  return formatDateWith(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** `March 4, 2026`. For letters, exhibits and other prose. */
export function formatDateLong(value: DateInput): string {
  return formatDateWith(value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** `Mar 4`. Year omitted; only for lists already scoped to a known year. */
export function formatDateShort(value: DateInput): string {
  return formatDateWith(value, { month: 'short', day: 'numeric' });
}

/** `March 2026`. Section headers on grouped timelines. */
export function formatMonthYear(value: DateInput): string {
  return formatDateWith(value, { year: 'numeric', month: 'long' });
}

/* -------------------------------------------------------------------------
 * Times and date-times. 12-hour with AM/PM throughout, which is what en-US
 * resolves to; no call site pins `hour12`.
 * ---------------------------------------------------------------------- */

/** `12:00 PM`. */
export function formatTime(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    hour: 'numeric',
    minute: '2-digit',
    ...extra,
  });
}

/** `3:04:05 PM`. For a live "last run" readout where the seconds matter. */
export function formatTimeWithSeconds(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    ...extra,
  });
}

/** `3/4/2026, 12:00:00 PM`. The all-numeric US date-time. */
export function formatDateTimeNumeric(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    ...extra,
  });
}

/** `Mar 4, 2026, 12:00 PM`. The default date-time. */
export function formatDateTime(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...extra,
  });
}

/** `Mar 4, 12:00 PM`. Year omitted. */
export function formatDateTimeShort(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...extra,
  });
}

/** `Wednesday, March 4, 2026 at 12:00 PM`. Hearings and alerts. */
export function formatDateTimeLong(
  value: DateInput,
  extra?: Intl.DateTimeFormatOptions,
): string {
  return formatDateWith(value, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...extra,
  });
}

/* -------------------------------------------------------------------------
 * Numbers and money
 * ---------------------------------------------------------------------- */

/** `1,234,567`. US grouping. */
export function formatNumber(value: number | null | undefined): string {
  return formatNumberWith(value, {});
}

/**
 * Money is stored in cents throughout this codebase. Divide here, once, and
 * let Intl place the grouping separators - a hand-rolled
 * `` `$${(cents / 100).toFixed(2)}` `` renders `$1234567.89` with no commas.
 */
export function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  return formatUsdFromDollars(cents / 100);
}

/** `$1,234.50`. For values already denominated in dollars. */
export function formatUsdFromDollars(dollars: number | null | undefined): string {
  return formatNumberWith(dollars, { style: 'currency', currency: 'USD' });
}

/* -------------------------------------------------------------------------
 * Distance. US customary: feet and miles.
 * ---------------------------------------------------------------------- */

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
/** A tenth of a mile. Below this, feet read better than a decimal of a mile. */
const FEET_CUTOFF_M = METERS_PER_MILE / 10;

/** Kilometers to miles. */
export function milesFromKm(km: number): number {
  return (km * 1000) / METERS_PER_MILE;
}

/**
 * `98 ft` / `0.31 mi` / `50.0 mi`.
 *
 * Feet under a tenth of a mile, then miles. Two decimals while the reading is
 * under a mile (the difference between 0.31 and 0.34 of a mile matters when
 * you are walking toward someone), one decimal beyond that, where the extra
 * digit is noise.
 */
export function formatDistanceFromMeters(
  meters: number | null | undefined,
): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return '';
  }
  if (meters < FEET_CUTOFF_M) {
    return `${formatNumber(Math.round(meters / METERS_PER_FOOT))} ft`;
  }
  const miles = meters / METERS_PER_MILE;
  // Decide the precision from the value as it will be READ, not as it is
  // held. 1609 m is 0.99979 mi, which the raw comparison sends down the
  // two-decimal branch and renders "1.00 mi" - one metre from "1.0 mi".
  const digits = Math.round(miles * 100) / 100 < 1 ? 2 : 1;
  const value = formatNumberWith(miles, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value} mi`;
}
